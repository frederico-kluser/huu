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
 * Read total and used memory from the first available source in this order:
 *   1. process.constrainedMemory()  (Node 20+ container-aware API)
 *   2. cgroup v2  (/sys/fs/cgroup/memory.{max,current})
 *   3. cgroup v1  (/sys/fs/cgroup/memory/memory.{limit_in_bytes,usage_in_bytes})
 *   4. host       (os.totalmem() / os.totalmem() - os.freemem())
 *
 * Returns { totalBytes, usedBytes, containerAware }.
 */
function readContainerMemory(): {
  totalBytes: number;
  usedBytes: number;
  containerAware: boolean;
} {
  const constrained =
    typeof process.constrainedMemory === 'function'
      ? process.constrainedMemory()
      : 0;
  if (constrained > 0 && constrained < Number.MAX_SAFE_INTEGER) {
    const used =
      typeof process.memoryUsage === 'function'
        ? process.memoryUsage().rss
        : totalmem() - freemem();
    return { totalBytes: constrained, usedBytes: used, containerAware: true };
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
          return { totalBytes: total, usedBytes: used, containerAware: true };
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
        return { totalBytes: total, usedBytes: used, containerAware: true };
      }
    } catch {
      /* cgroup v1 read error — fall through */
    }
  }

  const memTotal = totalmem();
  const memUsed = memTotal - freemem();
  return { totalBytes: memTotal, usedBytes: memUsed, containerAware: false };
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

  const { totalBytes, usedBytes, containerAware } = readContainerMemory();
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
    processRssBytes,
    loadAvg1,
    containerAware,
  };
}
