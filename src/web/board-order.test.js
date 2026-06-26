import { describe, expect, it } from 'vitest';
import { createBoardOrder } from './client/board-order.js';

// Pure, DOM-free ordering for the run-board kanban. The browser app.js feeds it
// the live card set each SSE frame; here we lock the ordering contract the FLIP
// animation depends on — most importantly: a card that changes lane lands at the
// destination's FIRST slot.

const keysOf = (cards) => cards.map((c) => c.key);

describe('createBoardOrder', () => {
  it('keeps brand-new cards in natural insertion order', () => {
    const ord = createBoardOrder();
    const { byLane, movers } = ord.place([
      { key: 'a1', lane: 'todo' },
      { key: 'a2', lane: 'todo' },
      { key: 'a3', lane: 'todo' },
    ]);
    expect(keysOf(byLane.todo)).toEqual(['a1', 'a2', 'a3']);
    expect(movers.size).toBe(0); // first sighting is not a "move"
  });

  it('floats a card that changed lane to the FIRST slot of the destination', () => {
    const ord = createBoardOrder();
    ord.place([
      { key: 'a1', lane: 'doing' },
      { key: 'a2', lane: 'doing' },
      { key: 'a3', lane: 'doing' },
    ]);
    // a3 finishes -> moves to done; a1/a2 stay in doing.
    const { byLane, movers } = ord.place([
      { key: 'a1', lane: 'doing' },
      { key: 'a2', lane: 'doing' },
      { key: 'a3', lane: 'done' },
    ]);
    expect(keysOf(byLane.done)).toEqual(['a3']);
    expect(movers.has('a3')).toBe(true);
    expect(movers.has('a1')).toBe(false);
    // Now a1 also finishes -> it must land ABOVE the already-done a3.
    const r2 = ord.place([
      { key: 'a1', lane: 'done' },
      { key: 'a2', lane: 'doing' },
      { key: 'a3', lane: 'done' },
    ]);
    expect(keysOf(r2.byLane.done)).toEqual(['a1', 'a3']); // newest mover first
    expect(r2.movers.has('a1')).toBe(true);
  });

  it('stacks successive movers newest-first while leaving naturals below', () => {
    const ord = createBoardOrder();
    // d1,d2 already sitting in done as naturals (first sighting there).
    ord.place([{ key: 'd1', lane: 'done' }, { key: 'd2', lane: 'done' }, { key: 'm', lane: 'todo' }]);
    // m moves todo -> done: it tops the lane, naturals keep their order below.
    const { byLane } = ord.place([{ key: 'd1', lane: 'done' }, { key: 'd2', lane: 'done' }, { key: 'm', lane: 'done' }]);
    expect(keysOf(byLane.done)).toEqual(['m', 'd1', 'd2']);
  });

  it('a card that stays put does not move when another floats above it', () => {
    const ord = createBoardOrder();
    ord.place([{ key: 'x', lane: 'doing' }, { key: 'y', lane: 'todo' }]);
    // y -> doing: lands above x, x keeps its (lower) position.
    const { byLane } = ord.place([{ key: 'x', lane: 'doing' }, { key: 'y', lane: 'doing' }]);
    expect(keysOf(byLane.doing)).toEqual(['y', 'x']);
  });

  it('a re-queued card (back to todo) floats to the top of todo', () => {
    const ord = createBoardOrder();
    ord.place([{ key: 'p1', lane: 'todo' }, { key: 'p2', lane: 'todo' }, { key: 'r', lane: 'doing' }]);
    // r is killed and re-queued -> doing back to todo: tops the todo column.
    const { byLane, movers } = ord.place([{ key: 'p1', lane: 'todo' }, { key: 'p2', lane: 'todo' }, { key: 'r', lane: 'todo' }]);
    expect(keysOf(byLane.todo)).toEqual(['r', 'p1', 'p2']);
    expect(movers.has('r')).toBe(true);
  });

  it('reset() forgets all state so repeated run keys are not seen as movers', () => {
    const ord = createBoardOrder();
    ord.place([{ key: 'a1', lane: 'done' }]); // run 1 ended with a1 in done
    ord.reset();
    // Run 2 reuses key a1, now pending in todo. Must be a NEW card, not a mover.
    const { byLane, movers } = ord.place([{ key: 'a1', lane: 'todo' }]);
    expect(keysOf(byLane.todo)).toEqual(['a1']);
    expect(movers.size).toBe(0);
  });

  it('drop() removes a card so a stale rank cannot resurrect its position', () => {
    const ord = createBoardOrder();
    ord.place([{ key: 'a1', lane: 'doing' }, { key: 'a2', lane: 'doing' }]);
    ord.drop('a1');
    expect(ord.rankOf('a1')).toBeUndefined();
    expect(ord.laneOf('a1')).toBeUndefined();
    // a2 unaffected.
    expect(ord.laneOf('a2')).toBe('doing');
  });

  it('always returns all configured lanes, even when empty', () => {
    const ord = createBoardOrder();
    const { byLane } = ord.place([{ key: 'a1', lane: 'doing' }]);
    expect(byLane.todo).toEqual([]);
    expect(byLane.done).toEqual([]);
    expect(keysOf(byLane.doing)).toEqual(['a1']);
  });
});
