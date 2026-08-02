/* huu web UI — pure folder-picker selection helpers (no DOM) so they
   unit-test in Node (src/web/folder-select.test.js). app.js owns the DOM,
   S.markedDirs and the /api/folders navigation; this module only decides what
   a bulk mark/unmark should do to the CURRENT listing. */

/**
 * Plan a "mark all sub-folders" toggle for the folder the picker is showing.
 *
 * Semantics (mirrors every mark-all checkbox users know): if ANY listed
 * sub-folder is still unmarked, the action marks the missing ones; only when
 * ALL of them are already marked does it flip to unmarking them. Folders
 * marked elsewhere (other directories) are never touched — `paths` only ever
 * contains entries of THIS listing, so navigation-persistent marks survive.
 *
 * @param {Set<string>|Iterable<string>} markedPaths currently marked absolute paths (S.markedDirs)
 * @param {string[]} entryPaths absolute paths of the sub-folders listed in the current directory
 * @returns {{ action: 'mark'|'unmark'|'none', paths: string[], total: number }}
 *          `action:'none'` (empty listing) means the control should be hidden/disabled;
 *          `total` = listed sub-folders, for the button label.
 */
export function markAllPlan(markedPaths, entryPaths) {
  const marked = markedPaths instanceof Set ? markedPaths : new Set(markedPaths || []);
  const entries = Array.isArray(entryPaths) ? entryPaths.filter(Boolean) : [];
  if (entries.length === 0) return { action: 'none', paths: [], total: 0 };
  const unmarked = entries.filter((p) => !marked.has(p));
  return unmarked.length > 0
    ? { action: 'mark', paths: unmarked, total: entries.length }
    : { action: 'unmark', paths: [...entries], total: entries.length };
}
