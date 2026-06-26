import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, freemem, loadavg } from 'node:os';

export interface SystemMetrics {
  /** System-wide CPU usage in [0, 100], aggregated across all cores. */
  cpuPercent: number;
  /** System RAM usage percentage in [0, 100]. In-container aware. */
  ramPercent: number;
  /** RAM bytes in use. Within a container this reflects the cgroup limit. */
  ramUsedBytes: number;
  /** Total RAM bytes available. Within a container this reflects the cgroup limit. */
  ramTotalBytes: number;
  /**
   * RAM bytes still claimable before hitting the limit. On Linux hosts this
   * is /proc/meminfo MemAvailable (accounts for reclaimable page cache); on
   * macOS it is vm_stat's free+inactive+purgeable+speculative pages (the
   * reclaimable-cache equivalent — os.freemem() alone saturates ramPercent
   * on any warmed-up Mac); inside a cgroup it is limit − current; elsewhere
   * os.freemem().
   */
  ramAvailableBytes: number;
  /** RSS of the current Node process. */
  processRssBytes: number;
  /** 1-minute load average (0 on Windows where unsupported). */
  loadAvg1: number;
  /** True when memory values were sourced from a container/cgroup boundary. */
  containerAware: boolean;
}

interface CpuSnapshot {
  idle: number;
  total: number;
}

