/* huu web UI — run history persistence (IndexedDB) + export.

   The browser is the system of record for run history, mirroring how API keys
   already live only in the browser (sessionStorage). A finished project run is
   archived here with every card and its cost; the whole history is exportable
   as one JSON file.

   Split out from app.js on purpose: the record BUILDERS and the EXPORT
   serializer are pure (no DOM, no IndexedDB) so they can be exercised in Node.
   Only the persistence helpers and downloadText() touch browser-only globals,
   and they do so lazily inside the function bodies — importing this module in a
   non-browser context is safe as long as you call only the pure helpers. */

import { substituteFileInTitle } from './title-util.js';

const DB_NAME = 'huu';
const DB_VERSION = 1;
const STORE = 'runs';

/* ---------------- IndexedDB (browser-only; lazy) ---------------- */

/** Open (and migrate) the history database. Rejects when IndexedDB is absent. */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser/context'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        // Listed newest-first in the History panel; queryable per queue run.
        os.createIndex('archivedAt', 'archivedAt');
        os.createIndex('queueId', 'queue.id');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  const t = db.transaction(STORE, mode);
  return { store: t.objectStore(STORE), done: txDone(t) };
}
function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Persist (insert or replace) one history record. */
export async function saveRun(record) {
  const db = await openDb();
  try {
    const { store, done } = tx(db, 'readwrite');
    store.put(record);
    await done;
  } finally {
    db.close();
  }
}

/** All history records, newest archived first. */
export async function listRuns() {
  const db = await openDb();
  try {
    const { store } = tx(db, 'readonly');
    const all = await reqAsPromise(store.getAll());
    return all.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  } finally {
    db.close();
  }
}

/** Delete one record by id. */
export async function deleteRun(id) {
  const db = await openDb();
  try {
    const { store, done } = tx(db, 'readwrite');
    store.delete(id);
    await done;
  } finally {
    db.close();
  }
}

/** Wipe the entire history. */
export async function clearRuns() {
  const db = await openDb();
  try {
    const { store, done } = tx(db, 'readwrite');
    store.clear();
    await done;
  } finally {
    db.close();
  }
}

/* ---------------- Pure record builders (no DOM / no IndexedDB) ---------------- */

