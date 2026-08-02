import { describe, expect, it } from 'vitest';
import { nextFocusKey } from './card-focus.js';
import type { AgentStatus } from './types.js';

/**
 * Focus navigation shared by both dashboards. The invariant worth pinning: the
 * columns come from `agentCardState`, so focus lands where the BOARD actually
 * draws the card — the bug that motivated extracting this was an inline copy in
 * RunDashboard that disagreed with the kanban about `paused` cards.
 */
function agent(id: number, over: Partial<AgentStatus> = {}): AgentStatus {
  return {
    agentId: id,
    state: 'idle',
    phase: 'pending',
    stageIndex: 0,
    stageName: 's',
    currentFile: null,
    files: [],
    filesModified: [],
    logs: [],
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    pushStatus: 'pending',
    branchName: `huu/x/agent-${id}`,
    worktreePath: `/w/${id}`,
    ...over,
  } as AgentStatus;
}

const NONE = { upArrow: false, downArrow: false, leftArrow: false, rightArrow: false };
const UP = { ...NONE, upArrow: true };
const DOWN = { ...NONE, downArrow: true };
const LEFT = { ...NONE, leftArrow: true };
const RIGHT = { ...NONE, rightArrow: true };

describe('nextFocusKey', () => {
  it('returns null when there are no cards to focus', () => {
    expect(nextFocusKey(DOWN, [], null)).toBeNull();
    expect(nextFocusKey(DOWN, undefined, null)).toBeNull();
  });

  it('unset focus lands on the first card of the first non-empty column', () => {
    // Two pending (TODO) cards and one running (DOING).
    const agents = [agent(1), agent(2), agent(3, { state: 'streaming', phase: 'streaming' })];
    expect(nextFocusKey(DOWN, agents, null)).toBe('1');
  });

  it('stale focus (a card that no longer exists) re-anchors instead of sticking', () => {
    const agents = [agent(7)];
    expect(nextFocusKey(UP, agents, '999')).toBe('7');
  });

  it('moves within a column and clamps at both ends', () => {
    const agents = [agent(1), agent(2), agent(3)];
    expect(nextFocusKey(DOWN, agents, '1')).toBe('2');
    expect(nextFocusKey(DOWN, agents, '3')).toBe('3'); // clamped
    expect(nextFocusKey(UP, agents, '1')).toBe('1'); // clamped
  });

  it('crosses columns, skipping empty ones', () => {
    // TODO: 1 · DOING: (empty) · DONE: 2 — right from TODO must reach DONE.
    const agents = [
      agent(1),
      agent(2, { state: 'done', phase: 'done', merged: true, commitSha: 'abc' }),
    ];
    expect(nextFocusKey(RIGHT, agents, '1')).toBe('2');
    expect(nextFocusKey(LEFT, agents, '2')).toBe('1');
  });

  it('returns null at a horizontal edge (nothing to move to)', () => {
    const agents = [agent(1)];
    expect(nextFocusKey(LEFT, agents, '1')).toBeNull();
    expect(nextFocusKey(RIGHT, agents, '1')).toBeNull();
  });

  it('follows the board on PAUSED cards, which live in TODO not DONE', () => {
    // The exact drift that motivated the extraction: a paused card is re-queued,
    // so it must be reachable from the TODO column.
    const paused = agent(5, { phase: 'paused' });
    const running = agent(6, { state: 'streaming', phase: 'streaming' });
    // Paused sits in TODO (left of DOING) → moving right from it reaches 6.
    expect(nextFocusKey(RIGHT, [paused, running], '5')).toBe('6');
    expect(nextFocusKey(LEFT, [paused, running], '6')).toBe('5');
  });
});
