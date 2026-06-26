/* huu web UI — vanilla ES module. Real-time over one SSE stream, actions over
   fetch POSTs. No framework, no build, no CDN: works offline and in Docker. */

import {
  saveRun, listRuns, deleteRun, clearRuns,
  buildRunRecord, buildSyntheticRecord, exportRunsJson, downloadText, uid,
} from './db.js';
import { createBoardOrder } from './board-order.js';
import { settleQueue } from './queue-util.js';

const $ = (id) => document.getElementById(id);

// Canonical default model — mirrors DEFAULT_MODEL_ID in src/models/catalog.ts
// (the client is vanilla JS with no build, so it can't import the TS constant).
// Preselected when the user hasn't picked a model and it's in the loaded list;
// otherwise we fall back to the first model the catalog returned.
const DEFAULT_MODEL_ID = 'deepseek/deepseek-v4-flash';

const TOKEN = new URLSearchParams(location.search).get('token') || '';
const withTok = (url) => (TOKEN ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN) : url);

async function api(path, opts = {}) {
  // Merge caller headers (e.g. x-huu-key) on top of the defaults instead of
  // letting `...opts` clobber the header object and drop the token header.
  const { headers: extra, ...rest } = opts;
  const res = await fetch(withTok(path), {
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { 'x-huu-token': TOKEN } : {}),
      ...extra,
    },
    ...rest,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------------- Theme ---------------- */
const THEMES = ['auto', 'light', 'dark'];
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('themeBtn').querySelector('use').setAttribute('href', t === 'light' ? '#ic-sun' : t === 'dark' ? '#ic-moon' : '#ic-auto');
  localStorage.setItem('huu.theme', t);
}
applyTheme(localStorage.getItem('huu.theme') || 'auto');
$('themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || 'auto';
  applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
});

/* ---------------- App state ---------------- */
const S = {
  boot: null,
  pipelines: [],
  selectedPipe: null,
  provider: 'openrouter',     // user-facing choice (openrouter | azure)
  providers: [],
  backend: 'pi',              // dispatch backend derived from provider
  runDir: '',                 // chosen run directory (default = server cwd)
  cwd: '',
  models: [],
  modelId: '',
  modelSource: 'recommended', // 'openrouter-live' once loaded with a key
  mode: 'auto',
  manualN: 10,
  keyStatus: { ok: true, missing: [] },
  run: { phase: 'idle' },     // the ACTIVE (viewed) run — a pointer into `runs`
  runs: new Map(),            // runId -> snapshot (every concurrent run)
  activeRunId: null,          // which run the board/log/metrics show
  openCardKey: null,
  // --- /simulation mode (synthetic demo run; no branches, no key) ---
  sim: false,
  simModels: [],
  simSuggest: [],
  simFiles: 12,
  simAgents: 6,
  simPaused: false,
  lastSim: null,
  logOpen: false,
  /* Project queue. Each item carries its OWN config. On start ALL items are
     dispatched at once and run CONCURRENTLY under one server-side scheduler
     (priority = dispatch order; later items backfill earlier ones). Finished
     runs are archived to IndexedDB (see db.js). The queue config (no keys) is
     mirrored to localStorage so a half-built queue survives a reload. */
  queue: {
    items: [],          // [{ id, pipelineName, provider, backend, modelId, modelLabel, providerLabel, mode, concurrency, runDirectory, status, runId }]
    running: false,
    live: null,         // Map<runId, item> — runs still in flight
    settled: 0,         // how many items have reached a terminal state
    processed: null,    // Set<runId> already archived (guards SSE replay)
    stopping: false,    // a Stop-queue is in progress
    editingId: null,    // item being edited back in the form
    id: '',             // id shared by all runs of one queue execution
  },
};

/* ---------------- Browser-only API keys ----------------
   The user's key never touches disk. We validate it server-side, keep it in
   THIS browser's sessionStorage (gone when the tab closes), and send it with
   every /api/run. The server uses it in memory only. */
const keyStoreName = (name) => 'huu.key.' + name;
function sessionKey(name) {
  if (!name) return '';
  try { return sessionStorage.getItem(keyStoreName(name)) || ''; } catch { return ''; }
}
function setSessionKey(name, value) {
  if (!name) return;
  try { sessionStorage.setItem(keyStoreName(name), value); } catch {}
}
/** Registry name of a backend's primary credential (e.g. 'openrouter'). */
function backendSpecName(id) {
  const b = ((S.boot && S.boot.backends) || []).find((x) => x.id === id);
  return b ? b.apiKeySpecName : undefined;
}

/* ---------------- Provider helpers ---------------- */
function providerInfoById(id) {
  return (S.providers || []).find((p) => p.id === id) || null;
}
function providerBackend(id) {
  const p = providerInfoById(id);
  return p ? p.backend : id === 'azure' ? 'azure' : 'pi';
}
/** Ready if the server resolves every credential (env/mount/disk) OR we hold
    each one in THIS browser session. */
function providerReady(p) {
  if (!p) return false;
  if (p.hasKey) return true;
  const specs = p.keySpecs || [];
  return specs.length > 0 && specs.every((s) => sessionKey(s.name));
}


const PIPE_ICONS = { test: '✓', audit: '◎', security: '🛡', performance: '⚡', docs: '✦', quality: '◆', refactor: '↻', knowledge: '✸' };
function pipeIcon(name) {
  const n = name.toLowerCase();
  for (const k in PIPE_ICONS) if (n.includes(k)) return PIPE_ICONS[k];
  return '◇';
}

/* ---------------- Bootstrap ---------------- */
async function boot() {
  const b = await api('/api/bootstrap');
  S.boot = b;
  S.pipelines = b.pipelines || [];
  S.providers = b.providers || [];
  S.cwd = b.cwd || '';
  S.runDir = b.cwd || '';
  $('repoName').textContent = b.repo || '';
  document.title = `huu · ${b.repo || 'web'}`;
  // /simulation is a self-contained demo surface — short-circuit the launch flow.
  if (location.pathname.replace(/\/+$/, '') === '/simulation') { bootSimulation(b); return; }
  if (b.defaults && typeof b.defaults.concurrency === 'number') { S.manualN = b.defaults.concurrency; }
  if (b.defaults && b.defaults.autoScale === false) { S.mode = 'manual'; }
  S.provider = b.lockedProvider || pickDefaultProvider(b.providers);
  S.backend = providerBackend(S.provider);
  renderGallery();
  if (b.initialPipeline) selectPipelineByName(b.initialPipeline);
  for (const r of b.runs || []) ingestRun(r);
  connectSse();
  // Restore a half-built queue (config only — keys are never persisted) and
  // reflect the saved-history count on the topbar.
  restoreQueue();
  renderQueue();
  refreshHistoryBadge();
}

function pickDefaultProvider(providers) {
  // Prefer a provider whose credentials already resolve — counting keys held
  // in THIS browser session, not just the server-resolvable ones.
  const ready = (providers || []).find((x) => providerReady(x));
  if (ready) return ready.id;
  return (providers && providers[0] && providers[0].id) || 'openrouter';
}

/* ---------------- Launch: pipeline gallery ---------------- */
function renderGallery() {
  const g = $('pipelineGallery');
  $('pipeCount').textContent = S.pipelines.length ? `${S.pipelines.length}` : '';
  if (!S.pipelines.length) { g.innerHTML = `<div class="lane__empty">No pipelines found in <code>pipelines/</code>.</div>`; return; }
  g.innerHTML = '';
  for (const p of S.pipelines) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pipe-card' + (S.selectedPipe && S.selectedPipe.name === p.name ? ' sel' : '');
    el.innerHTML = `
      <div class="pipe-card__icon">${pipeIcon(p.name)}</div>
      <div>
        <div class="pipe-card__name">${esc(p.name)} ${p.isDefault ? '<span class="star" title="default">★</span>' : ''}</div>
        ${p.description ? `<div class="pipe-card__desc">${esc(p.description)}</div>` : ''}
        <div class="pipe-card__sub">${p.workSteps} work · ${p.checkSteps} check · ${p.stepCount} steps</div>
      </div>
      <div class="pipe-card__badges">
        ${p.isDefault ? '<span class="tag tag--default">default</span>' : ''}
        <span class="tag tag--src">${esc(p.source)}</span>
      </div>`;
    el.addEventListener('click', () => selectPipeline(p));
    g.appendChild(el);
  }
}

function selectPipelineByName(name) {
  const p = S.pipelines.find((x) => x.name === name);
  if (p) selectPipeline(p);
}

async function selectPipeline(p) {
  S.selectedPipe = p;
  renderGallery();
  $('configEmpty').hidden = true;
  $('configForm').hidden = false;
  $('selectedPipe').textContent = p.name;
  $('selectedPipeDesc').textContent = p.description || '';
  $('dirPath').textContent = S.runDir;
  $('dirPath').title = S.runDir;
  renderProviderSeg();
  await refreshModelsAndKeys();
  renderModeSeg();
}

/* ---------------- Launch: provider + models + keys ---------------- */
function renderProviderSeg() {
  const seg = $('providerSeg');
  seg.innerHTML = '';
  const locked = !!(S.boot && S.boot.lockedProvider);
  for (const p of S.providers) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const ready = providerReady(p);
    btn.className = S.provider === p.id ? 'on' : '';
    btn.textContent = p.label + (ready ? '' : ' •');
    btn.title = p.description + (ready ? ' · key ✓' : ' · key needed');
    if (locked && p.id !== S.boot.lockedProvider) btn.disabled = true;
    btn.addEventListener('click', async () => {
      S.provider = p.id;
      S.backend = providerBackend(p.id);
      // A typed/custom id is provider-specific — re-seed from the new provider's
      // catalog instead of carrying it across.
      S.modelId = '';
      renderProviderSeg();
      await refreshModelsAndKeys();
    });
    seg.appendChild(btn);
  }
}

