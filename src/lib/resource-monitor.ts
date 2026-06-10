import { readFileSync, existsSync } from 'node:fs';
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
   * is /proc/meminfo MemAvailable (accounts for reclaimable page cache);
   * inside a cgroup it is limit − current; elsewhere os.freemem().
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

let prevCpu: CpuSnapshot | null = null;

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
 * Reset the internal CPU snapshot. Primarily useful in test beforeEach to
 * guarantee each test starts with a clean CPU delta state.
 */
export function resetCpuSnapshot(): void {
  prevCpu = null;
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
 *      os.freemem() elsewhere)
 *
 * Returns { totalBytes, usedBytes, availableBytes, containerAware }.
 */
function readContainerMemory(): {
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
  const memAvailable = readMemAvailableBytes() ?? freemem();
  const memUsed = Math.max(0, memTotal - memAvailable);
  return {
    totalBytes: memTotal,
    usedBytes: memUsed,
    availableBytes: memAvailable,
    containerAware: false,
  };
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
 * polling loop. This function does not throw: unexpected errors in cgroup
 * reads degrade gracefully to host fallback.
 */
export function getSystemMetrics(): SystemMetrics {
  const curr = readCpu();
  let cpuPercent = 0;
  if (prevCpu !== null) {
    const idleDelta = curr.idle - prevCpu.idle;
    const totalDelta = curr.total - prevCpu.total;
    cpuPercent =
      totalDelta > 0
        ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))
        : 0;
  }
  prevCpu = curr;

  const { totalBytes, usedBytes, availableBytes, containerAware } = readContainerMemory();
  const ramPercent =
    totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  const processRssBytes =
    typeof process.memoryUsage === 'function'
      ? process.memoryUsage().rss
      : 0;

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
