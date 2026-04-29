import { useEffect, useState } from 'react';
import os from 'node:os';

export interface SystemMetrics {
  /** System-wide CPU usage in [0, 100], aggregated across all cores. */
  cpuPercent: number;
  /** Bytes used = totalmem - freemem (system-wide). */
  memUsedBytes: number;
  /** Total physical memory reported by the OS. */
  memTotalBytes: number;
  /** memUsed / memTotal in [0, 100]. */
  memPercent: number;
  /** RSS of the current Node process (this orchestrator). */
  processRssBytes: number;
  /** 1-minute load average (0 on Windows where unsupported). */
  loadAvg1: number;
}

interface CpuSnapshot {
  idle: number;
  total: number;
}

function readCpu(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/**
 * Samples system-wide CPU% (delta between two `os.cpus()` reads), system RAM%,
 * and the current Node process RSS at a fixed interval. Suitable for a
 * lightweight always-on header in a TUI; cost per tick is O(numCpus) plus one
 * `process.memoryUsage()` call.
 *
 * The interval is `unref()`-ed so it does not keep the event loop alive.
 */
export function useSystemMetrics(intervalMs = 1000): SystemMetrics | null {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    let prev = readCpu();

    const sample = (): void => {
      const curr = readCpu();
      const idleDelta = curr.idle - prev.idle;
      const totalDelta = curr.total - prev.total;
      const cpuPercent =
        totalDelta > 0
          ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))
          : 0;
      prev = curr;

      const memTotalBytes = os.totalmem();
      const memFreeBytes = os.freemem();
      const memUsedBytes = memTotalBytes - memFreeBytes;
      const memPercent =
        memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : 0;
      const processRssBytes = process.memoryUsage().rss;
      const loadAvg1 = os.loadavg()[0] ?? 0;

      setMetrics({
        cpuPercent,
        memUsedBytes,
        memTotalBytes,
        memPercent,
        processRssBytes,
        loadAvg1,
      });
    };

    sample();
    const id = setInterval(sample, intervalMs);
    id.unref?.();
    return () => clearInterval(id);
  }, [intervalMs]);

  return metrics;
}
