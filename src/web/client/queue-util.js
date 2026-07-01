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

/**
 * Tally a queue's items by status — drives the launch-view "running" indicator
 * (shown while the user is back on home adding more projects to a live queue).
 * Pure + DOM-free so it unit-tests in Node. `settled` = done + error (terminal,
 * already archived to History); `running` counts in-flight runs; `pending`
 * counts items not yet dispatched.
 *
 * @param {Array<{status?: string}>} items the current queue items
 * @returns {{ total: number, done: number, error: number, running: number, pending: number, settled: number }}
 */
export function summarizeQueue(items) {
  const list = Array.isArray(items) ? items : [];
  let done = 0;
  let error = 0;
  let running = 0;
  let pending = 0;
  for (const it of list) {
    const s = it && it.status;
    if (s === 'done') done++;
    else if (s === 'error') error++;
    else if (s === 'running') running++;
    else pending++;
  }
  return { total: list.length, done, error, running, pending, settled: done + error };
}

/**
 * Normalize the launch-form "max time per agent" input into a positive integer
 * number of MINUTES, or `undefined` when blank/invalid. One value covers the
 * WHOLE pipeline: the server's `applyTimeout` maps it onto every card timeout
 * (multi-file AND single-file), and `undefined` leaves the pipeline's built-in
 * defaults untouched — so an empty field means "use the pipeline default".
 *
 * @param {string|number|null|undefined} raw the raw input value
 * @returns {number|undefined} a positive integer minutes, or undefined
 */
export function parseTimeoutMinutes(raw) {
  if (raw == null) return undefined;
  const n = Math.floor(Number(String(raw).trim()));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * The queue grouping key for one item. Items that were fanned out from the same
 * (pipeline + config) batch share a `groupId`; legacy items persisted before the
 * cart flow carry none, so they fall back to a per-item key (each becomes its own
 * singleton group — never merged with unrelated items).
 *
 * @param {{ groupId?: string, id?: string }|null|undefined} item
 * @returns {string}
 */
export function queueGroupKey(item) {
  if (!item) return '';
  if (item.groupId) return item.groupId;
  return 'item:' + (item.id != null ? item.id : '');
}

/**
 * Fan ONE captured config out over N marked project directories → N queue items.
 * The base config (pipeline name, model, provider, concurrency, timeout) is
 * shared; only `runDirectory` varies, and each item gets a fresh id + the shared
 * `groupId` so the queue can render them grouped under their pipeline. Pure +
 * DOM-free (id generation is injected) so it unit-tests in Node.
 *
 * @param {object} base the per-pipeline config snapshot (from captureFormConfig)
 * @param {string[]} dirs absolute project paths to target
 * @param {string} groupId the shared batch id stamped on every produced item
 * @param {() => string} mkId a fresh-id factory called once per item
 * @returns {Array<object>} one item per dir: { ...base, id, runDirectory, groupId, status:'pending' }
 */
export function fanOutBatch(base, dirs, groupId, mkId) {
  const list = Array.isArray(dirs) ? dirs : [];
  const make = typeof mkId === 'function' ? mkId : () => undefined;
  return list.map((dir) => ({ ...base, id: make(), runDirectory: dir, groupId, status: 'pending' }));
}

/**
 * Group a flat queue into ordered per-batch groups for rendering. Groups appear
 * in the order their FIRST item appears (which is dispatch order = priority), and
 * item order within a group is preserved. Purely presentational — the underlying
 * flat array order (and thus `priority: index` at dispatch) is untouched.
 *
 * @param {Array<{ groupId?: string, id?: string, pipelineName?: string }>} items
 * @returns {Array<{ groupId: string, pipelineName: string, items: Array }>}
 */
export function groupQueueItems(items) {
  const list = Array.isArray(items) ? items : [];
  const order = [];
  const byKey = new Map();
  for (const it of list) {
    const key = queueGroupKey(it);
    let g = byKey.get(key);
    if (!g) {
      g = { groupId: key, pipelineName: (it && it.pipelineName) || '', items: [] };
      byKey.set(key, g);
      order.push(g);
    }
    g.items.push(it);
  }
  return order;
}
