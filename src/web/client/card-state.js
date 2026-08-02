/**
 * Kanban classification for AGENT task cards — the web MIRROR of the
 * canonical table in `src/lib/card-state.ts` (the TUI + navigation source of
 * truth). Keep the two in lockstep; `src/web/card-state.test.js` and
 * `src/lib/card-state.test.ts` pin the same table so the mirrors can't drift
 * silently.
 *
 * The "done means MERGED" contract:
 *   - `done` cls (green) only after the branch landed in the integration
 *     worktree (`merged === true`) — or for legacy archives that predate the
 *     flag (`merged === undefined`), which must render unchanged.
 *   - Finished-but-unmerged (`merged === false`) → `ready` (teal) in DOING.
 *   - `mergeFailed` → `unmerged` (amber) in DONE: committed on the agent
 *     branch, never integrated.
 *   - `paused` (memory-guard preemption) is literally re-queued → TODO.
 *   - `reviewing` / `fixing` (the per-task critic loop) stay in DOING, and
 *     beat the generic active fallback so a fix round is visible as such.
 *
 * Keyed on `phase` (the web cards always shipped phase; for terminal states
 * phase ⇔ state). Pure — no DOM access; Node-testable.
 */

/** @param {(s: string) => string} humanize app.js's phase humanizer */
export function agentCardState(a, humanize = (s) => s) {
  if (a.phase === 'error') {
    if (a.errorKind === 'timeout') return { lane: 'done', cls: 'tmo', plabel: 'timeout' };
    return { lane: 'done', cls: 'err', plabel: 'failed' };
  }
  if (a.phase === 'paused') return { lane: 'todo', cls: 'paused', plabel: 'paused' };
  if (a.phase === 'no_changes') return { lane: 'done', cls: 'done', plabel: 'no changes' };
  if (a.phase === 'done') {
    if (a.mergeFailed) return { lane: 'done', cls: 'unmerged', plabel: 'unmerged' };
    if (a.merged === false) return { lane: 'doing', cls: 'ready', plabel: 'ready' };
    return { lane: 'done', cls: 'done', plabel: humanize(a.phase) };
  }
  if (a.phase === 'pending') {
    return { lane: 'todo', cls: 'idle', plabel: a.requeues ? 'requeued' : 'queued' };
  }
  // The per-task critic loop, placed before the generic streaming fallback so
  // a fix round reads as FIXING rather than as an ordinary active card. `cls`
  // follows the canonical tone mapping: info → `ready`, active → `active`.
  if (a.phase === 'reviewing') return { lane: 'doing', cls: 'ready', plabel: 'review' };
  if (a.phase === 'fixing') return { lane: 'doing', cls: 'active', plabel: 'fixing' };
  return { lane: 'doing', cls: 'active', plabel: humanize(a.phase) };
}
