import type { AgentStatus } from './types.js';

/**
 * Canonical kanban classification for AGENT task cards — the single source of
 * truth shared by the Ink TUI (`RunKanban`/`RunDashboard` navigation) and
 * mirrored by the vanilla-JS web client (`src/web/client/card-state.js` — keep
 * the two in lockstep; `card-state.test.ts` + `web/card-state.test.js` pin the
 * same table so the mirrors can't drift silently).
 *
 * The contract this table encodes ("done means MERGED"):
 *   - Green DONE only after the task's branch actually landed in the
 *     integration worktree (`merged === true`) — or for legacy manifests that
 *     predate the flag (`merged === undefined`), which must render unchanged.
 *   - A finished-but-unmerged card (`merged === false`) is still pending work
 *     in a live run → blue READY in DOING until the stage merge lands it.
 *   - `mergeFailed` marks orphaned work (committed on the agent branch, never
 *     integrated) → amber UNMERGED in the terminal column.
 *   - `paused` (memory-guard preemption) is literally re-queued
 *     (`pendingTasks`) → TODO, like the kill-requeue path, amber PAUSED.
 *   - `reviewing` / `fixing` (the per-task critic loop) are still DOING — the
 *     task is neither queued nor finished — but they outrank the raw stream
 *     state so a fix round doesn't render as an ordinary RUNNING card.
 */

export type CardColumn = 'todo' | 'doing' | 'done';

/**
 * Semantic tone — each front-end maps it to its own palette:
 * TUI: neutral=gray, active=cyan, success=green, warning=yellow, danger=red,
 * info=theme.info (blue). Web: the `cls` on `.phase`.
 */
export type CardTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger' | 'info';

export interface AgentCardState {
  column: CardColumn;
  label: string;
  tone: CardTone;
}

type CardStateInput = Pick<
  AgentStatus,
  'state' | 'phase' | 'errorKind' | 'merged' | 'mergeFailed'
>;

/** First matching rule wins — see the module doc for the semantics. */
export function agentCardState(s: CardStateInput): AgentCardState {
  if (s.state === 'error' && s.errorKind === 'timeout') {
    return { column: 'done', label: 'TIMEOUT', tone: 'warning' };
  }
  if (s.state === 'error') return { column: 'done', label: 'FAILED', tone: 'danger' };
  // Paused before the done rules: a paused card is idle/paused, never
  // state==='done', but keeping it high makes the precedence explicit.
  if (s.phase === 'paused') return { column: 'todo', label: 'PAUSED', tone: 'warning' };
  if (s.phase === 'no_changes') return { column: 'done', label: 'NO CHANGES', tone: 'warning' };
  if (s.state === 'done' && s.phase === 'done') {
    if (s.mergeFailed) return { column: 'done', label: 'UNMERGED', tone: 'warning' };
    if (s.merged === false) return { column: 'doing', label: 'READY', tone: 'info' };
    // merged === true, or undefined (legacy manifest / IndexedDB archive).
    return { column: 'done', label: 'DONE', tone: 'success' };
  }
  if (s.phase === 'pending') return { column: 'todo', label: 'PENDING', tone: 'neutral' };
  // Review phases sit BETWEEN `pending` and the raw stream states on purpose.
  // During a fix round the agent is genuinely streaming again, so the raw
  // state would say RUNNING and the card would hide the fact that it is on
  // its second (or third) pass through a critic. The phase wins.
  if (s.phase === 'reviewing') return { column: 'doing', label: 'REVIEW', tone: 'info' };
  if (s.phase === 'fixing') return { column: 'doing', label: 'FIXING', tone: 'active' };
  if (s.state === 'streaming' || s.state === 'tool_running') {
    return { column: 'doing', label: 'RUNNING', tone: 'active' };
  }
  if (
    s.phase === 'finalizing' ||
    s.phase === 'committing' ||
    s.phase === 'cleaning_up' ||
    s.phase === 'pushing'
  ) {
    return { column: 'doing', label: s.phase.toUpperCase(), tone: 'active' };
  }
  return { column: 'doing', label: 'PENDING', tone: 'neutral' };
}