function readCpu(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/**
 * Read the cgroup's current memory usage (v2 then v1), or null when no
 * cgroup counter is readable. Used to give the constrainedMemory() branch a
 * whole-container "used" figure — this process's RSS alone undercounts when
 * agent tool subprocesses are running.
 */
function readCgroupUsedBytes(): number | null {
  const v2CurPath = '/sys/fs/cgroup/memory.current';
  if (existsSync(v2CurPath)) {
    try {
      const used = Number(readFileSync(v2CurPath, 'utf8').trim());
      if (Number.isFinite(used) && used >= 0) return used;
    } catch {
      /* fall through to v1 */
    }
  }
  const v1UsagePath = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
  if (existsSync(v1UsagePath)) {
    try {
      const used = Number(readFileSync(v1UsagePath, 'utf8').trim());
      if (Number.isFinite(used) && used >= 0) return used;
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * Read /proc/meminfo MemAvailable in bytes, or null when unreadable (macOS,
 * Windows, sandboxed fs). MemAvailable accounts for reclaimable page cache,
 * so it is a far better headroom signal than os.freemem() on Linux hosts.
 */
function readMemAvailableBytes(): number | null {
  const path = '/proc/meminfo';
  if (!existsSync(path)) return null;
  try {
    const match = /^MemAvailable:\s+(\d+)\s*kB/m.exec(readFileSync(path, 'utf8'));
    if (!match) return null;
    const kb = Number(match[1]);
    return Number.isFinite(kb) && kb >= 0 ? kb * 1024 : null;
  } catch {
    return null;
  }
}

/**
 * Read total, used, and available memory from the first source available in
 * this order:
 *   1. process.constrainedMemory()  (Node 20+ container-aware API; used =
 *      cgroup current when readable, else this process's RSS)
 *   2. cgroup v2  (/sys/fs/cgroup/memory.{max,current})
 *   3. cgroup v1  (/sys/fs/cgroup/memory/memory.{limit_in_bytes,usage_in_bytes})
 *   4. host       (os.totalmem(); available = MemAvailable on Linux,
 *      vm_stat-derived on macOS, os.freemem() elsewhere)
 *
 * `darwinAvailable` is the caller's cached vm_stat-derived figure (or null
 * off-darwin / when unavailable); it is owned per-sampler so concurrent
 * samplers don't share a TTL cache.
 *
 * Returns { totalBytes, usedBytes, availableBytes, containerAware }.
 */
function readContainerMemory(darwinAvailable: number | null): {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  containerAware: boolean;
} {
  const constrained =
    typeof process.constrainedMemory === 'function'
      ? process.constrainedMemory()
      : 0;
  if (constrained > 0 && constrained < Number.MAX_SAFE_INTEGER) {
    const rss =
      typeof process.memoryUsage === 'function'
        ? process.memoryUsage().rss
        : totalmem() - freemem();
    const used = readCgroupUsedBytes() ?? rss;
    const available = Math.max(0, constrained - used);
    return {
      totalBytes: constrained,
      usedBytes: used,
      availableBytes: available,
      containerAware: true,
    };
  }

  const v2MaxPath = '/sys/fs/cgroup/memory.max';
  const v2CurPath = '/sys/fs/cgroup/memory.current';
  if (existsSync(v2MaxPath) && existsSync(v2CurPath)) {
    try {
      const maxRaw = readFileSync(v2MaxPath, 'utf8').trim();
      if (maxRaw !== 'max') {
        const total = Number(maxRaw);
        const used = Number(readFileSync(v2CurPath, 'utf8').trim());
        if (total > 0) {
          return {
            totalBytes: total,
            usedBytes: used,
            availableBytes: Math.max(0, total - used),
            containerAware: true,
          };
        }
      }
    } catch {
      /* cgroup v2 read error — fall through */
    }
  }

  const v1LimitPath = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
  const v1UsagePath = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
  if (existsSync(v1LimitPath) && existsSync(v1UsagePath)) {
    try {
      const total = Number(readFileSync(v1LimitPath, 'utf8').trim());
      const used = Number(readFileSync(v1UsagePath, 'utf8').trim());
      if (total > 0 && total < Number.MAX_SAFE_INTEGER) {
        return {
          totalBytes: total,
          usedBytes: used,
          availableBytes: Math.max(0, total - used),
          containerAware: true,
        };
      }
    } catch {
      /* cgroup v1 read error — fall through */
    }
  }

  const memTotal = totalmem();
  const memAvailable = readMemAvailableBytes() ?? darwinAvailable ?? freemem();
  const memUsed = Math.max(0, memTotal - memAvailable);
  return {
    totalBytes: memTotal,
    usedBytes: memUsed,
    availableBytes: memAvailable,
    containerAware: false,
  };
}

/**
 * Owns the mutable sampling state (CPU delta snapshot + the macOS vm_stat TTL
 * cache). Each instance computes CPU% as a delta between its OWN consecutive
 * `sample()` calls, so two samplers polling on overlapping cadences never
 * corrupt each other's delta — the reason multi-run scheduling must give the
 * global scheduler a single dedicated sampler instead of having every per-run
 * AutoScaler poll the module singleton.
 */
export class SystemMetricsSampler {
  private prevCpu: CpuSnapshot | null = null;
  private darwinAvailableCache: { at: number; bytes: number | null } | null = null;

  /**
   * Reset the internal CPU snapshot. Primarily useful in test beforeEach to
   * guarantee each test starts with a clean CPU delta state.
   */
  resetCpuSnapshot(): void {
    this.prevCpu = null;
  }

  /**
   * Reset the cached vm_stat reading. Test hook (same spirit as
   * resetCpuSnapshot) — the 500ms TTL would otherwise leak one test's mocked
   * vm_stat output into the next.
   */
  resetDarwinAvailableCache(): void {
    this.darwinAvailableCache = null;
  }

  /**
   * macOS equivalent of Linux's MemAvailable: free + inactive + purgeable +
   * speculative pages from `vm_stat`. os.freemem() on darwin counts ONLY
   * truly-free pages — on any warmed-up Mac the file cache keeps that near
   * zero, which made ramPercent saturate ≥95% and permanently gate
   * `AutoScaler.shouldSpawn()`. Returns null off-darwin or when vm_stat is
   * unavailable. Cached briefly so several per-tick consumers don't re-exec
   * vm_stat.
   */
  private readDarwinAvailableBytes(): number | null {
    if (process.platform !== 'darwin') return null;
    const now = Date.now();
    if (this.darwinAvailableCache && now - this.darwinAvailableCache.at < 500) {
      return this.darwinAvailableCache.bytes;
    }
    let bytes: number | null = null;
    try {
      const out = execFileSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
      const pageSize = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 16384);
      const pagesOf = (label: string): number =>
        Number(new RegExp(`^Pages ${label}:\\s+(\\d+)`, 'm').exec(out)?.[1] ?? 0);
      const pages =
        pagesOf('free') + pagesOf('inactive') + pagesOf('purgeable') + pagesOf('speculative');
      bytes = pages > 0 ? pages * pageSize : null;
    } catch {
      bytes = null;
    }
    this.darwinAvailableCache = { at: now, bytes };
    return bytes;
  }

  /**
   * Sample system-wide CPU% (delta between two cpus() reads), container-aware
   * RAM%, process RSS, and 1-minute load average.
   *
   * The first call returns 0 for cpuPercent (no prior snapshot to compute a
   * delta against). Each subsequent call computes the delta from the previous
   * call's snapshot.
   *
   * All I/O is synchronous — suitable for use in a setInterval or similar
   * polling loop. This method does not throw: unexpected errors in cgroup
   * reads degrade gracefully to host fallback.
   */
  sample(): SystemMetrics {
    const curr = readCpu();
    let cpuPercent = 0;
    if (this.prevCpu !== null) {
      const idleDelta = curr.idle - this.prevCpu.idle;
      const totalDelta = curr.total - this.prevCpu.total;
      cpuPercent =
        totalDelta > 0
          ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))
          : 0;
    }
    this.prevCpu = curr;

    const { totalBytes, usedBytes, availableBytes, containerAware } = readContainerMemory(
      this.readDarwinAvailableBytes(),
    );
    const ramPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

    const processRssBytes =
      typeof process.memoryUsage === 'function' ? process.memoryUsage().rss : 0;

    const loadAvg1 = loadavg()[0] ?? 0;

    return {
      cpuPercent,
      ramPercent,
      ramUsedBytes: usedBytes,
      ramTotalBytes: totalBytes,
      ramAvailableBytes: availableBytes,
      processRssBytes,
      loadAvg1,
      containerAware,
    };
  }
}

/**
 * Process-wide default sampler. Backs the legacy free-function API so existing
 * callers (the TUI useSystemMetrics hook, single-run AutoScalers, tests) keep
 * their previous behavior. Multi-run scheduling constructs its OWN
 * SystemMetricsSampler so it does not share this instance's CPU-delta state.
 */
const DEFAULT_SAMPLER = new SystemMetricsSampler();

/** See {@link SystemMetricsSampler.sample}. Uses the process-wide default sampler. */
export function getSystemMetrics(): SystemMetrics {
  return DEFAULT_SAMPLER.sample();
}

/** Reset the default sampler's CPU snapshot (test hook). */
export function resetCpuSnapshot(): void {
  DEFAULT_SAMPLER.resetCpuSnapshot();
}

/** Reset the default sampler's cached vm_stat reading (test hook). */
export function resetDarwinAvailableCache(): void {
  DEFAULT_SAMPLER.resetDarwinAvailableCache();
}
