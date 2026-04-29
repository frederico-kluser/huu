import os from 'node:os';
import { existsSync, readFileSync, statfsSync } from 'node:fs';

export type MetricsSource = 'cgroup-v2' | 'host';

export interface SystemMetrics {
  /** CPU% in [0,100] — cgroup-v2 cpu.stat usage when available, else host-wide os.cpus() delta. */
  cpuPercent: number;
  /** Bytes used. cgroup memory.current when available, else os.totalmem - os.freemem. */
  memUsedBytes: number;
  /** Total memory. cgroup memory.max when finite, else os.totalmem(). */
  memTotalBytes: number;
  /** memUsed / memTotal in [0,100]. */
  memPercent: number;
  /** RSS of this Node process. */
  processRssBytes: number;
  /** 1-minute load average; 0 on Windows. */
  loadAvg1: number;
  /** Origin of mem/cpu values — UI displays a hint when this is 'host' inside a container. */
  source: MetricsSource;
}

/**
 * Per-consumer sampler state. CPU% is delta-based, so each caller (UI hook,
 * Autoscaler) keeps its own snapshots — sharing would interleave deltas and
 * produce nonsense values when the two consumers tick at different intervals.
 */
export interface CpuSamplerState {
  hostPrev: HostCpuSnapshot | null;
  cgroupPrev: CgroupCpuSnapshot | null;
}

interface HostCpuSnapshot {
  idle: number;
  total: number;
}

interface CgroupCpuSnapshot {
  usageUs: number;
  timestampMs: number;
}

export function makeCpuSampler(): CpuSamplerState {
  return { hostPrev: null, cgroupPrev: null };
}

let cgroupV2Memory: boolean | null = null;
let cgroupV2Cpu: boolean | null = null;
let effectiveCpuCountCached: number | null = null;

const MEM_MAX_PATH = '/sys/fs/cgroup/memory.max';
const MEM_CURRENT_PATH = '/sys/fs/cgroup/memory.current';
const CPU_MAX_PATH = '/sys/fs/cgroup/cpu.max';
const CPU_STAT_PATH = '/sys/fs/cgroup/cpu.stat';

function detectCgroupMemory(): boolean {
  if (cgroupV2Memory !== null) return cgroupV2Memory;
  cgroupV2Memory = existsSync(MEM_MAX_PATH) && existsSync(MEM_CURRENT_PATH);
  return cgroupV2Memory;
}

function detectCgroupCpu(): boolean {
  if (cgroupV2Cpu !== null) return cgroupV2Cpu;
  cgroupV2Cpu = existsSync(CPU_STAT_PATH);
  return cgroupV2Cpu;
}

/**
 * cgroup v2 cpu.max format: "<quota> <period>" or "max <period>". When quota
 * is finite, effective vCPUs = quota/period. We cache because cpu.max is
 * static for the container lifetime — re-reading every tick is wasteful.
 */
function readEffectiveCpuCount(): number {
  if (effectiveCpuCountCached !== null) return effectiveCpuCountCached;
  if (detectCgroupCpu() && existsSync(CPU_MAX_PATH)) {
    try {
      const raw = readFileSync(CPU_MAX_PATH, 'utf8').trim();
      const [quotaStr, periodStr] = raw.split(/\s+/);
      if (quotaStr && quotaStr !== 'max' && periodStr) {
        const quota = parseInt(quotaStr, 10);
        const period = parseInt(periodStr, 10);
        if (Number.isFinite(quota) && Number.isFinite(period) && period > 0) {
          effectiveCpuCountCached = Math.max(1, quota / period);
          return effectiveCpuCountCached;
        }
      }
    } catch {
      /* fall through to host count */
    }
  }
  effectiveCpuCountCached = Math.max(1, os.cpus().length);
  return effectiveCpuCountCached;
}

interface MemoryReading {
  used: number;
  total: number;
  source: MetricsSource;
}

