/* DOM-free ordering for the run-board kanban. A card that CHANGED lane floats
   to its destination lane's FIRST slot (newest mover on top); brand-new cards
   keep natural (insertion) order and sit below the movers. Pure and keyed only
   by card.key, so it unit-tests in Node with no DOM (see board-order.test.js).
   app.js owns the DOM reconcile + FLIP animation; this module only decides the
   ORDER and flags which cards just moved. */

export function createBoardOrder(lanes = ['todo', 'doing', 'done']) {
  const lane = new Map();   // key -> last placed lane
  const rank = new Map();   // key -> sort rank (lower = nearer the top of its lane)
  let up = 0;               // ascending (positive): natural order for new cards
  let down = 0;             // descending (negative): movers sort above all naturals

  return {
    rankOf: (key) => rank.get(key),
    laneOf: (key) => lane.get(key),
    /** Forget everything — call when the run changes (keys repeat across runs). */
    reset() { lane.clear(); rank.clear(); up = 0; down = 0; },
    /** Drop a card that left the board so its rank can't resurrect it. */
    drop(key) { lane.delete(key); rank.delete(key); },
    /**
     * @param cards [{ key, lane }] with lane already one of `lanes`.
     * @returns { movers:Set<key>, byLane:{ lane: cards[] } } each lane sorted.
     */
    place(cards) {
      const movers = new Set();
      for (const c of cards) {
        const prev = lane.get(c.key);
        if (prev === undefined) { if (!rank.has(c.key)) rank.set(c.key, ++up); }
        else if (prev !== c.lane) { rank.set(c.key, --down); movers.add(c.key); }
        lane.set(c.key, c.lane);
      }
      const byLane = {};
      for (const l of lanes) byLane[l] = [];
      for (const c of cards) (byLane[c.lane] || (byLane[c.lane] = [])).push(c);
      for (const l of Object.keys(byLane)) byLane[l].sort((a, b) => rank.get(a.key) - rank.get(b.key));
      return { movers, byLane };
    },
  };
}