async function refreshModelsAndKeys() {
  // Models (by provider). OpenRouter's /models is public, so the server returns
  // the FULL live catalog even with no key — the user sees every model the
  // moment this screen opens. We still forward a validated session key when we
  // have one (per-account view); it's optional for listing.
  try {
    const orKey = S.provider === 'openrouter' ? sessionKey(backendSpecName(S.backend)) : '';
    const m = await api(
      '/api/models?provider=' + encodeURIComponent(S.provider),
      orKey ? { headers: { 'x-huu-key': orKey } } : undefined,
    );
    S.models = m.models || [];
    S.modelSource = m.source || 'recommended';
  } catch { S.models = []; S.modelSource = 'recommended'; }
  // Keep the current pick across a provider/key refresh — INCLUDING a custom id
  // the user typed that isn't in the catalog (that's the point of free-text).
  // Only seed a default when there's no pick at all. The provider switch handler
  // clears S.modelId so a typed id never leaks across providers. Prefer the
  // canonical default model when the catalog offers it (the live OpenRouter list
  // is sorted alphabetically, so models[0] is NOT a meaningful default).
  if (!S.modelId && S.models.length) {
    const preferred = S.models.find((m) => m.id === DEFAULT_MODEL_ID);
    S.modelId = preferred ? preferred.id : S.models[0].id;
  }
  syncModelInput();
  updateModelCap();
  if (combo.open) renderModelOptions();
  updateModelHint();
  // Keys (by provider). A spec we already hold a validated key for in THIS
  // browser session is satisfied even though the server — which never saw it —
  // still reports it missing.
  try { S.keyStatus = await api('/api/keys?provider=' + encodeURIComponent(S.provider)); }
  catch { S.keyStatus = { ok: true, missing: [] }; }
  if (S.keyStatus && Array.isArray(S.keyStatus.missing) && S.keyStatus.missing.length) {
    const stillMissing = S.keyStatus.missing.filter((s) => !sessionKey(s.name));
    S.keyStatus = { ok: stillMissing.length === 0, missing: stillMissing };
  }
  renderKeyArea();
  updateRunBtn();
}

function updateModelHint() {
  const md = S.models.find((x) => x.id === S.modelId);
  const h = $('modelHint');
  if (!md) {
    // Custom / free-typed id (or no pick yet): no catalog metadata to show.
    h.innerHTML = S.modelId
      ? '<span class="custom">custom model id</span> · sent to OpenRouter as-is'
      : '';
    return;
  }
  const price = md.inputPrice != null ? `$${md.inputPrice}/M in · $${md.outputPrice ?? '?'}/M out` : '';
  const head = [md.thinking ? '<span class="thinking">thinking</span>' : '', esc(md.description || '')]
    .filter(Boolean).join(' · ');
  const tail = [price, fmtCtx(md.contextLength)].filter(Boolean).join(' · ');
  h.innerHTML = [head, tail].filter(Boolean).join('<br>');
}

/* Render one row per credential the selected provider needs. Each value can be
   set when missing AND changed when already present. Pasted values are
   validated against the provider and kept in THIS browser session only — never
   written to disk. Endpoint specs use a text input; keys use a password input. */
function renderKeyArea() {
  const area = $('keyArea');
  const info = providerInfoById(S.provider);
  const specs = (info && info.keySpecs) || [];
  if (!specs.length) { area.innerHTML = ''; area.hidden = true; return; }
  area.hidden = false;
  const missing = new Set((S.keyStatus.missing || []).map((m) => m.name));
  const rows = specs
    .map((spec) => {
      const present = !missing.has(spec.name);
      const isText = spec.name === 'azureEndpoint';
      const editorId = `keyEdit-${spec.name}`;
      const inputHtml = `
        <div class="key-row" id="${editorId}" ${present ? 'hidden' : ''}>
          <input type="${isText ? 'text' : 'password'}" data-spec="${esc(spec.name)}"
                 placeholder="${esc(spec.hint || 'paste value…')}" autocomplete="off" spellcheck="false" />
          <button type="button" class="btn btn--ghost btn--sm" data-save="${esc(spec.name)}">Validate &amp; use</button>
        </div>
        ${spec.validatePrefix ? `<div class="key-hint">Expected to start with “${esc(spec.validatePrefix)}”.</div>` : ''}`;
      const status = present
        ? `<div class="key-status"><span class="key-status__ok">✓ ${esc(spec.label)} set</span>
             <button type="button" class="linkbtn" data-change="${esc(spec.name)}">change</button></div>`
        : `<div class="key-status"><span class="key-status__need">${esc(spec.label)} needed</span></div>`;
      return `<label>${esc(spec.label)}</label>${status}${inputHtml}`;
    })
    .join('<div style="height:6px"></div>');
  area.innerHTML = rows +
    `<div class="model-hint">Validated against the provider, then kept only in this browser tab — never written to disk.</div>`;
}

// Delegated handlers for the dynamic key rows: reveal the "change" editor, or
// validate + accept a pasted value. The value is checked against the provider
// and then kept in THIS browser session only — it is never written to disk
// (we deliberately do NOT call the persistence endpoint POST /api/keys here).
$('keyArea').addEventListener('click', async (e) => {
  const changeName = e.target.getAttribute && e.target.getAttribute('data-change');
  if (changeName) {
    const row = document.getElementById(`keyEdit-${changeName}`);
    if (row) { row.hidden = false; const inp = row.querySelector('input'); if (inp) inp.focus(); }
    return;
  }
  const saveName = e.target.getAttribute && e.target.getAttribute('data-save');
  if (!saveName) return;
  const row = document.getElementById(`keyEdit-${saveName}`);
  const input = row && row.querySelector('input');
  const value = input ? input.value.trim() : '';
  if (!value) return;
  const btn = e.target;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Validating…';
  try {
    // Azure's key can only be validated together with its endpoint — read the
    // endpoint the user just typed (if any) or one already held this session.
    const epInput = document.querySelector('[data-spec="azureEndpoint"]');
    const endpoint = ((epInput && epInput.value) || sessionKey('azureEndpoint') || '').trim() || undefined;
    // Validate BEFORE accepting — a key the provider rejects (the exact 401
    // that motivated this) is never kept. On success the value lives only in
    // this browser's session memory and is sent with each run.
    const r = await api('/api/keys/validate', {
      method: 'POST',
      body: JSON.stringify({ name: saveName, value, endpoint }),
    });
    if (r.status === 'valid') {
      setSessionKey(saveName, value);
      toast('Key validated ✓ — kept in this browser only');
      await refreshModelsAndKeys();
    } else if (r.status === 'invalid') {
      toast(`Key rejected (HTTP ${r.httpStatus}). Check it and paste again.`, true);
    } else {
      // Couldn't reach the provider (offline/VPN) or no validator for this
      // spec (e.g. the Azure endpoint URL) — don't hard-block; keep it for
      // this session with a warning.
      setSessionKey(saveName, value);
      toast(`Couldn't verify the value (${r.reason}) — using it for this session anyway.`);
      await refreshModelsAndKeys();
    }
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; btn.textContent = label; }
});

/* ---------------- Searchable model combobox ----------------
   Replaces the old <select>: type to filter the list. For OpenRouter that list
   is the FULL live catalog — every model, no capability filter — downloaded
   from the public /models endpoint with or without a key (see
   refreshModelsAndKeys). Type any id to use one that isn't listed. */
const combo = { open: false, active: -1, matches: [], query: '' };

function modelById(id) { return S.models.find((m) => m.id === id) || null; }

function fmtCtx(n) {
  if (!n || n <= 0) return '';
  if (n >= 1000000) return (n % 1000000 ? (n / 1000000).toFixed(1) : n / 1000000) + 'M ctx';
  if (n >= 1000) return Math.round(n / 1000) + 'k ctx';
  return n + ' ctx';
}

/** Reflect the current selection as the input's display value. */
function syncModelInput() {
  const input = $('modelInput');
  const md = modelById(S.modelId);
  // A custom id the user typed isn't in the catalog — show the id verbatim so
  // they can see exactly what will run, instead of a blank field.
  input.value = md ? md.label : (S.modelId || '');
  input.placeholder = S.models.length ? 'Search or type any model id…' : 'Type a model id…';
}

function updateModelCap() {
  const cap = $('modelCap');
  if (!cap) return;
  const n = S.models.length;
  if (S.provider !== 'openrouter') { cap.textContent = n ? `${n} model${n === 1 ? '' : 's'} available` : ''; return; }
  if (S.modelSource === 'openrouter-live') {
    cap.innerHTML = `<span class="live">${n} models</span> · full OpenRouter catalog · or type any model id`;
  } else {
    cap.textContent = "Couldn't reach OpenRouter — showing recommended models; type any model id to use it anyway";
  }
}

/**
 * A typed value that isn't already an exact catalog id → offer it verbatim so
 * the user can run ANY OpenRouter model, even one not in the downloaded list
 * (a brand-new model, or one the catalog filter never had). This is the
 * free-text escape hatch: pick it and the raw id is sent to OpenRouter as-is.
 */
function customCandidate() {
  const q = combo.query.trim();
  if (!q) return null;
  if (S.models.some((m) => m.id === q)) return null; // already a real option
  return { id: q, label: q, custom: true };
}

function comboMatches() {
  const q = combo.query.trim().toLowerCase();
  const base = !q
    ? S.models.slice()
    : S.models.filter((m) =>
        m.id.toLowerCase().includes(q) || (m.label || '').toLowerCase().includes(q));
  const custom = customCandidate();
  return custom ? base.concat([custom]) : base;
}

