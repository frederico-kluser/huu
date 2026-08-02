/**
 * Arrow-key navigation across the kanban's agent cards — pure, so BOTH the
 * single-run and multi-run dashboards drive focus through one implementation.
 *
 * Column grouping delegates to {@link agentCardState}, the same canonical table
 * the board renders from. That coupling is the point: an inline copy of the
 * mapping used to live in `RunDashboard` and had already drifted from the board
 * on `paused` cards, so the arrows moved focus to a card that wasn't there.
 */

import { agentCardState } from './card-state.js';
import type { AgentStatus } from './types.js';

export interface FocusDirection {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
}

/**
 * The card key focus should move to, or `null` for "don't change" — no cards, or
 * an edge press (left at the leftmost column) that has nowhere to go. Keys are
 * `String(agentId)`, matching what the kanban uses.
 *
 * Stale/unset focus lands on the first card of the first non-empty column, so a
 * board that only just produced its first card is immediately navigable.
 */
export function nextFocusKey(
  key: FocusDirection,
  agents: readonly AgentStatus[] | undefined,
  currentKey: string | null,
): string | null {
  if (!agents || agents.length === 0) return null;

  const todo: string[] = [];
  const doing: string[] = [];
  const done: string[] = [];
  for (const a of agents) {
    const id = String(a.agentId);
    const column = agentCardState(a).column;
    if (column === 'done') done.push(id);
    else if (column === 'todo') todo.push(id);
    else doing.push(id);
  }
  const cols = [todo, doing, done];

  let curCol = -1;
  let curRow = -1;
  for (let c = 0; c < cols.length; c++) {
    const idx = cols[c]!.indexOf(currentKey ?? '');
    if (idx !== -1) {
      curCol = c;
      curRow = idx;
      break;
    }
  }

  if (curCol === -1) {
    for (const col of cols) {
      if (col.length > 0) return col[0]!;
    }
    return null;
  }

  if (key.upArrow) return cols[curCol]![Math.max(0, curRow - 1)]!;
  if (key.downArrow) {
    const colCards = cols[curCol]!;
    return colCards[Math.min(colCards.length - 1, curRow + 1)]!;
  }
  if (key.leftArrow) {
    for (let c = curCol - 1; c >= 0; c--) {
      const cards = cols[c]!;
      if (cards.length > 0) return cards[Math.min(curRow, cards.length - 1)]!;
    }
    return null;
  }
  if (key.rightArrow) {
    for (let c = curCol + 1; c < cols.length; c++) {
      const cards = cols[c]!;
      if (cards.length > 0) return cards[Math.min(curRow, cards.length - 1)]!;
    }
    return null;
  }
  return null;
}
