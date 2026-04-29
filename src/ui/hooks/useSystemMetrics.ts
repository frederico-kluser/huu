import { useEffect, useState } from 'react';
import {
  makeCpuSampler,
  readSystemMetrics,
  type SystemMetrics,
} from '../../lib/system-metrics.js';

export type { SystemMetrics } from '../../lib/system-metrics.js';

/**
 * Samples container-aware CPU%, memory, and process RSS at a fixed interval.
 * Reads cgroup v2 files when present (Docker/Kubernetes) and falls back to
 * `os.cpus()` / `os.totalmem()` on bare-metal Linux, macOS, and Windows.
 *
 * Each hook instance owns its own delta state via `makeCpuSampler()` — sharing
 * sampler state across consumers (UI bar + Autoscaler) would interleave deltas.
 *
 * The interval is `unref()`-ed so it does not keep the event loop alive.
 */
export function useSystemMetrics(intervalMs = 1000): SystemMetrics | null {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    const sampler = makeCpuSampler();

    const sample = (): void => {
      setMetrics(readSystemMetrics(sampler));
    };

    sample();
    const id = setInterval(sample, intervalMs);
    id.unref?.();
    return () => clearInterval(id);
  }, [intervalMs]);

  return metrics;
}