function modelOptionHtml(m, i, active, sel) {
  if (m.custom) {
    return `<li class="combo__opt combo__opt--custom${active ? ' active' : ''}" role="option" id="opt-${i}" data-id="${esc(m.id)}" aria-selected="false">` +
      `<span class="combo__opt-name">Use “${esc(m.id)}”</span>` +
      `<span class="combo__badge combo__badge--custom">custom id</span>` +
      `<span class="combo__opt-id">sent to OpenRouter as-is</span></li>`;
  }
  const price = m.inputPrice != null ? `$${m.inputPrice}/M·$${m.outputPrice ?? '?'}/M` : '';
  const meta = [m.tier, fmtCtx(m.contextLength), price].filter(Boolean).join(' · ');
  const badges =
    (m.thinking ? '<span class="combo__badge">reasoning</span>' : '') +
    // huu's agents need tool calling — flag models that lack it so the choice
    // is informed, without hiding them.
    (m.tools === false ? '<span class="combo__badge combo__badge--warn">no tools</span>' : '');
  return `<li class="combo__opt${active ? ' active' : ''}${sel ? ' sel' : ''}" role="option" id="opt-${i}" data-id="${esc(m.id)}" aria-selected="${sel ? 'true' : 'false'}">` +
    `<span class="combo__opt-name">${esc(m.label || m.id)}</span>` +
    badges +
    (meta ? `<span class="combo__opt-meta">${esc(meta)}</span>` : '') +
    `<span class="combo__opt-id">${esc(m.id)}</span></li>`;
}

function renderModelOptions() {
  const list = $('modelList');
  const matches = comboMatches();
  combo.matches = matches;
  if (combo.active >= matches.length) combo.active = matches.length - 1;
  // With the free-text candidate, a non-empty query always yields at least one
  // row; an empty list means "no catalog and nothing typed yet".
  if (!matches.length) {
    list.innerHTML = S.models.length
      ? '<li class="combo__empty">No matches — type a full model id to use it as-is</li>'
      : '<li class="combo__empty">Type a model id, e.g. deepseek/deepseek-v4-flash</li>';
    return;
  }
  list.innerHTML = matches.map((m, i) => modelOptionHtml(m, i, i === combo.active, m.id === S.modelId)).join('');
  const input = $('modelInput');
  if (combo.active >= 0) input.setAttribute('aria-activedescendant', 'opt-' + combo.active);
  else input.removeAttribute('aria-activedescendant');
  const act = list.querySelector('.combo__opt.active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}

function openCombo() {
  if (!combo.open) { combo.open = true; $('modelInput').setAttribute('aria-expanded', 'true'); $('modelList').hidden = false; }
  renderModelOptions();
}
function closeCombo() {
  combo.open = false; combo.active = -1;
  $('modelInput').setAttribute('aria-expanded', 'false');
  $('modelList').hidden = true;
}
function selectModel(id) {
  // Accept ANY non-empty id — catalog model OR a free-typed custom id. The
  // server passes it straight to OpenRouter, so the user can run any model.
  if (!id) return;
  S.modelId = id;
  combo.query = '';
  syncModelInput();
  closeCombo();
  updateModelHint();
}

(function setupModelCombo() {
  const input = $('modelInput');
  const list = $('modelList');
  if (!input || !list) return;
  input.addEventListener('focus', () => {
    // Clear to an empty filter so the user sees the COMPLETE list and can type
    // to narrow it; the current pick is restored on blur/Escape if untouched.
    combo.query = '';
    input.value = '';
    const all = comboMatches();
    combo.active = Math.max(0, all.findIndex((m) => m.id === S.modelId));
    openCombo();
  });
  input.addEventListener('input', () => { combo.query = input.value; combo.active = -1; openCombo(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!combo.open) { openCombo(); return; }
      combo.active = Math.min(combo.active + 1, combo.matches.length - 1);
      renderModelOptions();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      combo.active = Math.max(combo.active - 1, 0);
      renderModelOptions();
    } else if (e.key === 'Enter') {
      e.preventDefault(); // never submit the run form from the model field
      if (combo.open && combo.matches.length) {
        const pick = combo.active >= 0 ? combo.matches[combo.active] : combo.matches[0];
        if (pick) selectModel(pick.id);
      } else openCombo();
    } else if (e.key === 'Escape') {
      if (combo.open) { e.preventDefault(); combo.query = ''; syncModelInput(); closeCombo(); }
    }
  });
  // Delay so a click on an option (mousedown below) wins over the blur-close.
  input.addEventListener('blur', () => { setTimeout(() => { combo.query = ''; syncModelInput(); closeCombo(); }, 150); });
  // mousedown (not click) fires before the input blur, so the selection sticks.
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest ? e.target.closest('.combo__opt') : null;
    if (!li || !li.dataset.id) return;
    e.preventDefault();
    selectModel(li.dataset.id);
  });
})();

/* ---------------- Launch: concurrency mode ---------------- */
function renderModeSeg() {
  for (const btn of $('modeSeg').children) btn.classList.toggle('on', btn.dataset.mode === S.mode);
  $('manualRow').hidden = S.mode !== 'manual';
  $('concRange').value = S.manualN; $('concOut').textContent = S.manualN;
}
for (const btn of $('modeSeg').children) {
  btn.addEventListener('click', () => { S.mode = btn.dataset.mode; renderModeSeg(); });
}
$('concRange').addEventListener('input', (e) => { S.manualN = +e.target.value; $('concOut').textContent = S.manualN; });

function updateRunBtn() {
  // The form now ADDS a project to the queue; a key isn't required to add (it's
  // resolved per project at run time, and the queued item shows a "key needed"
  // marker until then). Enable as soon as a pipeline is selected.
  $('addBtn').disabled = !S.selectedPipe;
}

/* ====================================================================
   Sequential project queue
   The config form ADDS a fully-configured project to the queue. "Run queue"
   executes them one after another: dispatch → wait for the run to settle over
   SSE → archive it to IndexedDB → dispatch the next. The server stays
   single-run and stateless; the browser owns the sequence and the history.
   ==================================================================== */

const QUEUE_LS = 'huu.queue.v1';

/** Snapshot the current form into a queue item (no key — resolved at run time). */
function captureFormConfig() {
  if (!S.selectedPipe) return null;
  const md = S.models.find((x) => x.id === S.modelId);
  const prov = providerInfoById(S.provider);
  return {
    id: uid(),
    pipelineName: S.selectedPipe.name,
    pipelineDesc: S.selectedPipe.description || '',
    provider: S.provider,
    backend: S.backend,
    modelId: S.modelId,
    modelLabel: md ? md.label : (S.modelId || 'default model'),
    providerLabel: prov ? prov.label : S.provider,
    mode: S.mode,
    concurrency: S.mode === 'manual' ? S.manualN : undefined,
    runDirectory: S.runDir || S.cwd,
    status: 'pending',
  };
}

// Form submit → add (or update when editing) a queued project.
$('configForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const cfg = captureFormConfig();
  if (!cfg) return;
  $('runError').hidden = true;
  if (S.queue.editingId) {
    const i = S.queue.items.findIndex((x) => x.id === S.queue.editingId);
    if (i >= 0) { cfg.id = S.queue.editingId; S.queue.items[i] = cfg; }
    S.queue.editingId = null;
    setAddBtnLabel('Add to queue');
    toast('Project updated');
  } else {
    S.queue.items.push(cfg);
    toast('Added to queue');
  }
  persistQueue();
  renderQueue();
});

function setAddBtnLabel(t) { $('addBtnLabel').textContent = t; }

/* ---------------- Queue rendering ---------------- */
function itemReady(it) { return providerReady(providerInfoById(it.provider)); }

function statusBadge(s) {
  if (s === 'running') return '<span class="queue-status running">running</span>';
  if (s === 'done') return '<span class="queue-status done">done</span>';
  if (s === 'error') return '<span class="queue-status error">failed</span>';
  return '';
}

function renderQueue() {
  const q = S.queue;
  $('queuePanel').hidden = q.items.length === 0;
  $('queueCount').textContent = q.items.length ? String(q.items.length) : '';
  const list = $('queueList');
  list.innerHTML = '';
  q.items.forEach((it, i) => {
    const ready = itemReady(it);
    const el = document.createElement('div');
    el.className = 'queue-item ' + (it.status || 'pending');
    el.innerHTML = `
      <div class="queue-item__idx">${i + 1}</div>
      <div class="queue-item__main">
        <div class="queue-item__name"><span class="ico">${pipeIcon(it.pipelineName)}</span><span class="txt">${esc(it.pipelineName)}</span></div>
        <div class="queue-item__meta">${esc(shortDir(it.runDirectory))}<span class="sep">·</span>${esc(it.modelLabel || 'default')}<span class="sep">·</span>${esc(it.providerLabel || it.provider)}${ready ? '' : '<span class="sep">·</span><span class="warn">key needed</span>'}</div>
      </div>
      <div class="queue-item__actions">
        ${statusBadge(it.status)}
        <button class="qbtn" data-act="up" data-id="${it.id}" title="Move up" ${i === 0 || q.running ? 'disabled' : ''}>↑</button>
        <button class="qbtn" data-act="down" data-id="${it.id}" title="Move down" ${i === q.items.length - 1 || q.running ? 'disabled' : ''}>↓</button>
        <button class="qbtn" data-act="edit" data-id="${it.id}" title="Edit" ${q.running ? 'disabled' : ''}>✎</button>
        <button class="qbtn qbtn--danger" data-act="remove" data-id="${it.id}" title="Remove" ${q.running ? 'disabled' : ''}>✕</button>
      </div>`;
    list.appendChild(el);
  });
  $('queueRun').disabled = q.running || q.items.length === 0;
  $('queueRunLabel').textContent = q.running ? 'Running…' : `Run queue${q.items.length ? ` (${q.items.length})` : ''}`;
  $('queueClear').disabled = q.running || q.items.length === 0;
}

