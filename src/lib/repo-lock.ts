/**
 * Per-repository in-process async mutex for multi-run scheduling.
 *
 * Two pipelines can run against the SAME git repo at once (e.g. an audit and a
 * test-gen over one codebase). Their agent worktrees and branches are
 * runId-namespaced (see `git/branch-namer.ts`) so the WORK never collides —
 * but a few git plumbing ops mutate shared `.git` state that is NOT
 * runId-scoped: the global `git worktree prune`, integration-worktree
 * creation, and ref bookkeeping under `packed-refs`. Serializing ONLY those
 * short ops per repoRoot removes the "unable to lock '.git/...'" class of races
 * without ever serializing the parallel agent work itself.
 *
 * It is a plain in-process promise-chain mutex — sufficient because the whole
 * multi-run design lives in ONE process (a single GlobalScheduler). Different
 * repoRoots get independent chains and never contend, so the common case (one
 * run per repo, or runs on different repos) takes the lock uncontended.
 */

const tails = new Map<string, Promise<unknown>>();

function noop(): void {
  /* swallow — the stored tail exists only to sequence the next waiter */
}

/**
 * Run `fn` while holding the per-`repoRoot` lock. Critical sections on the same
 * repo run strictly one-at-a-time, in call order; sections on different repos
 * run concurrently. The caller receives `fn`'s own resolution/rejection.
 *
 * A failing critical section never blocks the next waiter: the stored tail is
 * swallowed, so the chain always advances.
 */
export function withRepoLock<T>(repoRoot: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = tails.get(repoRoot) ?? Promise.resolve();
  // `prev` is always a swallowed tail (never rejects), so `.then` runs `fn`
  // once the previous holder settles, regardless of its outcome.
  const result = prev.then(() => fn());
  tails.set(repoRoot, result.then(noop, noop));
  return result;
}

/**
 * Resolve once every queued critical section for `repoRoot` has drained.
 * Returns immediately when the repo was never locked. Test/diagnostic hook.
 */
export function repoLockIdle(repoRoot: string): Promise<void> {
  return Promise.resolve(tails.get(repoRoot)).then(noop, noop);
}
