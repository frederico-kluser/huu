/* huu web UI — pure queue helpers (no DOM, no IndexedDB) so they unit-test in
   Node (see queue-util.test.js). app.js owns the DOM + run wiring; this module
   only decides which queued projects survive once the queue stops running.

   The point: a project that REACHED A TERMINAL STATE is already archived to
   History (IndexedDB, see db.js). It must then LEAVE the queue — otherwise it
   sits there as "pending" and the next "Run queue" re-runs the same pipeline. */

/** A queued project is settled once its run reached a terminal state. */
export function isSettled(status) {
  return status === 'done' || status === 'error';
}

/**
 * Decide which queued items survive once the queue stops. Settled projects
 * (done|error) are dropped — they live in History now; everything that never
 * finished is kept, so a STOPPED queue can resume its leftovers while a fully
 * FINISHED queue empties out completely.
 *
 * @param {Array<{status?: string}>} items the current queue items
 * @returns {{ keep: Array, done: number, error: number }}
 *          `keep` = items to retain (order preserved); `done`/`error` = counts
 *          of the settled items being dropped (for the finish toast).
 */
export function settleQueue(items) {
  const list = Array.isArray(items) ? items : [];
  let done = 0;
  let error = 0;
  const keep = [];
  for (const it of list) {
    if (it && it.status === 'done') done++;
    else if (it && it.status === 'error') error++;
    else keep.push(it);
  }
  return { keep, done, error };
}
