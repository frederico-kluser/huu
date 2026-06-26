/* huu web UI — vanilla ES module. Real-time over one SSE stream, actions over
   fetch POSTs. No framework, no build, no CDN: works offline and in Docker. */

const $ = (id) => document.getElementById(id);
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
  run: { phase: 'idle' },
  openCardKey: null,
  logOpen: false,
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
  if (b.defaults && typeof b.defaults.concurrency === 'number') { S.manualN = b.defaults.concurrency; }
  if (b.defaults && b.defaults.autoScale === false) { S.mode = 'manual'; }
  S.provider = b.lockedProvider || pickDefaultProvider(b.providers);
  S.backend = providerBackend(S.provider);
  renderGallery();
  if (b.initialPipeline) selectPipelineByName(b.initialPipeline);
  ingestRun(b.run);
  connectSse();
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
      renderProviderSeg();
      await refreshModelsAndKeys();
    });
    seg.appendChild(btn);
  }
}

async function refreshModelsAndKeys() {
  // Models (by provider). For OpenRouter we attach the validated session key so
  // the server returns the LIVE catalog filtered to tool-calling + reasoning
  // models; without a key it returns the static recommended list.
  try {
    const orKey = S.provider === 'openrouter' ? sessionKey(backendSpecName(S.backend)) : '';
    const m = await api(
      '/api/models?provider=' + encodeURIComponent(S.provider),
      orKey ? { headers: { 'x-huu-key': orKey } } : undefined,
    );
    S.models = m.models || [];
    S.modelSource = m.source || 'recommended';
  } catch { S.models = []; S.modelSource = 'recommended'; }
  // Keep the current pick if it survived the provider/key change; else default.
  if (!S.models.length) S.modelId = '';
  else if (!S.models.some((x) => x.id === S.modelId)) S.modelId = S.models[0].id;
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
  if (!md) { h.innerHTML = ''; return; }
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
   is the LIVE catalog of every model with tool calling + reasoning, loaded with
   the validated session key (see refreshModelsAndKeys). */
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
  input.value = md ? md.label : '';
  input.placeholder = S.models.length ? 'Search models…' : 'default model';
}

function updateModelCap() {
  const cap = $('modelCap');
  if (!cap) return;
  const n = S.models.length;
  if (S.provider !== 'openrouter') { cap.textContent = n ? `${n} model${n === 1 ? '' : 's'} available` : ''; return; }
  if (S.modelSource === 'openrouter-live') {
    cap.innerHTML = `<span class="live">${n} models</span> · tool calling + reasoning · via your OpenRouter key`;
  } else {
    cap.textContent = 'Showing recommended models — validate your OpenRouter key to load every tool-calling + reasoning model';
  }
}

function comboMatches() {
  const q = combo.query.trim().toLowerCase();
  if (!q) return S.models.slice();
  return S.models.filter((m) =>
    m.id.toLowerCase().includes(q) || (m.label || '').toLowerCase().includes(q));
}

function modelOptionHtml(m, i, active, sel) {
  const price = m.inputPrice != null ? `$${m.inputPrice}/M·$${m.outputPrice ?? '?'}/M` : '';
  const meta = [m.tier, fmtCtx(m.contextLength), price].filter(Boolean).join(' · ');
  return `<li class="combo__opt${active ? ' active' : ''}${sel ? ' sel' : ''}" role="option" id="opt-${i}" data-id="${esc(m.id)}" aria-selected="${sel ? 'true' : 'false'}">` +
    `<span class="combo__opt-name">${esc(m.label || m.id)}</span>` +
    (m.thinking ? '<span class="combo__badge">reasoning</span>' : '') +
    (meta ? `<span class="combo__opt-meta">${esc(meta)}</span>` : '') +
    `<span class="combo__opt-id">${esc(m.id)}</span></li>`;
}

function renderModelOptions() {
  const list = $('modelList');
  const matches = comboMatches();
  combo.matches = matches;
  if (combo.active >= matches.length) combo.active = matches.length - 1;
  if (!S.models.length) { list.innerHTML = '<li class="combo__empty">No models available</li>'; return; }
  if (!matches.length) { list.innerHTML = '<li class="combo__empty">No matches</li>'; return; }
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
  if (id && !modelById(id)) return;
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
  const ok = S.selectedPipe && S.keyStatus.ok;
  $('runBtn').disabled = !ok;
}