// Delegated queue-item actions (remove / edit / reorder).
$('queueList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  switch (btn.getAttribute('data-act')) {
    case 'remove': removeQueueItem(id); break;
    case 'edit': editQueueItem(id); break;
    case 'up': moveQueueItem(id, -1); break;
    case 'down': moveQueueItem(id, 1); break;
  }
});

function removeQueueItem(id) {
  if (S.queue.running) return;
  S.queue.items = S.queue.items.filter((x) => x.id !== id);
  if (S.queue.editingId === id) { S.queue.editingId = null; setAddBtnLabel('Add to queue'); }
  persistQueue();
  renderQueue();
}
function moveQueueItem(id, dir) {
  if (S.queue.running) return;
  const items = S.queue.items;
  const i = items.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  persistQueue();
  renderQueue();
}
$('queueClear').addEventListener('click', () => {
  if (S.queue.running) return;
  S.queue.items = [];
  S.queue.editingId = null;
  setAddBtnLabel('Add to queue');
  persistQueue();
  renderQueue();
});

// Load a queued project back into the form to tweak + re-save.
async function editQueueItem(id) {
  if (S.queue.running) return;
  const it = S.queue.items.find((x) => x.id === id);
  if (!it) return;
  const pipe = S.pipelines.find((p) => p.name === it.pipelineName);
  if (!pipe) { toast('Pipeline no longer available', true); return; }
  S.runDir = it.runDirectory;
  S.provider = it.provider;
  S.backend = providerBackend(it.provider);
  await selectPipeline(pipe);            // renders provider seg + models + keys for S.provider
  // Restore the saved model id (catalog OR custom) into the combobox. The old
  // code read a #modelSelect <select> that no longer exists — it would crash.
  S.modelId = it.modelId || S.modelId;
  syncModelInput();
  updateModelHint();
  S.mode = it.mode || 'auto';
  S.manualN = it.concurrency || S.manualN;
  renderModeSeg();
  S.queue.editingId = id;
  setAddBtnLabel('Update project');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('Editing project — change config, then Update');
}

/* ---------------- Queue persistence (localStorage; no keys) ---------------- */
function persistQueue() {
  try {
    const slim = S.queue.items.map((it) => ({ ...it, status: undefined }));
    localStorage.setItem(QUEUE_LS, JSON.stringify(slim));
  } catch { /* storage full / disabled — queue just won't survive reload */ }
}
function restoreQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_LS);
    if (!raw) return;
    const items = JSON.parse(raw);
    if (Array.isArray(items)) S.queue.items = items.map((it) => ({ ...it, status: 'pending' }));
  } catch { /* corrupt — start empty */ }
}

/* ---------------- Sequential runner ---------------- */
$('queueRun').addEventListener('click', startQueue);

function startQueue() {
  const q = S.queue;
  if (q.running || !q.items.length) return;
  for (const it of q.items) { it.status = 'pending'; it.runId = null; }
  q.running = true;
  q.live = new Map();
  q.settled = 0;
  q.processed = new Set();
  q.stopping = false;
  q.id = uid();
  persistQueue();
  renderQueue();
  updateQueueChrome();
  // Dispatch ALL items at once — the server runs them concurrently under one
  // shared scheduler (priority = dispatch order; later items backfill earlier
  // ones). The project selector lets you switch between the live boards.
  q.items.forEach((_it, i) => dispatchQueueItem(i));
}

function dispatchQueueItem(i) {
  const q = S.queue;
  const item = q.items[i];
  if (!item) return;
  item.status = 'running';
  renderQueue();
  postRun(i);
}

async function postRun(i) {
  const q = S.queue;
  const item = q.items[i];
  // Resolve THIS project's session key (validated earlier, browser-only).
  const apiKey = sessionKey(backendSpecName(item.backend));
  const endpoint = sessionKey('azureEndpoint');
  try {
    const r = await api('/api/run', {
      method: 'POST',
      body: JSON.stringify({
        pipelineName: item.pipelineName,
        provider: item.provider,
        modelId: item.modelId,
        mode: item.mode,
        concurrency: item.mode === 'manual' ? item.concurrency : undefined,
        apiKey: apiKey || undefined,
        endpoint: endpoint || undefined,
        runDirectory: item.runDirectory || undefined,
      }),
    });
    const runId = r && r.run && r.run.runId;
    if (runId) { item.runId = runId; q.live.set(runId, item); }
    showView('run');
    renderQueue();
  } catch (err) {
    // Couldn't start (missing key, bad dir, too many concurrent runs, …).
    // Record the failure and count it settled — the queue still completes.
    item.status = 'error';
    await archiveSynthetic(item, err.message);
    q.settled++;
    renderQueue();
    refreshHistoryBadge();
    maybeFinishQueue();
  }
}

/**
 * Called for every run SSE frame. Archives + advances when the in-flight
 * project settles. Guards against a replayed/duplicated terminal frame via a
 * processed-runId Set and a latched current.runId.
 */
function onRunFrame(run) {
  const q = S.queue;
  if (!q.running || !run.runId) return;
  if (q.processed.has(run.runId)) return;            // already archived
  const item = q.live && q.live.get(run.runId);
  if (!item) return;                                  // not one of THIS queue's runs
  if (run.phase !== 'done' && run.phase !== 'error') return;
  q.processed.add(run.runId);
  q.live.delete(run.runId);
  item.status = run.phase === 'done' ? 'done' : 'error';
  archiveRun(run, item);
  q.settled++;
  renderQueue();
  refreshHistoryBadge();
  maybeFinishQueue();
}

function queueCtx(item) {
  return { ...item, queue: { id: S.queue.id, index: S.queue.items.indexOf(item), size: S.queue.items.length } };
}
async function archiveRun(run, item) {
  try { await saveRun(buildRunRecord({ run, item: queueCtx(item), archivedAt: Date.now() })); }
  catch (e) { console.warn('huu: failed to archive run', e); }
}
async function archiveSynthetic(item, reason) {
  try { await saveRun(buildSyntheticRecord({ item: queueCtx(item), errorReason: reason, archivedAt: Date.now() })); }
  catch (e) { console.warn('huu: failed to archive synthetic run', e); }
}

function maybeFinishQueue() {
  const q = S.queue;
  if (q.stopping) { if (!q.live || q.live.size === 0) stopFinalize(); return; }
  if (q.settled >= q.items.length) finishQueue();
}

function finishQueue() {
  const q = S.queue;
  q.running = false;
  q.live = null;
  // Settled projects are now archived in History (IndexedDB) — drop them from
  // the queue so returning home doesn't show finished runs and re-run the same
  // pipelines on the next "Run queue". A clean finish settles every item, so the
  // queue empties; anything that somehow never ran stays for a later run.
  const { keep, error } = settleQueue(q.items);
  q.items = keep;
  q.editingId = null;
  setAddBtnLabel('Add to queue');
  persistQueue();
  renderQueue();
  updateQueueChrome();
  toast(error ? `Queue finished — ${error} failed · saved to History` : 'Queue finished ✓ · saved to History');
}

// Stop the WHOLE queue: abort the active run, archive it, then halt.
$('stopQueueBtn').addEventListener('click', () => {
  const q = S.queue;
  if (!q.running) return;
  q.stopping = true;
  toast('Stopping queue…');
  // No runId → the server aborts ALL runs and tears down the shared scheduler.
  api('/api/run/abort', { method: 'POST' }).catch(() => {});
  if (!q.live || q.live.size === 0) stopFinalize();   // nothing live → finalize now
});
function stopFinalize() {
  const q = S.queue;
  q.running = false;
  q.stopping = false;
  q.live = null;
  // Keep only what never finished; runs that already settled (incl. the ones
  // just aborted) are archived in History, so drop them from the queue.
  q.items = settleQueue(q.items).keep;
  persistQueue();
  renderQueue();
  updateQueueChrome();
  toast('Queue stopped');
}

/* ---------------- Run-view chrome for the queue ---------------- */
function updateQueueChrome() {
  const q = S.queue;
  let active = false;
  for (const r of S.runs.values()) if (r.phase === 'running') { active = true; break; }
  const inQueue = q.running;
  // During a queue run the per-run abort is replaced by a queue-wide stop.
  $('abortBtn').hidden = !active || inQueue;
  $('stopQueueBtn').hidden = !inQueue || !active;
  if (inQueue) $('backToLaunch').hidden = true;   // no wandering off mid-queue
  renderQueueProgress();
}
function renderQueueProgress() {
  const q = S.queue;
  const el = $('queueProgress');
  if (!q.running) { el.hidden = true; return; }
  el.hidden = false;
  const done = q.items.filter((it) => it.status === 'done' || it.status === 'error').length;
  const dots = q.items.map((it) => `<span class="qp-dot ${it.status || 'pending'}"></span>`).join('');
  el.innerHTML = `<span>${done}/${q.items.length} done · running concurrently</span><span class="qp-bar">${dots}</span>`;
}

/* ====================================================================
   Run history (IndexedDB) + JSON export
   ==================================================================== */
let historyCache = [];

$('historyBtn').addEventListener('click', openHistory);
$('historyClose').addEventListener('click', closeHistory);
$('historyScrim').addEventListener('click', closeHistory);

