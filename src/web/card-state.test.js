import { describe, expect, it } from 'vitest';
import { agentCardState } from './client/card-state.js';

// The WEB mirror of the canonical agent-card table (src/lib/card-state.ts +
// card-state.test.ts) — the same rows, in the same precedence order, so the
// two mirrors cannot drift silently. "done means MERGED": green `done` only
// for merged (or legacy-undefined) cards; `ready` (DOING) while awaiting the
// stage merge; `unmerged` for orphaned work; `paused` goes back to TODO.

const humanize = (s) => String(s).replace(/_/g, ' ');

describe('web agentCardState mirror', () => {
  const TABLE = [
    ['timeout', { phase: 'error', errorKind: 'timeout' }, { lane: 'done', cls: 'tmo', plabel: 'timeout' }],
    ['failed', { phase: 'error', errorKind: 'failed' }, { lane: 'done', cls: 'err', plabel: 'failed' }],
    ['paused → TODO', { phase: 'paused' }, { lane: 'todo', cls: 'paused', plabel: 'paused' }],
    ['no_changes', { phase: 'no_changes' }, { lane: 'done', cls: 'done', plabel: 'no changes' }],
    [
      'done + mergeFailed → unmerged',
      { phase: 'done', merged: false, mergeFailed: true },
      { lane: 'done', cls: 'unmerged', plabel: 'unmerged' },
    ],
    [
      'done + merged:false → ready (DOING)',
      { phase: 'done', merged: false },
      { lane: 'doing', cls: 'ready', plabel: 'ready' },
    ],
    [
      'done + merged:true → green done',
      { phase: 'done', merged: true },
      { lane: 'done', cls: 'done', plabel: 'done' },
    ],
    [
      'done + merged undefined (LEGACY archive) → unchanged rendering',
      { phase: 'done' },
      { lane: 'done', cls: 'done', plabel: 'done' },
    ],
    ['pending fresh', { phase: 'pending' }, { lane: 'todo', cls: 'idle', plabel: 'queued' }],
    [
      'pending after a guard kill',
      { phase: 'pending', requeues: 2 },
      { lane: 'todo', cls: 'idle', plabel: 'requeued' },
    ],
    [
      'reviewing → DOING/review (the per-task critic is auditing the diff)',
      { phase: 'reviewing' },
      { lane: 'doing', cls: 'ready', plabel: 'review' },
    ],
    [
      'fixing → DOING/fixing (blocking findings went back to the same agent)',
      { phase: 'fixing' },
      { lane: 'doing', cls: 'active', plabel: 'fixing' },
    ],
    ['streaming', { phase: 'streaming' }, { lane: 'doing', cls: 'active', plabel: 'streaming' }],
    [
      'fallback (worktree_creating)',
      { phase: 'worktree_creating' },
      { lane: 'doing', cls: 'active', plabel: 'worktree creating' },
    ],
  ];

  for (const [name, input, expected] of TABLE) {
    it(name, () => {
      expect(agentCardState(input, humanize)).toEqual(expected);
    });
  }

  it('mergeFailed beats merged:true', () => {
    expect(agentCardState({ phase: 'done', merged: true, mergeFailed: true }).cls).toBe('unmerged');
  });

  it('never maps ready off merged !== true — only an explicit false', () => {
    expect(agentCardState({ phase: 'done', merged: undefined }).cls).toBe('done');
  });

  it('the review phases never leave DOING, however many rounds they took', () => {
    expect(agentCardState({ phase: 'reviewing', reviewRounds: 2 }).lane).toBe('doing');
    expect(agentCardState({ phase: 'fixing', reviewRounds: 2 }).lane).toBe('doing');
  });

  it('error still beats the review fields (a critic never rescues a failed card)', () => {
    expect(
      agentCardState({ phase: 'error', errorKind: 'failed', reviewRounds: 1, reviewWaived: true }),
    ).toEqual({ lane: 'done', cls: 'err', plabel: 'failed' });
  });
});
