/* huu web UI — vanilla ES module. Real-time over one SSE stream, actions over
   fetch POSTs. No framework, no build, no CDN: works offline and in Docker. */

const $ = (id) => document.getElementById(id);
const TOKEN = new URLSearchParams(location.search).get('token') || '';
const withTok = (url) => (TOKEN ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN) : url);

async function api(path, opts) {
  const res = await fetch(withTok(path), {
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'x-huu-token': TOKEN } : {}) },
    ...opts,
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
  backend: 'pi',
  models: [],
  modelId: '',
  mode: 'auto',
  manualN: 10,
  keyStatus: { ok: true, missing: [] },
  run: { phase: 'idle' },
  openCardKey: null,
  logOpen: false,
};

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
  $('repoName').textContent = b.repo || '';
  document.title = `huu · ${b.repo || 'web'}`;
  if (b.defaults && typeof b.defaults.concurrency === 'number') { S.manualN = b.defaults.concurrency; }
  if (b.defaults && b.defaults.autoScale === false) { S.mode = 'manual'; }
  S.backend = b.lockedBackend || pickDefaultBackend(b.backends);
  renderGallery();
  if (b.initialPipeline) selectPipelineByName(b.initialPipeline);
  ingestRun(b.run);
  connectSse();
}

function pickDefaultBackend(backends) {
  const usable = (backends || []).find((x) => x.userSelectable && x.hasKey);
  if (usable) return usable.id;
  const sel = (backends || []).find((x) => x.userSelectable);
  return sel ? sel.id : 'pi';
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
  renderBackendSeg();
  await refreshModelsAndKeys();
  renderModeSeg();
}

/* ---------------- Launch: backend + models + keys ---------------- */
function renderBackendSeg() {
  const seg = $('backendSeg');
  seg.innerHTML = '';
  const locked = !!(S.boot && S.boot.lockedBackend);
  for (const b of S.boot.backends) {
    if (!b.userSelectable && b.id !== 'stub') continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = S.backend === b.id ? 'on' : '';
    btn.textContent = b.id === 'stub' ? 'Demo' : b.label.replace(/\s*\(.*\)/, '');
    btn.title = b.description + (b.requiresApiKey ? (b.hasKey ? ' · key ✓' : ' · key needed') : '');
    if (locked && b.id !== S.boot.lockedBackend) btn.disabled = true;
    btn.addEventListener('click', async () => { S.backend = b.id; renderBackendSeg(); await refreshModelsAndKeys(); });
    seg.appendChild(btn);
  }
}

async function refreshModelsAndKeys() {
  // Models
  try {
    const m = await api('/api/models?backend=' + S.backend);
    S.models = m.models || [];
  } catch { S.models = []; }
  const sel = $('modelSelect');
  sel.innerHTML = '';
  if (!S.models.length) {
    const o = document.createElement('option'); o.value = ''; o.textContent = 'default model'; sel.appendChild(o);
    S.modelId = '';
  } else {
    for (const md of S.models) {
      const o = document.createElement('option');
      o.value = md.id;
      o.textContent = md.label + (md.tier ? `  ·  ${md.tier}` : '');
      sel.appendChild(o);
    }
    S.modelId = S.models[0].id;
    sel.value = S.modelId;
  }
  updateModelHint();
  // Keys
  if (S.backend === 'stub') { S.keyStatus = { ok: true, missing: [] }; }
  else {
    try { S.keyStatus = await api('/api/keys?backend=' + S.backend); } catch { S.keyStatus = { ok: true, missing: [] }; }
  }
  renderKeyField();
  updateRunBtn();
}

function updateModelHint() {
  const md = S.models.find((x) => x.id === S.modelId);
  const h = $('modelHint');
  if (!md) { h.innerHTML = ''; return; }
  const price = md.inputPrice != null ? `$${md.inputPrice}/M in · $${md.outputPrice ?? '?'}/M out` : '';
  const think = md.thinking ? `<span class="thinking">thinking</span> · ` : '';
  h.innerHTML = `${think}${esc(md.description || '')} ${price ? `<br>${price}` : ''}`;
}

function renderKeyField() {
  const f = $('keyField');
  if (S.keyStatus.ok || !S.keyStatus.missing.length) { f.hidden = true; return; }
  const spec = S.keyStatus.missing[0];
  f.hidden = false;
  $('keyLabel').textContent = `${spec.label} key needed`;
  $('keyInput').placeholder = spec.hint ? spec.hint : 'paste key…';
  $('keyHint').textContent = spec.validatePrefix ? `Expected to start with “${spec.validatePrefix}”.` : '';
  $('keyInput').dataset.spec = spec.name;
}

$('keySave').addEventListener('click', async () => {
  const name = $('keyInput').dataset.spec;
  const value = $('keyInput').value.trim();
  if (!name || !value) return;
  try {
    await api('/api/keys', { method: 'POST', body: JSON.stringify({ name, value }) });
    $('keyInput').value = '';
    toast('Key saved');
    await refreshModelsAndKeys();
  } catch (e) { toast(e.message, true); }
});

$('modelSelect').addEventListener('change', (e) => { S.modelId = e.target.value; updateModelHint(); });

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
  const ok = S.selectedPipe && (S.backend === 'stub' || S.keyStatus.ok);
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
        backend: S.backend,
        modelId: S.modelId,
        mode: S.mode,
        concurrency: S.mode === 'manual' ? S.manualN : undefined,
      }),
    });
    showView('run');
  } catch (err) {
    $('runError').textContent = err.message;
    $('runError').hidden = false;
    updateRunBtn();
  }
});

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
