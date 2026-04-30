/**
 * Copilot SDK's `session.shutdown` event collapses the runtime's true
 * reason (complete | abort | timeout | user_exit | error) into just
 * `routine | error` (issue copilot-cli/2852). The SDK itself knows the
 * specific reason — it just doesn't surface it.
 *
 * To keep the orchestrator's downstream handling correct (timeouts must
 * trigger retry, aborts must NOT), we track our own reason locally:
 * whoever causes the termination calls `mark*()` first, and the shutdown
 * handler asks `finalize()` for the canonical reason.
 *
 * First write wins so a `markAbort()` from SIGINT isn't overridden by a
 * later `markTimeout()` from a stale watchdog firing after we already
 * tore down.
 */
export type TerminationReason =
  | 'complete'
  | 'abort'
  | 'timeout'
  | 'error'
  | 'user_exit';

export class TerminationTracker {
  private reason: TerminationReason | null = null;
  private errorMessage: string | undefined;

  markAbort(): void {
    this.reason ??= 'abort';
  }

  markTimeout(): void {
    this.reason ??= 'timeout';
  }

  markError(err: unknown): void {
    if (this.reason && this.reason !== 'error') return;
    this.reason = 'error';
    this.errorMessage = err instanceof Error ? err.message : String(err);
  }

  markUserExit(): void {
    this.reason ??= 'user_exit';
  }

  finalize(shutdownType?: string): { reason: TerminationReason; message?: string } {
    if (this.reason) {
      return { reason: this.reason, message: this.errorMessage };
    }
    if (shutdownType === 'error') return { reason: 'error', message: this.errorMessage };
    return { reason: 'complete' };
  }
}