/** Best-effort unique id; deterministic callers should pass an id instead. */
export function uid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return 'r-' + Math.abs(hashStr(String(Date.now()) + ':' + Math.floor(performanceNow() * 1e6))).toString(36);
}
function performanceNow() {
  try { return typeof performance !== 'undefined' ? performance.now() : 0; } catch { return 0; }
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

/**
 * Normalize an OrchestratorState into a flat, export-friendly card list.
 * Per-card cost exists only for agents; merge/judge LLM cost is folded into
 * the run's totalCost (the orchestrator does not meter them per-card), so
 * those cards carry cost: null to be honest about it.
 */
export function buildHistoryCards(state) {
  const st = state || {};
  const cards = [];
  for (const a of st.agents || []) {
    const file = a.currentFile || (a.filesModified && a.filesModified[0]) || '';
    cards.push({
      kind: 'agent',
      id: a.agentId,
      // Resolve the `$file` fan-out token to the worked file's name for display.
      title: substituteFileInTitle(a.stageName || ('Task ' + a.agentId), file),
      phase: a.phase || a.state || '',
      file,
      tokensIn: num(a.tokensIn),
      tokensOut: num(a.tokensOut),
      cacheReadTokens: num(a.cacheReadTokens),
      cacheWriteTokens: num(a.cacheWriteTokens),
      cost: num(a.cost),
      requeues: num(a.requeues),
      branchName: a.branchName || '',
      commitSha: a.commitSha || '',
      filesModified: a.filesModified || [],
      pushStatus: a.pushStatus || '',
      error: a.error || '',
    });
  }
  for (const m of st.stageIntegrations || []) {
    cards.push({
      kind: 'merge',
      id: 'm' + m.visitIndex,
      title: 'Merge · ' + substituteFileInTitle(m.stageName || '', null),
      phase: m.phase || '',
      runs: num(m.runs) || 1,
      cost: null, // not metered per-card; counted in totalCost
      modelId: m.modelId || '',
      resolverUsed: !!m.resolverUsed,
      branchesMerged: (m.branchesMerged || []).length,
      conflicts: (m.conflicts || []).length,
      error: m.error || '',
    });
  }
  for (const j of st.checkRuns || []) {
    cards.push({
      kind: 'judge',
      id: 'j' + j.visitIndex,
      title: 'Judge · ' + substituteFileInTitle(j.stepName || '', null),
      phase: j.phase || '',
      runs: num(j.runs) || 1,
      cost: null, // not metered per-card; counted in totalCost
      modelId: j.modelId || '',
      outcomeLabel: j.outcomeLabel || '',
      nextStepName: j.nextStepName || '',
      fromJudge: j.fromJudge !== false,
      condition: j.condition || '',
      error: j.error || '',
    });
  }
  return cards;
}

/** Roll up counts + the summed per-card (agent) cost. */
export function summarizeCards(cards) {
  let agents = 0, merges = 0, judges = 0, cardCostSum = 0;
  for (const c of cards) {
    if (c.kind === 'agent') { agents++; cardCostSum += num(c.cost); }
    else if (c.kind === 'merge') merges++;
    else if (c.kind === 'judge') judges++;
  }
  return { counts: { agents, merges, judges, total: cards.length }, cardCostSum };
}

/**
 * Build a history record from a settled run snapshot + the queue item that
 * produced it. `run` is the SSE snapshot the server serializes
 * (phase/runId/pipelineName/modelId/startedAt/finishedAt/errorReason/state).
 */
export function buildRunRecord({ run, item, archivedAt }) {
  const st = run.state || {};
  const cards = buildHistoryCards(st);
  const { counts, cardCostSum } = summarizeCards(cards);
  const startedAt = num(run.startedAt) || num(st.startedAt);
  const finishedAt = num(run.finishedAt);
  const elapsedMs = finishedAt && startedAt ? finishedAt - startedAt : num(st.elapsedMs);
  return {
    schema: 'huu-history-run-v1',
    id: run.runId || uid(),
    runId: run.runId || '',
    pipelineName: run.pipelineName || (item && item.pipelineName) || '',
    provider: (item && item.provider) || '',
    backend: (item && item.backend) || '',
    modelId: run.modelId || (item && item.modelId) || '',
    modelLabel: (item && item.modelLabel) || run.modelId || (item && item.modelId) || '',
    runDirectory: (item && item.runDirectory) || '',
    mode: (item && item.mode) || '',
    timeoutMinutes: (item && item.timeoutMinutes) || null,
    status: run.phase === 'done' ? 'done' : 'error',
    errorReason: run.errorReason || null,
    startedAt,
    finishedAt,
    elapsedMs,
    totalCost: num(st.totalCost),
    cardCostSum,
    completedTasks: num(st.completedTasks),
    totalTasks: num(st.totalTasks),
    counts,
    cards,
    queue: item && item.queue ? item.queue : null,
    archivedAt: num(archivedAt) || 0,
  };
}

/**
 * Build a record for a project that could not even START (e.g. its provider's
 * key isn't in this browser session, or the server rejected the launch). Keeps
 * the failure in the history so the sequence is auditable end to end.
 */
export function buildSyntheticRecord({ item, errorReason, archivedAt }) {
  return {
    schema: 'huu-history-run-v1',
    id: uid(),
    runId: '',
    pipelineName: (item && item.pipelineName) || '',
    provider: (item && item.provider) || '',
    backend: (item && item.backend) || '',
    modelId: (item && item.modelId) || '',
    modelLabel: (item && item.modelLabel) || (item && item.modelId) || '',
    runDirectory: (item && item.runDirectory) || '',
    mode: (item && item.mode) || '',
    timeoutMinutes: (item && item.timeoutMinutes) || null,
    status: 'error',
    errorReason: errorReason || 'Failed to start',
    startedAt: num(archivedAt),
    finishedAt: num(archivedAt),
    elapsedMs: 0,
    totalCost: 0,
    cardCostSum: 0,
    completedTasks: 0,
    totalTasks: 0,
    counts: { agents: 0, merges: 0, judges: 0, total: 0 },
    cards: [],
    queue: item && item.queue ? item.queue : null,
    archivedAt: num(archivedAt) || 0,
  };
}

/**
 * Serialize history records into the export envelope. Pure: returns the
 * filename + text so callers (browser) or tests (Node) can do what they want
 * with it. Project total = totalCost; per-card costs live under each card.
 */
export function exportRunsJson(records, now) {
  const list = records || [];
  const grandTotal = list.reduce((s, r) => s + num(r.totalCost), 0);
  const envelope = {
    schema: 'huu-history-v1',
    exportedAt: now || 0,
    runCount: list.length,
    grandTotalCost: grandTotal,
    runs: list,
  };
  const text = JSON.stringify(envelope, null, 2);
  const stamp = stampFromMs(now || 0);
  return { filename: `huu-history-${stamp}.json`, text };
}

/** YYYYMMDD-HHMMSS from an epoch-ms value (UTC). 0 → 'export'. */
function stampFromMs(ms) {
  if (!ms) return 'export';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    '-' +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

/* ---------------- DOM helper (browser-only) ---------------- */

/** Trigger a client-side download of `text` as `filename`. */
export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has committed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
