import { describe, expect, it } from 'vitest';
import { agentCardState } from './card-state.js';
import type { AgentStatus } from './types.js';

type In = Pick<AgentStatus, 'state' | 'phase' | 'errorKind' | 'merged' | 'mergeFailed'>;

const base = (partial: Partial<In>): In => ({
  state: 'idle',
  phase: 'pending',
  ...partial,
});

describe('agentCardState — the canonical kanban table (done means MERGED)', () => {
  // One row per rule, in precedence order. The web mirror
  // (src/web/card-state.test.js) pins the same table — keep them in lockstep.
  const TABLE: Array<[string, In, { column: string; label: string; tone: string }]> = [
    [
      'timeout',
      base({ state: 'error', phase: 'error', errorKind: 'timeout' }),
      { column: 'done', label: 'TIMEOUT', tone: 'warning' },
    ],
    [
      'failed',
      base({ state: 'error', phase: 'error', errorKind: 'failed' }),
      { column: 'done', label: 'FAILED', tone: 'danger' },
    ],
    [
      'paused → TODO (it is literally re-queued)',
      base({ state: 'idle', phase: 'paused' }),
      { column: 'todo', label: 'PAUSED', tone: 'warning' },
    ],
    [
      'no_changes',
      base({ state: 'done', phase: 'no_changes' }),
      { column: 'done', label: 'NO CHANGES', tone: 'warning' },
    ],
    [
      'done + mergeFailed → orphaned work, amber',
      base({ state: 'done', phase: 'done', merged: false, mergeFailed: true }),
      { column: 'done', label: 'UNMERGED', tone: 'warning' },
    ],
    [
      'done + merged:false → finished awaiting merge, DOING',
      base({ state: 'done', phase: 'done', merged: false }),
      { column: 'doing', label: 'READY', tone: 'info' },
    ],
    [
      'done + merged:true → green DONE',
      base({ state: 'done', phase: 'done', merged: true }),
      { column: 'done', label: 'DONE', tone: 'success' },
    ],
    [
      'done + merged undefined (LEGACY manifest) → renders exactly as before',
      base({ state: 'done', phase: 'done' }),
      { column: 'done', label: 'DONE', tone: 'success' },
    ],
    [
      'pending',
      base({ state: 'idle', phase: 'pending' }),
      { column: 'todo', label: 'PENDING', tone: 'neutral' },
    ],
    [
      'reviewing → DOING/REVIEW (the per-task critic is auditing the diff)',
      base({ state: 'idle', phase: 'reviewing' }),
      { column: 'doing', label: 'REVIEW', tone: 'info' },
    ],
    [
      'fixing → DOING/FIXING (blocking findings went back to the same agent)',
      base({ state: 'streaming', phase: 'fixing' }),
      { column: 'doing', label: 'FIXING', tone: 'active' },
    ],
    [
      'streaming',
      base({ state: 'streaming', phase: 'streaming' }),
      { column: 'doing', label: 'RUNNING', tone: 'active' },
    ],
    [
      'tool_running',
      base({ state: 'tool_running', phase: 'tool_running' }),
      { column: 'doing', label: 'RUNNING', tone: 'active' },
    ],
    [
      'committing (finalize pipeline)',
      base({ state: 'idle', phase: 'committing' }),
      { column: 'doing', label: 'COMMITTING', tone: 'active' },
    ],
    [
      'fallback (worktree_creating etc.) → doing',
      base({ state: 'idle', phase: 'worktree_creating' }),
      { column: 'doing', label: 'PENDING', tone: 'neutral' },
    ],
  ];

  it.each(TABLE)('%s', (_name, input, expected) => {
    expect(agentCardState(input)).toEqual(expected);
  });

  it('error beats done-flags (a failed retry of a once-merged card is FAILED)', () => {
    expect(
      agentCardState(base({ state: 'error', phase: 'error', merged: true })),
    ).toMatchObject({ label: 'FAILED' });
  });

  it('mergeFailed beats merged:true (reconciliation is idempotent, flag wins)', () => {
    expect(
      agentCardState(base({ state: 'done', phase: 'done', merged: true, mergeFailed: true })),
    ).toMatchObject({ label: 'UNMERGED', column: 'done' });
  });

  it('the provisional done-state mid-stream (state done, phase streaming) stays in DOING', () => {
    expect(agentCardState(base({ state: 'done', phase: 'streaming' }))).toMatchObject({
      column: 'doing',
    });
  });

  it('the review phases beat the raw stream state (a fix round is not RUNNING)', () => {
    // The whole reason the two rules sit above `streaming`/`tool_running`:
    // during a fix round the agent really is streaming again.
    expect(agentCardState(base({ state: 'streaming', phase: 'reviewing' })).label).toBe('REVIEW');
    expect(agentCardState(base({ state: 'tool_running', phase: 'fixing' })).label).toBe('FIXING');
  });

  it('error still beats both review phases (a critic never rescues a failed card)', () => {
    expect(
      agentCardState(base({ state: 'error', phase: 'reviewing', errorKind: 'failed' })),
    ).toMatchObject({ column: 'done', label: 'FAILED' });
    expect(
      agentCardState(base({ state: 'error', phase: 'fixing', errorKind: 'timeout' })),
    ).toMatchObject({ column: 'done', label: 'TIMEOUT' });
  });

  it('never maps READY off merged !== true — only an explicit false', () => {
    // Legacy cards (undefined) must be green DONE, not READY.
    expect(agentCardState(base({ state: 'done', phase: 'done', merged: undefined })).label).toBe(
      'DONE',
    );
  });
});
