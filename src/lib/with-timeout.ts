// Wall-clock bound for a promise, plus the error type callers branch on.
//
// Lives in `lib/` because BOTH agent call sites need it and they sit in
// different modules: the per-task prompt (`orchestrator/index.ts`, which turns
// a timeout into `errorKind: 'timeout'` and offers an interactive retry) and
// the LLM conflict resolver (`orchestrator/integration-agent.ts`).

export class TimeoutError extends Error {
  /** Structural marker, kept from the original: survives cross-realm checks. */
  readonly isTimeout = true;
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Rejects with {@link TimeoutError} if `p` has not settled in `ms`.
 *
 * The underlying work is NOT cancelled — `Promise.race` cannot do that. A
 * caller that owns a cancellable resource (an agent) should abort it in its
 * catch; otherwise the losing promise keeps running to completion in the
 * background.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Wall-clock ceiling for the LLM conflict resolver.
 *
 * It was the ONLY agent call in a run with no bound at all: the per-task path
 * has always been wrapped, but a resolver that hung left the stage — and so
 * the whole run — waiting forever, with no card to retry and no error to
 * report. Generous on purpose (resolving several conflicted branches at max
 * thinking is slow); the point is that "forever" stops being reachable.
 * Override with `HUU_RESOLVER_TIMEOUT_MS`.
 */
export const DEFAULT_RESOLVER_TIMEOUT_MS = 15 * 60_000;

export function resolveResolverTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.HUU_RESOLVER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RESOLVER_TIMEOUT_MS;
}
