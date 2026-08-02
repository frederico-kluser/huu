/**
 * Disposal pattern shared by every backend factory. Both Pi and Copilot
 * (and the stub) share the same shape: spawn-resources, expose
 * prompt/dispose, swallow errors during cleanup so dispose is idempotent.
 *
 * Hand-rolling this in each factory got us subtle drift — Pi's dispose
 * nulled `task` for GC pressure, the Copilot prototype didn't, and the
 * stub silently re-entered prompt() after dispose in a flaky test.
 * Centralizing the flag and the dispose contract removes those classes
 * of bugs.
 */
export interface DisposableState {
  isDisposed(): boolean;
  /** Throws "agent already disposed" if dispose() already ran. */
  assertLive(): void;
  /** Idempotent: marks disposed and runs each cleanup once, swallowing errors. */
  dispose(): Promise<void>;
}

export function createDisposableState(
  cleanups: ReadonlyArray<() => unknown | Promise<unknown>>,
): DisposableState {
  let disposed = false;
  return {
    isDisposed: () => disposed,
    assertLive: () => {
      if (disposed) throw new Error('agent already disposed');
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      for (const fn of cleanups) {
        try {
          await fn();
        } catch {
          /* best effort — log via the AgentEvent stream upstream if needed */
        }
      }
    },
  };
}