async function openHistory() {
  $('historyScrim').hidden = false;
  $('historyModal').hidden = false;
  await renderHistory();
}
function closeHistory() { $('historyScrim').hidden = true; $('historyModal').hidden = true; }

async function renderHistory() {
  const list = $('historyList');
  list.innerHTML = '<div class="history-empty">Loading…</div>';
  let runs = [];
  try { runs = await listRuns(); }
  catch (e) { list.innerHTML = `<div class="history-empty">History unavailable: ${esc(e.message)}</div>`; return; }
  historyCache = runs;
  const total = runs.reduce((s, r) => s + (r.totalCost || 0), 0);
  $('historyMeta').textContent = runs.length
    ? `${runs.length} run${runs.length > 1 ? 's' : ''} · $${total.toFixed(2)} total`
    : 'No runs yet';
  $('historyExport').disabled = runs.length === 0;
  $('historyClear').disabled = runs.length === 0;
  if (!runs.length) { list.innerHTML = '<div class="history-empty">No runs yet. Run a queue to build history.</div>'; return; }
  list.innerHTML = '';
  for (const r of runs) list.appendChild(historyRow(r));
}

function historyRow(r) {
  const wrap = document.createElement('div');
  wrap.className = 'history-row';
  const when = r.archivedAt ? new Date(r.archivedAt).toLocaleString() : '';
  const cards = r.counts ? r.counts.total : (r.cards || []).length;
  const sub = [shortDir(r.runDirectory), r.modelLabel || r.modelId, r.provider, when]
    .filter(Boolean).map(esc).join(' · ');
  wrap.innerHTML = `
    <button type="button" class="history-row__head">
      <span class="history-row__icon">${pipeIcon(r.pipelineName)}</span>
      <span class="history-row__main">
        <span class="history-row__name">${esc(r.pipelineName)}</span>
        <span class="history-row__sub">${sub} · ${cards} cards</span>
      </span>
      <span class="history-row__status ${r.status}">${r.status === 'done' ? 'done' : 'failed'}</span>
      <span class="history-row__cost">$${(r.totalCost || 0).toFixed(3)}<small>${fmtDur(r.elapsedMs || 0)}</small></span>
      <svg class="history-row__chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 10l5 5 5-5z" fill="currentColor"/></svg>
    </button>
    <div class="history-cards">${historyCardsHtml(r)}</div>`;
  wrap.querySelector('.history-row__head').addEventListener('click', () => wrap.classList.toggle('open'));
  return wrap;
}

function historyCardsHtml(r) {
  const errLine = r.errorReason ? `<div class="history-err">⚠ ${esc(r.errorReason)}</div>` : '';
  const rows = (r.cards || []).map((c) => {
    const cost = c.cost == null ? '—' : '$' + Number(c.cost).toFixed(4);
    const tok = c.kind === 'agent' ? fmtNum((c.tokensIn || 0) + (c.tokensOut || 0)) : '—';
    return `<tr>
      <td><span class="hc-kind ${c.kind}">${c.kind}</span></td>
      <td class="ttl">${esc(c.title)}${c.error ? ' <span style="color:var(--red)">⚠</span>' : ''}</td>
      <td>${esc(humanize(c.phase || ''))}</td>
      <td class="num">${tok}</td>
      <td class="num">${cost}</td>
    </tr>`;
  }).join('');
  const table = (r.cards && r.cards.length)
    ? `<table class="hc-table">
         <thead><tr><th>Kind</th><th>Card</th><th>Phase</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>`
    : '<div class="history-empty" style="padding:16px 0">No cards recorded for this run.</div>';
  const foot = `<div class="queue-foot" style="margin-top:12px">
      <span class="muted" style="font-size:12px">Project total <b style="color:var(--text)">$${(r.totalCost || 0).toFixed(4)}</b> · card costs sum $${(r.cardCostSum || 0).toFixed(4)}</span>
      <button class="btn btn--ghost btn--sm history-del" data-del="${r.id}" style="margin-left:auto">Delete</button>
    </div>`;
  return errLine + table + foot;
}

// Delegated: delete one history record (button lives inside the expanded body).
$('historyList').addEventListener('click', async (e) => {
  const del = e.target.closest('button[data-del]');
  if (!del) return;
  e.stopPropagation();
  try { await deleteRun(del.getAttribute('data-del')); } catch { /* ignore */ }
  await renderHistory();
  refreshHistoryBadge();
});

$('historyExport').addEventListener('click', async () => {
  let runs = historyCache;
  try { if (!runs || !runs.length) runs = await listRuns(); } catch { /* ignore */ }
  if (!runs || !runs.length) { toast('Nothing to export', true); return; }
  const { filename, text } = exportRunsJson(runs, Date.now());
  downloadText(filename, text);
  toast(`Exported ${runs.length} run${runs.length > 1 ? 's' : ''}`);
});

$('historyClear').addEventListener('click', async () => {
  if (!confirm('Clear all run history? This cannot be undone.')) return;
  try { await clearRuns(); } catch { /* ignore */ }
  await renderHistory();
  refreshHistoryBadge();
});

async function refreshHistoryBadge() {
  let n = 0;
  try { n = (await listRuns()).length; } catch { /* unavailable */ }
  const b = $('historyBadge');
  if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = false; }
  else b.hidden = true;
}

/** "…/parent/dir" for a long absolute path; left untouched when already short. */
function shortDir(p) {
  if (!p) return '';
  const parts = String(p).replace(/\/+$/, '').split('/');
  return parts.length <= 3 ? p : '…/' + parts.slice(-2).join('/');
}

/* ---------------- Folder picker (run directory) ---------------- */
const folderState = { path: '' };
$('dirBrowse').addEventListener('click', () => openFolder(S.runDir || S.cwd));
$('folderClose').addEventListener('click', closeFolder);
$('folderScrim').addEventListener('click', closeFolder);
$('folderUp').addEventListener('click', () => { if (folderState.parent) loadFolder(folderState.parent); });
$('folderUse').addEventListener('click', () => {
  S.runDir = folderState.path;
  $('dirPath').textContent = S.runDir;
  $('dirPath').title = S.runDir;
  closeFolder();
  toast('Run directory set');
});

function openFolder(start) { $('folderScrim').hidden = false; $('folderModal').hidden = false; loadFolder(start); }
function closeFolder() { $('folderScrim').hidden = true; $('folderModal').hidden = true; }

async function loadFolder(path) {
  try {
    const d = await api('/api/folders?path=' + encodeURIComponent(path || ''));
    folderState.path = d.path;
    folderState.parent = d.parent;
    $('folderPath').textContent = d.path;
    $('folderPath').title = d.path;
    const git = $('folderGit');
    git.textContent = d.isGitRepo ? '✓ git repo' : '⚠ not a git repo';
    git.className = 'folder-modal__git ' + (d.isGitRepo ? 'ok' : 'no');
    $('folderUp').disabled = !d.parent;
    const list = $('folderList');
    if (!d.entries.length) { list.innerHTML = '<div class="folder-empty">No sub-directories</div>'; return; }
    list.innerHTML = '';
    for (const ent of d.entries) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'folder-item';
      b.innerHTML = `<span class="folder-item__icon">📁</span><span>${esc(ent.name)}</span>`;
      b.addEventListener('click', () => loadFolder(ent.path));
      list.appendChild(b);
    }
  } catch (err) { toast(err.message, true); }
}

/* ---------------- Views ---------------- */
function showView(which) {
  $('viewLaunch').hidden = which !== 'launch';
  $('viewRun').hidden = which !== 'run';
  $('viewSim').hidden = which !== 'sim';
}
$('backToLaunch').addEventListener('click', () => {
  if (S.sim) { showView('sim'); return; }
  showView('launch'); renderGallery();
});

/* ---------------- Simulation mode (/simulation) ----------------
   A fully synthetic run: no branches, no API key, no LLM. The kanban, logs and
   agents are fabricated server-side by the SimulationEngine and streamed over
   the SAME SSE channel as a real run, so the run view renders unchanged. */
function bootSimulation(b) {
  S.sim = true;
  document.title = 'huu · simulation';
  $('backToLaunch').textContent = '← New simulation';
  $('simFiles').value = S.simFiles; $('simFilesOut').textContent = S.simFiles;
  $('simAgents').value = S.simAgents; $('simAgentsOut').textContent = S.simAgents;
  setPauseLabel();
  renderSimModels();
  fetchSimSuggestions();
  for (const r of b.runs || []) ingestRun(r);
  if (!(b.runs || []).length) showView('sim');
  connectSse();
}

function setPauseLabel() { const el = $('pauseBtn'); if (el) el.textContent = S.simPaused ? 'Resume' : 'Pause'; }

function addSimModel(id) {
  id = (id || '').trim();
  if (!id) return;
  if (!S.simModels.includes(id)) S.simModels.push(id);
  $('simModelInput').value = '';
  renderSimModels();
}
function removeSimModel(id) { S.simModels = S.simModels.filter((x) => x !== id); renderSimModels(); }

function renderSimModels() {
  const chips = $('simModelChips'); if (!chips) return;
  chips.innerHTML = '';
  for (const id of S.simModels) {
    const el = document.createElement('span'); el.className = 'sim-chip';
    el.innerHTML = `<span>${esc(id)}</span><button type="button" aria-label="remove">×</button>`;
    el.querySelector('button').addEventListener('click', () => removeSimModel(id));
    chips.appendChild(el);
  }
  const sug = $('simModelSuggest'); if (!sug) return;
  sug.innerHTML = '';
  for (const m of (S.simSuggest || [])) {
    if (S.simModels.includes(m.id)) continue;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sim-sug'; btn.title = m.id;
    btn.textContent = m.label || m.id;
    btn.addEventListener('click', () => addSimModel(m.id));
    sug.appendChild(btn);
    if (sug.children.length >= 8) break;
  }
}
async function fetchSimSuggestions() {
  try {
    const r = await api('/api/models?provider=openrouter');
    S.simSuggest = (r.models || []).slice(0, 20);
    renderSimModels();
  } catch { /* offline / no catalog — the free-text input still works */ }
}

