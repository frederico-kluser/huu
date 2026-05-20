// Reusable state coalescer for Orchestrator → wire streaming.
//
// The Orchestrator can emit hundreds of state events per second under
// concurrency 10 (each agent log/state_change/tool start+end is one
// emit). Forwarding every emit over the WebSocket would saturate the
// browser. Mirroring RunDashboard's strategy (src/ui/components/
// RunDashboard.tsx — STATE_FLUSH_INTERVAL_MS=125), this helper retains
// only the latest snapshot and flushes it on a fixed-rate interval.
//
// Terminal states (status === 'done' | 'error') should bypass the
// throttle via `flush()` so the client sees the final frame immediately.

import type { OrchestratorState } from '../lib/types.js';

export type StateSink = (state: OrchestratorState) => void;

export class StateCoalescer {
  private pending: OrchestratorState | null = null;
  private lastSent: OrchestratorState | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private readonly intervalMs: number,
    private readonly sink: StateSink,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    // Don't keep the event loop alive just to drain this coalescer.
    this.timer.unref?.();
  }

  push(state: OrchestratorState): void {
    if (this.disposed) return;
    this.pending = state;
  }

  /**
   * Emit the most recent pending state immediately (skipping the next
   * interval tick). No-op when nothing has been pushed since the last
   * send. Used to surface terminal frames without waiting up to
   * `intervalMs` more.
   */
  flush(): void {
    if (this.disposed) return;
    this.tick();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.lastSent = null;
  }

  private tick(): void {
    const next = this.pending;
    if (next === null) return;
    if (next === this.lastSent) return;
    this.lastSent = next;
    this.sink(next);
  }
}
