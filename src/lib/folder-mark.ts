/**
 * Pure multi-folder marking decisions for the project pickers — the typed
 * counterpart of the web client's `src/web/client/folder-select.js`
 * (`markAllPlan`), consumed by the Ink `DirectoryPicker` in multi-mark mode.
 *
 * Twinned rather than shared for the same reason as `card-state.ts` ↔
 * `card-state.js`: the browser client is vanilla ES modules served raw and
 * cannot import TypeScript. `folder-mark.test.ts` pins the two behaviors to the
 * same table so they can't drift.
 *
 * Pure + leaf: no fs, no DOM. The caller owns the marked set and the listing.
 */

/**
 * What a bulk mark/unmark should do to the listing currently on screen.
 *
 * `action: 'none'` (empty listing) means the control should be hidden — there is
 * nothing to bulk-toggle. `total` is the listed sub-folder count, for the label.
 */
export interface MarkAllPlan {
  action: 'mark' | 'unmark' | 'none';
  /** The paths to add to (or remove from) the marked set. */
  paths: string[];
  /** Sub-folders in the current listing. */
  total: number;
}

/**
 * Plan a "mark all sub-folders" toggle for the folder the picker is showing.
 *
 * Semantics (the mark-all checkbox everyone already knows): while ANY listed
 * sub-folder is unmarked, the action marks the missing ones; only once ALL of
 * them are marked does it flip to unmarking. Folders marked ELSEWHERE are never
 * touched — `entryPaths` only ever holds this listing's entries, which is what
 * lets marks survive navigation.
 */
export function markAllPlan(
  markedPaths: Iterable<string>,
  entryPaths: readonly string[],
): MarkAllPlan {
  const marked = markedPaths instanceof Set ? markedPaths : new Set(markedPaths);
  const entries = entryPaths.filter(Boolean);
  if (entries.length === 0) return { action: 'none', paths: [], total: 0 };
  const unmarked = entries.filter((p) => !marked.has(p));
  return unmarked.length > 0
    ? { action: 'mark', paths: unmarked, total: entries.length }
    : { action: 'unmark', paths: [...entries], total: entries.length };
}

/**
 * Apply a plan to a marked set, returning a NEW set (the caller keeps its own
 * state immutable so React re-renders see a fresh identity).
 */
export function applyMarkAll(
  markedPaths: Iterable<string>,
  plan: MarkAllPlan,
): Set<string> {
  const next = new Set(markedPaths);
  if (plan.action === 'mark') for (const p of plan.paths) next.add(p);
  else if (plan.action === 'unmark') for (const p of plan.paths) next.delete(p);
  return next;
}

/** Toggle ONE path in a marked set, returning a NEW set. */
export function toggleMark(markedPaths: Iterable<string>, path: string): Set<string> {
  const next = new Set(markedPaths);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}