function readMemory(): MemoryReading {
  if (detectCgroupMemory()) {
    try {
      const maxRaw = readFileSync(MEM_MAX_PATH, 'utf8').trim();
      const currentRaw = readFileSync(MEM_CURRENT_PATH, 'utf8').trim();
      const current = parseInt(currentRaw, 10);
      // "max" means no limit — fall back to host total. Without a cgroup ceiling
      // there is no container-relative %; saying 0.5% used of 32 GB host while
      // memory.current shows 16 GB is misleading, so we still use memory.current
      // as the numerator to keep the absolute value honest.
      if (maxRaw === 'max') {
        const total = process.constrainedMemory?.() || os.totalmem();
        return { used: Number.isFinite(current) ? current : 0, total, source: 'cgroup-v2' };
      }
      const max = parseInt(maxRaw, 10);
      if (Number.isFinite(max) && Number.isFinite(current) && max > 0) {
        return { used: current, total: max, source: 'cgroup-v2' };
      }
    } catch {
      /* fall through */
    }
  }
  const total = os.totalmem();
  return { used: total - os.freemem(), total, source: 'host' };
}

function readHostCpuSnapshot(): HostCpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function readCgroupCpuSnapshot(): CgroupCpuSnapshot | null {
  if (!detectCgroupCpu()) return null;
  try {
    const raw = readFileSync(CPU_STAT_PATH, 'utf8');
    const m = /usage_usec\s+(\d+)/.exec(raw);
    if (!m || !m[1]) return null;
    return { usageUs: parseInt(m[1], 10), timestampMs: Date.now() };
  } catch {
    return null;
  }
}

interface CpuReading {
  percent: number;
  source: MetricsSource;
}

function readCpu(state: CpuSamplerState): CpuReading {
  // Prefer cgroup when the file exists. A first-call path returns 0% (no prev
  // delta yet) — same as the original host-only implementation.
  if (detectCgroupCpu()) {
    const curr = readCgroupCpuSnapshot();
    if (curr) {
      const prev = state.cgroupPrev;
      state.cgroupPrev = curr;
      if (prev) {
        const dtMs = curr.timestampMs - prev.timestampMs;
        if (dtMs <= 0) return { percent: 0, source: 'cgroup-v2' };
        const cpus = readEffectiveCpuCount();
        const dUsageUs = curr.usageUs - prev.usageUs;
        // dUsageUs / 1000 = ms of CPU time across all cgroup tasks.
        // Divide by (dtMs * cpus) to normalize to [0,1] of full capacity.
        const percent = Math.max(0, Math.min(100, (dUsageUs / 1000) / dtMs / cpus * 100));
        return { percent, source: 'cgroup-v2' };
      }
      return { percent: 0, source: 'cgroup-v2' };
    }
  }
  const curr = readHostCpuSnapshot();
  const prev = state.hostPrev;
  state.hostPrev = curr;
  if (!prev) return { percent: 0, source: 'host' };
  const idleDelta = curr.idle - prev.idle;
  const totalDelta = curr.total - prev.total;
  const percent = totalDelta > 0
    ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))
    : 0;
  return { percent, source: 'host' };
}

export function readSystemMetrics(state: CpuSamplerState): SystemMetrics {
  const mem = readMemory();
  const cpu = readCpu(state);
  const memPercent = mem.total > 0 ? (mem.used / mem.total) * 100 : 0;
  // The 'source' on the bundle reflects mem (the autoscaler's primary signal);
  // CPU source is only divergent in the rare case where memory.max exists but
  // cpu.stat doesn't, which doesn't happen on real cgroup v2 setups.
  return {
    cpuPercent: cpu.percent,
    memUsedBytes: mem.used,
    memTotalBytes: mem.total,
    memPercent,
    processRssBytes: process.memoryUsage().rss,
    loadAvg1: os.loadavg()[0] ?? 0,
    source: mem.source,
  };
}

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  percent: number;
}

/**
 * Returns disk usage for the filesystem containing `path`. Used by the
 * Autoscaler as a third pressure signal — N worktrees × repo size can exhaust
 * disk before RAM, and `git worktree add` under disk-full corrupts state.
 */
export function readDiskUsage(path: string): DiskUsage | null {
  try {
    const s = statfsSync(path);
    const totalBytes = Number(s.blocks) * s.bsize;
    const freeBytes = Number(s.bavail) * s.bsize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const percent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    return { totalBytes, freeBytes, usedBytes, percent };
  } catch {
    return null;
  }
}
