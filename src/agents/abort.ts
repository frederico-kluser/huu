// ── Abort controller composition and management ──────────────────────

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Active controllers by runId. */
const runControllers = new Map<string, AbortController>();

/**
 * Create and register an AbortController for a run.
 * Returns the controller so the caller can abort it.
 */
export function createRunAbortController(runId: string): AbortController {
  const existing = runControllers.get(runId);
  if (existing && !existing.signal.aborted) {
    return existing;
  }
  const controller = new AbortController();
  runControllers.set(runId, controller);
  return controller;
}

/**
 * Compose a single signal from multiple sources:
 * - user-initiated cancel
 * - execution timeout
 * - parent/orchestrator cancel
 */
export function composeRunSignal(input: {
  userSignal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  parentSignal?: AbortSignal | undefined;
}): AbortSignal {
  const signals: AbortSignal[] = [];

  if (input.userSignal) signals.push(input.userSignal);
  if (input.parentSignal) signals.push(input.parentSignal);

  const timeoutSignal = AbortSignal.timeout(
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  signals.push(timeoutSignal);

  if (signals.length === 1) {
    return signals[0]!;
  }

  return AbortSignal.any(signals);
}

/**
 * Abort a run by runId.
 * Returns true if the run was found and aborted.
 */
export function abortRun(runId: string, reason?: string | undefined): boolean {
  const controller = runControllers.get(runId);
  if (!controller || controller.signal.aborted) {
    return false;
  }
  controller.abort(reason ?? 'Run aborted by user');
  return true;
}

/**
 * Clean up the controller for a completed/cleaned run.
 */
export function cleanupRunController(runId: string): void {
  runControllers.delete(runId);
}

/**
 * Get all active (non-aborted) run IDs.
 */
export function getActiveRunIds(): string[] {
  const active: string[] = [];
  for (const [runId, controller] of runControllers) {
    if (!controller.signal.aborted) {
      active.push(runId);
    }
  }
  return active;
}
