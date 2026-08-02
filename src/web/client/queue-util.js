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
 * Re-link a restored queue to the server's tracked runs after a page refresh.
 *
 * The queue-runner's tracking (running/live/processed/settled) is memory-only;
 * before this existed a mid-queue refresh orphaned it — no more archiving, no
 * queue completion, and every chip reset to 'pending' with "Run queue" armed
 * against projects still running server-side. The persisted v2 items carry
 * `status` + `runId`, and the server keeps every non-terminal run alive
 * (fire-and-forget), so the linkage is reconstructible:
 *
 *  - runId matches a tracked run → adopt its phase. Terminal → mark for
 *    re-archive (the IndexedDB put is idempotent by runId) and count settled;
 *    non-terminal → back into the live set.
 *  - runId the server no longer tracks → non-terminal runs are never pruned,
 *    so the huu server restarted (or a >100-terminal prune) → `orphaned`
 *    (status 'error'; caller archives a synthetic record).
 *  - no runId but status queued/running → the refresh ate the POST response.
 *    The server registers the queued snapshot BEFORE responding, so adopt a
 *    matching UNCLAIMED non-terminal run by (runDirectory, pipelineName) —
 *    each run claimable once. Terminal runs are deliberately NOT matched
 *    (stale done-runs for the same project are common across queue
 *    executions); unmatched items go to `resume` for a fresh dispatch.
 *  - status 'pending' (never dispatched) → untouched.
 *
 * Pure + DOM-free; input items are copied, never mutated.
 *
 * @param {Array<{ runId?: string|null, status?: string, runDirectory?: string, pipelineName?: string }>} items
 * @param {Array<{ runId?: string, phase?: string, runDirectory?: string, pipelineName?: string }>} runs
 * @returns {{
 *   items: Array<object>,
 *   running: boolean,
 *   live: Array<[string, number]>,
 *   processed: string[],
 *   settledCount: number,
 *   rearchive: number[],
 *   orphaned: number[],
 *   resume: number[],
 * }}
 */
export function relinkQueue(items, runs) {
  const list = Array.isArray(items) ? items : [];
  const snaps = Array.isArray(runs) ? runs : [];
  const byId = new Map();
  for (const r of snaps) if (r && r.runId) byId.set(r.runId, r);
  const claimed = new Set();
  const live = [];
  const processed = [];
  const rearchive = [];
  const orphaned = [];
  const resume = [];
  let settledCount = 0;
  const out = list.map((it) => ({ ...it }));

  // Pass 1 — exact runId link.
  out.forEach((it, i) => {
    if (!it || !it.runId) return;
    const run = byId.get(it.runId);
    if (run && !claimed.has(it.runId)) {
      claimed.add(it.runId);
      if (isSettled(run.phase)) {
        it.status = run.phase;
        processed.push(it.runId);
        rearchive.push(i);
        settledCount++;
      } else {
        it.status = run.phase === 'queued' ? 'queued' : 'running';
        live.push([it.runId, i]);
      }
    } else {
      it.status = 'error';
      orphaned.push(i);
      settledCount++;
    }
  });

  // Pass 2 — dispatch was initiated but the runId never landed.
  out.forEach((it, i) => {
    if (!it || it.runId || (it.status !== 'queued' && it.status !== 'running')) return;
    const match = snaps.find(
      (r) =>
        r && r.runId && !claimed.has(r.runId) && !isSettled(r.phase) &&
        r.runDirectory === it.runDirectory && r.pipelineName === it.pipelineName,
    );
    if (match) {
      claimed.add(match.runId);
      it.runId = match.runId;
      it.status = match.phase === 'queued' ? 'queued' : 'running';
      live.push([match.runId, i]);
    } else {
      it.status = 'queued';
      resume.push(i);
    }
  });

  return {
    items: out,
    running: live.length > 0 || resume.length > 0,
    live,
    processed,
    settledCount,
    rearchive,
    orphaned,
    resume,
  };
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