/* ---------------- Run submit ---------------- */
$('configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!S.selectedPipe) return;
  $('runError').hidden = true;
  $('runBtn').disabled = true;
  try {
    await api('/api/run', {
      method: 'POST',
      body: JSON.stringify({
        pipelineName: S.selectedPipe.name,
        provider: S.provider,
        modelId: S.modelId,
        mode: S.mode,
        concurrency: S.mode === 'manual' ? S.manualN : undefined,
        // Browser-only key: send the validated, in-memory key for this run.
        // Omitted → server falls back to its env/mount/disk resolver.
        apiKey: sessionKey(backendSpecName(S.backend)) || undefined,
        // Azure also needs its endpoint URL; harmless (empty) for OpenRouter.
        endpoint: sessionKey('azureEndpoint') || undefined,
        runDirectory: S.runDir || undefined,
      }),
    });
    showView('run');
  } catch (err) {
    $('runError').textContent = err.message;
    $('runError').hidden = false;
    updateRunBtn();
  }
});

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
}
$('backToLaunch').addEventListener('click', () => { showView('launch'); renderGallery(); });

/* ---------------- SSE ---------------- */
let es = null;
function connectSse() {
  if (es) es.close();
  es = new EventSource(withTok('/events'));
  es.onmessage = (ev) => {
    try { const frame = JSON.parse(ev.data); if (frame && frame.type === 'run') ingestRun(frame.run); } catch {}
  };
  es.onerror = () => { /* EventSource auto-reconnects; nothing to do */ };
}

/* ---------------- Ingest run snapshot ---------------- */
let lastStartedAt = 0;
function ingestRun(run) {
  if (!run) return;
  S.run = run;
  const active = run.phase === 'running';
  const hasRun = run.phase !== 'idle';

  $('runStatusGroup').hidden = !hasRun;
  $('concControl').hidden = !active;
  $('abortBtn').hidden = !active;

  // Auto-switch to the run view while a run is live or just finished.
  if (hasRun && $('viewRun').hidden) showView('run');
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
    $('mCost').textContent = '$' + (st.totalCost || 0).toFixed(2);
    updateConc(st);
    renderBoard(st);
    renderLog(st.logs || []);
    if (S.openCardKey) refreshDrawer(st);
  }
  if (run.phase === 'done' || run.phase === 'error') {
    $('runSummary').innerHTML = run.errorReason
      ? `<b style="color:var(--red)">Failed:</b> ${esc(run.errorReason)}`
      : `<b>Done.</b> Pipeline “${esc(run.pipelineName)}” finished.`;
  } else { $('runSummary').textContent = ''; }
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
  try { await api('/api/run/concurrency', { method: 'POST', body: JSON.stringify({ mode: next }) }); } catch (e) { toast(e.message, true); }
});
$('concUp').addEventListener('click', () => adjustConc(1));
$('concDown').addEventListener('click', () => adjustConc(-1));
async function adjustConc(d) { try { await api('/api/run/concurrency', { method: 'POST', body: JSON.stringify({ delta: d }) }); } catch (e) { toast(e.message, true); } }

$('abortBtn').addEventListener('click', async () => {
  try { await api('/api/run/abort', { method: 'POST' }); toast('Stopping run…'); } catch (e) { toast(e.message, true); }
});

/* ---------------- Board reconciler ---------------- */
const ACTIVE_PHASES = new Set(['worktree_creating','worktree_ready','session_starting','streaming','tool_running','finalizing','validating','committing','pushing','cleaning_up']);
const cardEls = new Map(); // key -> element

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
  const byLane = { todo: [], doing: [], done: [] };
  const seen = new Set();
  for (const c of cards) { byLane[laneOf(c)].push(c); seen.add(c.key); }

  // Remove stale
  for (const [k, el] of cardEls) { if (!seen.has(k)) { el.remove(); cardEls.delete(k); } }

  for (const lane of ['todo', 'doing', 'done']) {
    const body = $('lane' + cap(lane));
    const list = byLane[lane];
    $('cnt' + cap(lane)).textContent = list.length;
    // Build in order, moving/creating as needed.
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
  if (S.run.state) refreshDrawer(S.run.state);
  if (key[0] === 'a') {
    const id = +key.slice(1);
    try { const r = await api('/api/agent-logs?id=' + id); $('drawerLogs').textContent = (r.logs || []).join('\n') || '(no logs yet)'; scrollLogs(); } catch {}
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
    if (logs && logs.length) { $('drawerLogs').textContent = logs.join('\n'); scrollLogs(); }
  } else {
    const lines = [];
    if (c.raw.condition) lines.push('Condition:\n' + c.raw.condition);
    if (c.raw.reason) lines.push('\nReason:\n' + c.raw.reason);
    if (c.raw.lastLog) lines.push('\n' + c.raw.lastLog);
    if (c.raw.error) lines.push('\nError:\n' + c.raw.error);
    $('drawerLogs').textContent = lines.join('\n') || '(no detail)';
  }
}
function scrollLogs() { const l = $('drawerLogs'); l.scrollTop = l.scrollHeight; }

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