async function startSimulation(allowRetry = true) {
  const cfg = { simulate: true, modelIds: S.simModels.slice(), fileCount: S.simFiles, concurrency: S.simAgents };
  S.lastSim = cfg;
  S.simPaused = false; setPauseLabel();
  try { const r = await api('/api/run', { method: 'POST', body: JSON.stringify(cfg) }); ingestRun(r.run); }
  catch (e) {
    if (allowRetry && /in progress|409/i.test(e.message)) { setTimeout(() => startSimulation(false), 400); return; }
    toast(e.message, true);
  }
}
function regenerate() { showView('run'); startSimulation(); }

async function togglePause() {
  S.simPaused = !S.simPaused; setPauseLabel();
  try { await api('/api/run/pause', { method: 'POST', body: JSON.stringify({ paused: S.simPaused, runId: S.activeRunId }) }); }
  catch (e) { toast(e.message, true); }
}

function updateSimChrome(run) {
  const active = run.phase === 'running';
  const ended = run.phase === 'done' || run.phase === 'error';
  $('pauseBtn').hidden = !active;
  $('regenBtn').hidden = !ended;
  if (!active && S.simPaused) { S.simPaused = false; setPauseLabel(); }
}

// Controls live in the markup unconditionally; wiring them is harmless on the
// launch page (the elements just stay hidden there).
(function setupSimControls() {
  const form = $('simForm'); if (!form) return;
  form.addEventListener('submit', (e) => { e.preventDefault(); showView('run'); startSimulation(); });
  $('simModelAdd').addEventListener('click', () => addSimModel($('simModelInput').value));
  $('simModelInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSimModel(e.target.value); }
  });
  $('simFiles').addEventListener('input', (e) => { S.simFiles = +e.target.value; $('simFilesOut').textContent = S.simFiles; });
  $('simAgents').addEventListener('input', (e) => { S.simAgents = +e.target.value; $('simAgentsOut').textContent = S.simAgents; });
  $('pauseBtn').addEventListener('click', togglePause);
  $('regenBtn').addEventListener('click', regenerate);
})();

/* ---------------- SSE ---------------- */
let es = null;
function connectSse() {
  if (es) es.close();
  es = new EventSource(withTok('/events'));
  es.onmessage = (ev) => {
    let frame;
    try { frame = JSON.parse(ev.data); } catch { return; }
    if (!frame) return;
    if (frame.type === 'run') ingestRun(frame.run);
    else if (frame.type === 'agent-stream') logAgentStream(frame);
  };
  es.onerror = () => { /* EventSource auto-reconnects; nothing to do */ };
}

/* ---------------- Agent output → browser console ----------------
   Every line the pi coding agent streams back (its reply text AND its thinking
   trace) is mirrored here, verbatim and in real time, so you can watch the raw
   agent output in DevTools. Silence it from the console with
   `window.HUU_LOG_STREAM = false`. The on-page run log shows the reply text;
   the thinking trace is console-only (it's verbose). */
const STREAM_STYLE = {
  assistant: 'color:#06b6d4;font-weight:600',  // cyan — visible model reply
  thinking: 'color:#a78bfa',                   // muted violet — reasoning
};
console.info('huu: streaming live pi agent output here. Set window.HUU_LOG_STREAM=false to silence.');
function logAgentStream(f) {
  if (window.HUU_LOG_STREAM === false) return;
  // Tag the runId only when more than one run is live, so single-run output
  // stays clean but concurrent runs are disambiguable in the console.
  const rid = f.runId && S.runs.size > 1 ? `${String(f.runId).slice(0, 4)}/` : '';
  const tag = `${rid}#${f.agentId}${f.channel === 'thinking' ? ' 🧠' : ''}`;
  console.log(`%c${tag}%c ${f.text}`, STREAM_STYLE[f.channel] || '', 'color:inherit');
}

/* ---------------- Ingest run snapshot ---------------- */
let lastStartedAt = 0;
function ingestRun(run) {
  if (!run) return;
  if (run.runId) {
    S.runs.set(run.runId, run);
    // Adopt an active run when none is chosen or the chosen one vanished.
    if (!S.activeRunId || !S.runs.has(S.activeRunId)) S.activeRunId = run.runId;
  }
  // Queue bookkeeping runs for EVERY run's frame (archive settled + finish the
  // queue when all are done), not just the one being viewed. Sims self-drive.
  if (!S.sim && run.runId) onRunFrame(run);
  renderRunSelector();
  renderActiveRun();
}

/**
 * Render the board / metrics / log / chrome for the ACTIVE (selected) run.
 * `S.run` is kept as a pointer to it so every other reader (metrics tick,
 * concurrency control, drawer) keeps working unchanged.
 */
function renderActiveRun() {
  const run = (S.activeRunId && S.runs.get(S.activeRunId)) || { phase: 'idle' };
  S.run = run;
  const active = run.phase === 'running';
  const hasRun = run.phase !== 'idle';

  // Open the run board ONLY while a pipeline is actively running. An
  // idle/done/error run opens on home (the launch view) — so reopening the app
  // after a run finished lands on home, not on a stale board. We only ever
  // switch TO the board here; a run that settles while you're watching it keeps
  // you on the board (the guard simply stops re-asserting the board view).
  if (active && $('viewRun').hidden) showView('run');
  const onRunView = !$('viewRun').hidden;

  // Topbar run chrome belongs to the board context, not the home screen.
  $('runStatusGroup').hidden = !hasRun || !onRunView;
  $('concControl').hidden = !active;
  // The per-run abort targets the VIEWED run; hidden during a queue (which uses
  // a queue-wide stop) and handled by updateQueueChrome.
  $('abortBtn').hidden = !active;
  $('backToLaunch').hidden = active || !hasRun;

  setStatus(run.phase);
  const st = run.state;
  // Gooey morph loader while the orchestrator spins up — shown while the run
  // is live but no cards have landed yet (preflight / worktree creation).
  const cardCount = st
    ? (st.agents || []).length + (st.stageIntegrations || []).length + (st.checkRuns || []).length
    : 0;
  const loader = $('runLoader');
  if (active && cardCount === 0) {
    loader.hidden = false;
    $('runLoaderLabel').textContent = st ? 'Preparing worktrees…' : 'Spinning up agents…';
  } else {
    loader.hidden = true;
  }
  if (st) {
    lastStartedAt = st.startedAt || run.startedAt || 0;
    $('mStage').textContent = st.wave != null ? `wave ${st.wave}` : `${st.currentStage}/${st.totalStages}`;
    $('mTasks').textContent = `${st.completedTasks}/${st.totalTasks}`;
    $('mCost').textContent = fmtCost(st.totalCost || 0);
    updateConc(st);
    if (run.runId && run.runId !== boardRunId) { boardRunId = run.runId; resetBoardState(); }
    renderBoard(st);
    renderLog(st.logs || []);
    if (S.openCardKey) refreshDrawer(st);
  }
  if (run.phase === 'done' || run.phase === 'error') {
    $('runSummary').innerHTML = run.errorReason
      ? `<b style="color:var(--red)">Failed:</b> ${esc(run.errorReason)}`
      : `<b>Done.</b> Pipeline “${esc(run.pipelineName)}” finished.`;
  } else { $('runSummary').textContent = ''; }

  // /simulation drives its own chrome (pause / run-again); the launch flow
  // drives the concurrent queue (archive + stop-queue strip).
  if (S.sim) updateSimChrome(run);
  else updateQueueChrome();
}

/**
 * The project selector — one tab per concurrent run, shown only when MORE THAN
 * ONE run is tracked. Clicking a tab switches the viewed run.
 */
function renderRunSelector() {
  const el = $('runSelector');
  if (!el) return;
  const runs = [...S.runs.values()].filter((r) => r.runId);
  if (runs.length <= 1) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = runs
    .map((r) => {
      const sel = r.runId === S.activeRunId ? ' run-tab--active' : '';
      const name = esc(r.pipelineName || r.runId);
      return (
        `<button class="run-tab${sel}" data-runid="${esc(r.runId)}" data-phase="${esc(r.phase)}" ` +
        `title="${name} · ${esc(r.phase)}"><span class="run-tab__dot"></span>${name}</button>`
      );
    })
    .join('');
}

function setStatus(phase) {
  const label = { idle: 'idle', running: 'running', done: 'done', error: 'error' }[phase] || phase;
  $('statusText').textContent = label;
  $('statusPill').dataset.s = phase;
}

// Local 1s tick so elapsed advances smoothly between SSE frames.
setInterval(() => {
  if (S.run.phase === 'running' && lastStartedAt) {
    $('mElapsed').textContent = fmtDur(Date.now() - lastStartedAt);
  } else if (S.run.state && S.run.finishedAt && lastStartedAt) {
    $('mElapsed').textContent = fmtDur(S.run.finishedAt - lastStartedAt);
  }
}, 1000);

