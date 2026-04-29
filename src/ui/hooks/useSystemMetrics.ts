import { useEffect, useState } from 'react';
import {
  type SystemMetrics,
  getSystemMetrics,
} from '../../lib/resource-monitor.js';

/**
 * Polls system metrics at a fixed interval. Suitable for a lightweight
 * always-on header in a TUI. The interval is `unref()`-ed so it does not
 * keep the event loop alive.
 */
export function useSystemMetrics(intervalMs = 1000): SystemMetrics | null {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    const sample = (): void => {
      setMetrics(getSystemMetrics());
    };

    sample();
    const id = setInterval(sample, intervalMs);
    id.unref?.();
    return () => clearInterval(id);
  }, [intervalMs]);

  return metrics;
}