/* ---------------- Concurrency control (topbar) ---------------- */
function updateConc(st) {
  $('concVal').textContent = st.concurrency;
  const mode = st.autoScale ? st.autoScale.mode : 'manual';
  $('concTag').textContent = mode === 'greedy' ? 'MAX' : mode;
}
$('concMode').addEventListener('click', async () => {
  const cur = S.run.state && S.run.state.autoScale ? S.run.state.autoScale.mode : 'manual';
  const next = cur === 'auto' ? 'manual' : cur === 'manual' ? 'greedy' : 'auto';
  try { await api('/api/run/concurrency', { method: 'POST', body: JSON.stringify({ mode: next, runId: S.activeRunId }) }); } catch (e) { toast(e.message, true); }
});
$('concUp').addEventListener('click', () => adjustConc(1));
$('concDown').addEventListener('click', () => adjustConc(-1));
async function adjustConc(d) { try { await api('/api/run/concurrency', { method: 'POST', body: JSON.stringify({ delta: d, runId: S.activeRunId }) }); } catch (e) { toast(e.message, true); } }

$('abortBtn').addEventListener('click', async () => {
  // Aborts only the VIEWED run (the queue-wide stop is a separate button).
  try { await api('/api/run/abort', { method: 'POST', body: JSON.stringify({ runId: S.activeRunId }) }); toast('Stopping run…'); } catch (e) { toast(e.message, true); }
});

// Project selector: click a tab to switch which run's board is shown.
(() => {
  const rsel = $('runSelector');
  if (rsel) rsel.addEventListener('click', (e) => {
    const btn = e.target.closest('.run-tab');
    if (!btn) return;
    S.activeRunId = btn.dataset.runid;
    renderRunSelector();
    renderActiveRun();
  });
})();

/* ---------------- Board reconciler ---------------- */
const ACTIVE_PHASES = new Set(['worktree_creating','worktree_ready','session_starting','streaming','tool_running','finalizing','validating','committing','pushing','cleaning_up']);
const cardEls = new Map(); // key -> element

// --- Card-move animation (FLIP) ---------------------------------------------
// Cards are REUSED dom nodes keyed by card.key, so a lane change is the SAME
// node re-parented into another lane body. We animate that move with the FLIP
// technique (First/Last/Invert/Play): measure the old box, let the reconciler
// drop the node into the new lane's FIRST slot, then animate old -> new with a
// `transform` only (GPU-composited; never width/height/top/left → no layout
// thrash). Cross-column flights ride a body-level overlay so the lane's
// overflow clip doesn't cut them off mid-air.
const boardOrder = createBoardOrder();  // pure lane-ordering + mover detection (board-order.js)
const ghosts = new Map();     // key -> { node } for an in-flight cross-lane ghost
let boardRunId = null;        // wipe board state when the run changes
let flipLayer = null;         // lazy body-level overlay for cross-column ghosts
const FLIP_MS = 400, FLIP_EASE = 'cubic-bezier(.2,.7,.3,1)', MAX_FLIP_CARDS = 400;

function prefersReducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
function ensureFlipLayer() {
  if (!flipLayer) { flipLayer = document.createElement('div'); flipLayer.className = 'flip-layer'; document.body.appendChild(flipLayer); }
  return flipLayer;
}
function killGhost(key) {
  const g = ghosts.get(key);
  if (!g) return;
  ghosts.delete(key);
  g.node.remove();
  const el = cardEls.get(key);
  if (el) el.style.visibility = '';
}
// Full reset between runs: keys (a1, a2…) repeat across runs, so without this a
// fresh run's pending cards would be mistaken for movers and fly in from nowhere.
function resetBoardState() {
  for (const k of [...ghosts.keys()]) killGhost(k);
  for (const [, el] of cardEls) el.remove();
  cardEls.clear(); boardOrder.reset();
  for (const lane of ['todo', 'doing', 'done']) { const b = $('lane' + cap(lane)); if (b) b.innerHTML = ''; }
}
function captureCardRects() {
  const m = new Map();
  for (const [k, el] of cardEls) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    m.set(k, { left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return m;
}
// Last + Invert + Play. Reads are batched (one layout flush), then all inverts
// are written, then a SINGLE forced reflow commits them, then one rAF plays the
// whole batch — so N moving cards animate in lockstep with zero per-card thrash.
function playCardFlip(first, movers) {
  const tasks = [];
  for (const [k, el] of cardEls) {
    const f = first.get(k);
    if (!f || !el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const dx = f.left - r.left, dy = f.top - r.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    tasks.push({ key: k, el, last: r, dx, dy, cross: movers.has(k) });
  }
  if (!tasks.length) return;

  const layer = tasks.some((t) => t.cross) ? ensureFlipLayer() : null;
  for (const t of tasks) {
    if (t.cross) {
      killGhost(t.key);                                   // re-entrancy: drop any prior ghost
      const g = t.el.cloneNode(true);
      g.className = t.el.className + ' card--ghost';
      g.style.left = t.last.left + 'px';
      g.style.top = t.last.top + 'px';
      g.style.width = t.last.width + 'px';
      g.style.height = t.last.height + 'px';
      g.style.visibility = '';                            // the source may be mid-hide; the ghost must show
      g.style.transition = 'none';
      g.style.transform = `translate(${t.dx}px, ${t.dy}px)`;
      layer.appendChild(g);
      t.el.style.visibility = 'hidden';                   // hold the destination slot; no reflow
      t.ghost = g;
      ghosts.set(t.key, { node: g });
    } else {
      t.el.style.transition = 'none';
      t.el.style.willChange = 'transform';
      t.el.style.transform = `translate(${t.dx}px, ${t.dy}px)`;
    }
  }

  void document.body.offsetWidth;                         // one reflow → commit the inverted state

  requestAnimationFrame(() => {
    for (const t of tasks) {
      const node = t.cross ? t.ghost : t.el;
      let settled = false;
      const finish = () => {
        if (settled) return; settled = true;
        node.removeEventListener('transitionend', onEnd);
        clearTimeout(timer);
        if (t.cross) {
          if (ghosts.get(t.key) && ghosts.get(t.key).node === node) ghosts.delete(t.key);
          node.remove();
          if (t.el.isConnected) t.el.style.visibility = '';
        } else {
          node.style.transition = ''; node.style.willChange = '';
        }
      };
      const onEnd = (e) => { if (!e || e.propertyName === 'transform') finish(); };
      node.addEventListener('transitionend', onEnd);
      const timer = setTimeout(finish, FLIP_MS + 140);    // fallback if transitionend is missed (e.g. backgrounded tab)
      node.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
      node.style.transform = t.cross ? 'translate(0, 0)' : '';
    }
  });
}

function cardsFromState(st) {
  const out = [];
  for (const a of st.agents || []) out.push(agentCard(a));
  for (const m of st.stageIntegrations || []) out.push(mergeCard(m));
  for (const j of st.checkRuns || []) out.push(judgeCard(j));
  return out;
}

function laneOf(c) {
  if (c.lane) return c.lane;
  return 'done';
}

function agentCard(a) {
  let lane = 'doing', cls = 'active', plabel = humanize(a.phase);
  if (a.phase === 'pending') { lane = 'todo'; cls = 'idle'; plabel = a.requeues ? 'requeued' : 'queued'; }
  else if (a.phase === 'done') { lane = 'done'; cls = 'done'; }
  else if (a.phase === 'no_changes') { lane = 'done'; cls = 'done'; plabel = 'no changes'; }
  else if (a.phase === 'error') { lane = 'done'; cls = 'err'; }
  return {
    key: 'a' + a.agentId, kind: 'agent', lane, cls, plabel,
    title: a.stageName || `Task ${a.agentId}`,
    file: (a.currentFile || (a.files && a.files[0]) || ''),
    idText: '#' + a.agentId,
    streaming: a.phase === 'streaming' || a.phase === 'tool_running',
    foot: footBits([
      a.tokensOut ? `${fmtNum(a.tokensIn + a.tokensOut)} tok` : '',
      a.cost ? `$${a.cost.toFixed(3)}` : '',
      a.requeues ? `↻${a.requeues}` : '',
    ], a.requeues),
    raw: a,
  };
}
function mergeCard(m) {
  let lane = 'doing', cls = 'active';
  if (m.phase === 'done' || m.phase === 'skipped') { lane = 'done'; cls = 'done'; }
  else if (m.phase === 'error') { lane = 'done'; cls = 'err'; }
  else if (m.phase === 'pending') { lane = 'todo'; cls = 'idle'; }
  return {
    key: 'm' + m.visitIndex, kind: 'merge', lane, cls, plabel: humanize(m.phase),
    title: 'Merge · ' + (m.stageName || ''),
    file: (m.branchesMerged && m.branchesMerged.length ? `${m.branchesMerged.length} merged` : ''),
    idText: m.runs > 1 ? `×${m.runs}` : '',
    streaming: m.phase === 'merging' || m.phase === 'conflict_resolving',
    foot: footBits([m.resolverUsed ? 'resolver' : '', (m.conflicts && m.conflicts.length) ? `${m.conflicts.length} conflict` : '']),
    raw: m,
  };
}
function judgeCard(j) {
  let lane = 'doing', cls = 'active';
  if (j.phase === 'done') { lane = 'done'; cls = 'done'; }
  else if (j.phase === 'error') { lane = 'done'; cls = 'err'; }
  return {
    key: 'j' + j.visitIndex, kind: 'judge', lane, cls, plabel: humanize(j.phase),
    title: 'Judge · ' + (j.stepName || ''),
    file: j.outcomeLabel ? `→ ${j.outcomeLabel}` : esc(j.condition || '').slice(0, 60),
    idText: j.runs ? `run ${j.runs}` : '',
    streaming: j.phase === 'judging',
    foot: footBits([j.fromJudge === false ? 'default' : '', j.nextStepName ? `next: ${j.nextStepName}` : '']),
    raw: j,
  };
}

function footBits(parts, requeue) {
  return parts.filter(Boolean).map((p) =>
    (requeue && p.startsWith('↻')) ? `<span class="requeue">${p}</span>` : `<span class="metriclet">${esc(p)}</span>`
  ).join('');
}

function renderBoard(st) {
  const cards = cardsFromState(st);
  for (const c of cards) c.lane = laneOf(c);   // normalize to todo|doing|done
  const seen = new Set(cards.map((c) => c.key));

  // A card that CHANGED lane floats to the destination's FIRST slot (newest
  // mover on top); new cards keep natural order. See board-order.js.
  const { movers, byLane } = boardOrder.place(cards);

  // Positions only change when a card is added, removed, or moved lane — so only
  // then is it worth measuring boxes for the FLIP (keeps idle frames cheap).
  let structural = movers.size > 0;
  if (!structural) for (const c of cards) if (!cardEls.has(c.key)) { structural = true; break; }
  if (!structural) for (const k of cardEls.keys()) if (!seen.has(k)) { structural = true; break; }
  const animate = structural && !prefersReducedMotion() && !$('viewRun').hidden && cardEls.size <= MAX_FLIP_CARDS;

  // FLIP — First: snapshot current boxes BEFORE mutating the DOM.
  const first = animate ? captureCardRects() : null;

  // Remove stale cards (cancel any in-flight ghost + drop tracking entries).
  for (const [k, el] of cardEls) {
    if (!seen.has(k)) { killGhost(k); el.remove(); cardEls.delete(k); boardOrder.drop(k); }
  }

  // Reconcile each lane in rank order.
  for (const lane of ['todo', 'doing', 'done']) {
    const body = $('lane' + cap(lane));
    const list = byLane[lane];
    $('cnt' + cap(lane)).textContent = list.length;
    let anchor = null;
    for (const c of list) {
      let el = cardEls.get(c.key);
      if (!el) { el = document.createElement('button'); el.type = 'button'; el.className = 'card'; cardEls.set(c.key, el); el.addEventListener('click', () => openDrawer(c.key)); }
      paintCard(el, c);
      if (el.parentElement !== body || el.previousElementSibling !== anchor) {
        body.insertBefore(el, anchor ? anchor.nextSibling : body.firstChild);
      }
      anchor = el;
    }
    // empty placeholder
    let ph = body.querySelector('.lane__empty');
    if (!list.length) { if (!ph) { ph = document.createElement('div'); ph.className = 'lane__empty'; ph.textContent = '—'; body.appendChild(ph); } }
    else if (ph) ph.remove();
  }

  // FLIP — Last + Invert + Play.
  if (animate) playCardFlip(first, movers);
}

function paintCard(el, c) {
  el.dataset.kind = c.kind;
  el.dataset.key = c.key;
  el.classList.toggle('streaming', !!c.streaming);
  el.innerHTML = `
    <div class="card__top">
      <span class="card__kind">${c.kind}</span>
      <span class="card__id">${esc(c.idText || '')}</span>
    </div>
    <div class="card__title">${esc(c.title)}</div>
    ${c.file ? `<div class="card__file">${esc(c.file)}</div>` : ''}
    <div class="card__foot">
      <span class="phase ${c.cls}"><i></i>${esc(c.plabel)}</span>
      ${c.foot}
    </div>`;
}

/* ---------------- Drawer ---------------- */
const scrim = $('drawerScrim'), drawer = $('drawer');
function closeDrawer() { S.openCardKey = null; drawer.hidden = true; scrim.hidden = true; }
scrim.addEventListener('click', closeDrawer);
$('drawerClose').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

async function openDrawer(key) {
  S.openCardKey = key;
  drawer.hidden = false; scrim.hidden = false;
  $('drawerLogs').textContent = ''; // fresh element → first render starts pinned to bottom
  if (S.run.state) refreshDrawer(S.run.state);
  if (key[0] === 'a') {
    const id = +key.slice(1);
    try { const r = await api('/api/agent-logs?id=' + id); setDrawerLogs((r.logs || []).join('\n') || '(no logs yet)', true); } catch {}
  }
}

function findCard(st, key) {
  if (key[0] === 'a') return agentCard((st.agents || []).find((a) => a.agentId === +key.slice(1)) || {});
  if (key[0] === 'm') return mergeCard((st.stageIntegrations || []).find((m) => m.visitIndex === +key.slice(1)) || {});
  if (key[0] === 'j') return judgeCard((st.checkRuns || []).find((j) => j.visitIndex === +key.slice(1)) || {});
  return null;
}

function refreshDrawer(st) {
  const c = findCard(st, S.openCardKey);
  if (!c || !c.raw) return;
  $('drawerTitle').textContent = c.title;
  $('drawerMeta').innerHTML = drawerMeta(c);
  if (S.openCardKey[0] === 'a') {
    // live tail from streamed state (full set fetched on open)
    const logs = c.raw.logs;
    if (logs && logs.length) setDrawerLogs(logs.join('\n'));
  } else {
    const lines = [];
    if (c.raw.condition) lines.push('Condition:\n' + c.raw.condition);
    if (c.raw.reason) lines.push('\nReason:\n' + c.raw.reason);
    if (c.raw.lastLog) lines.push('\n' + c.raw.lastLog);
    if (c.raw.error) lines.push('\nError:\n' + c.raw.error);
    setDrawerLogs(lines.join('\n') || '(no detail)');
  }
}

/* Swap the drawer's log text WITHOUT yanking the reader to the bottom on every
   snapshot. Follow the tail only when they were already pinned there (or `force`
   on first open); if they scrolled up to read, their position is preserved.
   Bailing on identical text avoids a needless scroll reset between snapshots. */
const STICK_THRESHOLD_PX = 28;
function setDrawerLogs(text, force) {
  const el = $('drawerLogs');
  if (el.textContent === text) return;
  const pinned = force || el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD_PX;
  const prevTop = el.scrollTop;
  el.textContent = text;
  el.scrollTop = pinned ? el.scrollHeight : prevTop;
}

function kv(k, v, opts = {}) {
  if (v === undefined || v === null || v === '') return '';
  return `<div class="kv ${opts.wide ? 'kv--wide' : ''}"><span class="kv__k">${esc(k)}</span><span class="kv__v ${opts.mono ? 'mono' : ''} ${opts.err ? 'err' : ''}">${esc(String(v))}</span></div>`;
}
function drawerMeta(c) {
  const r = c.raw;
  if (c.kind === 'agent') {
    return [
      kv('Phase', humanize(r.phase)), kv('Stage', r.stageName),
      kv('Tokens in', fmtNum(r.tokensIn || 0)), kv('Tokens out', fmtNum(r.tokensOut || 0)),
      kv('Cost', r.cost != null ? '$' + r.cost.toFixed(4) : ''), kv('Requeues', r.requeues || 0),
      kv('Branch', r.branchName, { mono: true, wide: true }),
      kv('Files', (r.filesModified || []).join(', '), { mono: true, wide: true }),
      kv('Commit', r.commitSha ? r.commitSha.slice(0, 10) : '', { mono: true }),
      kv('Push', r.pushStatus),
      r.error ? kv('Error', r.error, { wide: true, err: true }) : '',
    ].join('');
  }
  if (c.kind === 'merge') {
    return [
      kv('Phase', humanize(r.phase)), kv('Runs', r.runs),
      kv('Merged', (r.branchesMerged || []).length), kv('Pending', (r.branchesPending || []).length),
      kv('Resolver', r.resolverUsed ? 'used' : 'no'), kv('Conflicts', (r.conflicts || []).length),
      kv('Model', r.modelId, { mono: true, wide: true }),
      r.error ? kv('Error', r.error, { wide: true, err: true }) : '',
    ].join('');
  }
  return [
    kv('Phase', humanize(r.phase)), kv('Run', r.runs),
    kv('Outcome', r.outcomeLabel), kv('Next', r.nextStepName),
    kv('From judge', r.fromJudge === false ? 'default' : 'yes'),
    kv('Model', r.modelId, { mono: true, wide: true }),
    r.error ? kv('Error', r.error, { wide: true, err: true }) : '',
  ].join('');
}

/* ---------------- Global log ---------------- */
$('logToggle').addEventListener('click', () => {
  S.logOpen = !S.logOpen;
  $('logbar').classList.toggle('open', S.logOpen);
  $('logToggle').setAttribute('aria-expanded', String(S.logOpen));
});
function renderLog(logs) {
  $('logMeta').textContent = logs.length ? `${logs.length} lines` : '';
  if (!S.logOpen) return;
  const body = $('logBody');
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  body.innerHTML = logs.map((l) => {
    const t = new Date(l.timestamp).toLocaleTimeString();
    const src = l.agentId >= 0 && l.agentId < 9000 ? `#${l.agentId}` : (l.kind || '');
    return `<div class="logline ${esc(l.level)}"><span class="lt">${t}</span><span class="ls">${esc(src)}</span><span class="lm">${esc(l.message)}</span></div>`;
  }).join('');
  if (atBottom) body.scrollTop = body.scrollHeight;
}

/* ---------------- Utils ---------------- */
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
function humanize(s) { return String(s || '').replace(/_/g, ' '); }
function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
// Costs are summed per-card from OpenRouter's authoritative usage.cost (USD).
// They're often sub-cent, so show 4 decimals until the total clears $1 —
// otherwise a live run reads "$0.00" and looks like it isn't metering.
function fmtCost(n) { return '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(4)); }
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(ss).padStart(2, '0');
}
let toastT = null;
function toast(msg, isErr) {
  const t = $('toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 250); }, 2600);
}

boot().catch((e) => { document.body.insertAdjacentHTML('afterbegin', `<div class="run-error" style="margin:20px">Failed to load huu: ${esc(e.message)}</div>`); });
