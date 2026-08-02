/* huu web UI — development mode (/dev). */

import { buildDevModelsPayload, describeDevModelsPayload, presetValues } from '../dev-models.js';
import { buildDevMethodologyPayload, parseStoredMethodology } from '../dev-methodology.js';
import { esc, toast, shortDir, projectName } from './utils.js';
import { $, S, api, DEFAULT_MODEL_ID, sessionKey, backendSpecName, providerInfoById, providerReady, providerBackend } from './state.js';
import { showView, switchMode, refreshModelsAndKeys, wireModeSwitch } from './launch.js';
import { saveSettings, SETTINGS_LS } from './settings.js';
import { renderActiveRun } from './board.js';
import { boot } from '../app.js';
import { t } from '../i18n.js';

/* ---------------- Development mode (/dev) ----------------
   Goal in, swarm of parallel FRONTS out. Each epoch is an ordinary run, so the
   server pushes it through the SAME `{type:'run'}` frames the board already
   renders — everything below only handles the SESSION layer: the knowledge
   probe, the epoch chain, and the approval gate. */

const DEV_PHASE_LABEL = {
  idle: 'ocioso',
  probing: 'verificando knowledge-skills',
  bootstrapping: 'bootstrap de skills (swarm MAX)',
  // Fase A da época v2: o run de conhecimento (lacunas → briefs → digest) que
  // precede o plano. É um ESTADO próprio, não um "planning" adiantado — sem
  // ele o rótulo cairia no fallback cru e a época pareceria travada.
  knowledge: 'levantando conhecimento (fase A)',
  planning: 'planejando a época',
  'awaiting-approval': 'aguardando sua aprovação',
  running: 'swarm rodando',
  done: 'encerrado',
  error: 'erro',
};

/**
 * Prepare the development surface. Idempotent and LAZY: the launch flow owns
 * boot (SSE, gallery, queue), so this only fills in what is dev-specific, the
 * first time the user actually switches into it.
 */
export function initDevSurface() {
  if (S.devBooted) return;
  S.devBooted = true;
  renderDevProviderSeg();
  initDevModelPanel();
  initDevMethodology();
  // <input id="devModel"> in the dev shell — getElementById only types it as HTMLElement.
  const devModel = /** @type {HTMLInputElement} */ ($('devModel'));
  if (!devModel.value) devModel.value = S.modelId || DEFAULT_MODEL_ID;
  // The launch flow only downloads the model catalog when a PIPELINE is picked
  // — something a direct /dev load never does — so the shared <datalist> behind
  // the per-role fields would sit empty. Fetch it lazily here instead
  // (refreshModelsAndKeys repopulates the datalist itself).
  if (!S.models.length) {
    void refreshModelsAndKeys()
      .then(() => {
        const el = /** @type {HTMLInputElement} */ ($('devModel'));
        if (!el.value) el.value = S.modelId || DEFAULT_MODEL_ID;
      })
      .catch(() => {});
  }
  // Open the browser where the user's projects live, and preselect the repo
  // the server is already running in.
  S.devDir = S.devDir || S.cwd || '';
  loadDevFolder(devFolderState.path || S.boot?.workspace || S.cwd || '');
  renderDevGoalCount();
  // A session may already be running (started from the CLI, another tab, or
  // before a refresh) — re-link instead of showing an empty form.
  api('/api/dev').then((d) => { if (d.session) renderDevSession(d.session); }).catch(() => {});
}

export function renderDevProviderSeg() {
  const seg = $('devProviderSeg');
  if (!seg) return;
  seg.innerHTML = '';
  const locked = !!(S.boot && S.boot.lockedProvider);
  for (const p of S.providers) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = S.provider === p.id ? 'on' : '';
    btn.textContent = p.label + (providerReady(p) ? '' : ' •');
    btn.title = p.description + (providerReady(p) ? ' · key ✓' : ' · key needed');
    if (locked && p.id !== S.boot.lockedProvider) btn.disabled = true;
    btn.addEventListener('click', () => {
      S.provider = p.id;
      S.backend = providerBackend(p.id);
      renderDevProviderSeg();
    });
    seg.appendChild(btn);
  }
}

/* ---------------- Dev: per-role model routing ----------------
   Seven roles, one model each, with named presets. The role list and the preset
   table both come from /api/bootstrap (`devModelRoles` / `devModelPresets`) —
   the same `DEV_MODEL_ROLES` / `DEV_MODEL_PRESETS` the compiler stamps onto the
   steps. ONE source of truth: the client renders the table, it never carries a
   copy that could disagree with what actually runs. A server that doesn't
   advertise them (older build, or the routing turned off) simply gets no panel
   and a POST body identical to today's. Payload shaping is the pure
   `buildDevModelsPayload` in client/dev-models.js. */

// Human copy only — labels, never model ids. An unlisted role still renders
// (with its raw name), so a role added server-side is visible immediately.
const DEV_ROLE_COPY = {
  planner: ['web.role.planner', 'web.role.planner_hint'],
  recon: ['web.role.recon', 'web.role.recon_hint'],
  worker: ['web.role.worker', 'web.role.worker_hint'],
  critic: ['web.role.critic', 'web.role.critic_hint'],
  reporter: ['web.role.reporter', 'web.role.reporter_hint'],
  judge: ['web.role.judge', 'web.role.judge_hint'],
  integration: ['web.role.integration', 'web.role.integration_hint'],
};

const DEV_PRESET_COPY = {
  hetero: ['web.preset.hetero', 'web.preset.hetero_hint'],
  thrifty: ['web.preset.thrifty', 'web.preset.thrifty_hint'],
  // Named honestly: this is the arm of the A/B, not a suggestion.
  monoculture: ['web.preset.monoculture', 'web.preset.monoculture_hint'],
  uniform: ['web.preset.uniform', 'web.preset.uniform_hint'],
};

const devModels = { roles: [], presets: null, preset: 'hetero', values: {} };

/**
 * The fallback id the POST still has to carry (`modelId` is required by the
 * contract) now that the standalone model field is gone from the normal path.
 * Derived from the role fields themselves — `worker` first because it is the
 * role that does most of the work, then `planner`, then whatever is pinned.
 * Falls back to the degraded-path input, and only then to the catalog default.
 */
export function devFallbackModelId() {
  const v = devModels.values || {};
  const pick = (role) => (v[role] || '').trim();
  const derived = pick('worker') || pick('planner')
    || (devModels.roles || []).map(pick).find(Boolean) || '';
  if (derived) return derived;
  const el = /** @type {HTMLInputElement | null} */ ($('devModel'));
  return (el && el.value.trim()) || S.modelId || DEFAULT_MODEL_ID;
}

/** True only when the server advertised BOTH tables. */
export function devModelRoutingAvailable() {
  const b = S.boot || {};
  return Array.isArray(b.devModelRoles) && b.devModelRoles.length > 0
    && !!b.devModelPresets && typeof b.devModelPresets === 'object';
}

export function initDevModelPanel() {
  const panel = $('devModelsPanel');
  const fallback = $('devModelFallbackField');
  if (!panel) return;
  // Exactly one of the two is visible: the role table, or — only when the
  // server never advertised it — the single-model fallback field.
  if (!devModelRoutingAvailable()) {
    panel.hidden = true;
    if (fallback) fallback.hidden = false;
    return;
  }
  panel.hidden = false;
  if (fallback) fallback.hidden = true;
  devModels.roles = S.boot.devModelRoles.slice();
  devModels.presets = S.boot.devModelPresets;
  // Start on `hetero`: routing is a REQUIRED decision here, not an opt-in
  // tweak, so the form opens on the recommended split (strong blind leader,
  // cheap swarm, cross-family critic) rather than on a neutral default that
  // silently collapses every role onto one model.
  const names = Object.keys(devModels.presets);
  devModels.preset = names.includes('hetero') ? 'hetero' : (names[0] || 'hetero');
  devModels.values = presetValues(devModels.roles, devModels.presets, devModels.preset);
  renderDevPresetSeg();
  renderDevRoleFields();
  renderDevModelOptions();
  renderDevModelsSummary();
}

/** Fill the ONE shared <datalist> the seven role inputs point at. */
export function renderDevModelOptions() {
  const list = $('devModelOptions');
  if (!list) return;
  list.innerHTML = (S.models || [])
    .map((m) => `<option value="${esc(m.id)}">${esc(m.label && m.label !== m.id ? m.label : '')}</option>`)
    .join('');
}

export function renderDevPresetSeg() {
  const seg = $('devPresetSeg');
  if (!seg || !devModels.presets) return;
  seg.innerHTML = '';
  for (const name of Object.keys(devModels.presets)) {
    const copy = DEV_PRESET_COPY[name] || [name, ''];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = devModels.preset === name ? 'on' : '';
    btn.dataset.preset = name;
    btn.textContent = copy[0];
    btn.title = copy[1];
    seg.appendChild(btn);
  }
  const hint = $('devPresetHint');
  if (hint) hint.textContent = (DEV_PRESET_COPY[devModels.preset] || ['', ''])[1];
}

export function renderDevRoleFields() {
  const host = $('devRoleFields');
  if (!host) return;
  host.innerHTML = devModels.roles.map((role) => {
    const copy = DEV_ROLE_COPY[role] || [role, ''];
    return `<div class="role">` +
      `<label class="role__label" for="devRole-${esc(role)}">${esc(t(copy[0]))}` +
      `<span class="role__id">${esc(role)}</span></label>` +
      `<input class="role__input" id="devRole-${esc(role)}" data-role="${esc(role)}" type="text"` +
      ` list="devModelOptions" autocomplete="off" spellcheck="false"` +
      ` placeholder="${esc(t('web.role.inherits'))}" value="${esc(devModels.values[role] || '')}" />` +
      (copy[1] ? `<div class="role__hint muted">${esc(t(copy[1]))}</div>` : '') +
      `</div>`;
  }).join('');
}

export function renderDevModelsSummary() {
  const el = $('devModelsSummary');
  if (!el) return;
  el.textContent = describeDevModelsPayload(devModelsPayload());
}

/** The `models` / `modelsPreset` half of the POST body — `{}` when nothing is pinned. */
export function devModelsPayload() {
  if (!devModelRoutingAvailable()) return {};
  return buildDevModelsPayload({
    roles: devModels.roles,
    presets: devModels.presets,
    preset: devModels.preset,
    values: devModels.values,
  });
}

/* ---------------- Dev: methodology toggles ----------------
   The human underwriting the METHOD, not just the goal. The option list comes
   from /api/bootstrap (`devMethodologyOptions`) — the same table the POST
   parser reads — so the panel never carries its own copy. Everything is OFF
   by default, and the selection persists under huu.settings.v1 so the next
   visit restores it. Payload shaping is the pure `buildDevMethodologyPayload`
   in client/dev-methodology.js. */
const devMethods = { options: [], on: new Set() };

/**
 * Render + restore the methodology panel. Called once from initDevSurface,
 * after boot() has the bootstrap payload.
 */
export function initDevMethodology() {
  const panel = $('devMethodPanel');
  if (!panel) return;
  const catalog = S.boot && Array.isArray(S.boot.devMethodologyOptions)
    ? S.boot.devMethodologyOptions
    : [];
  devMethods.options = catalog.filter((o) => o && typeof o.key === 'string');
  // A server that doesn't advertise the catalog (a stale build) gets no panel
  // and a POST body identical to today's — the same degradation as the role
  // panel above.
  panel.hidden = devMethods.options.length === 0;
  if (!devMethods.options.length) return;
  // Restore the persisted selection, limited to keys the server still
  // advertises. The mirror onto S.settings matters: the ⚙ modal's
  // saveSettings() serializes S.settings WHOLESALE, so a selection kept only
  // in this module would be wiped by the next unrelated settings save.
  let stored = [];
  try {
    stored = parseStoredMethodology(
      localStorage.getItem(SETTINGS_LS),
      devMethods.options.map((o) => o.key),
    );
  } catch { /* storage disabled — the selection just won't persist */ }
  devMethods.on = new Set(stored);
  S.settings.devMethodology = [...devMethods.on];
  renderDevMethodology();
}

export function renderDevMethodology() {
  const list = $('devMethodList');
  if (!list) return;
  list.innerHTML = '';
  for (const opt of devMethods.options) {
    const on = devMethods.on.has(opt.key);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'method-check' + (on ? ' on' : '');
    btn.dataset.method = opt.key;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    // The catalog owns the wording, the server owns the LIST. `t()` throws on a
    // missing key, so an option shipped without translations fails loudly here
    // instead of showing English inside a pt-BR page.
    const label = t(`web.dev.method.${opt.key}.label`);
    const desc = t(`web.dev.method.${opt.key}.desc`);
    btn.title = desc;
    btn.innerHTML =
      `<span class="folder-check" aria-hidden="true">${on ? '✓' : ''}</span>` +
      `<span class="method-check__text">` +
      `<span class="method-check__label">${esc(label)}</span>` +
      `<span class="method-check__desc muted">${esc(desc)}</span>` +
      `</span>`;
    list.appendChild(btn);
  }
}

/** The `methodology` half of the POST body — `{}` when nothing is on. */
export function devMethodologyPayload() {
  return buildDevMethodologyPayload([...devMethods.on]);
}

/* ---------------- Dev: project selector ----------------
   The same filesystem browser the pipeline flow uses, but SINGLE-select: a dev
   session ends in a merge into one repo's working branch, so "one project" is
   the invariant, not a limitation. Its own state, so browsing here never
   disturbs a half-built pipeline queue. */
const devFolderState = { path: '', parent: null, listing: null };

export async function loadDevFolder(path) {
  try {
    const d = await api('/api/folders?path=' + encodeURIComponent(path || ''));
    devFolderState.path = d.path;
    devFolderState.parent = d.parent;
    devFolderState.listing = d;
    $('devFolderPath').textContent = d.path;
    $('devFolderPath').title = d.path;
    const git = $('devFolderGit');
    git.textContent = d.isGitRepo ? '✓ git repo' : '⚠ not a git repo';
    git.className = 'folder-modal__git ' + (d.isGitRepo ? 'ok' : 'no');
    /** @type {HTMLButtonElement} */ ($('devFolderUp')).disabled = !d.parent;
    // Landing on a git repo with nothing chosen yet? Pick it — the common case
    // is "the folder I just navigated into IS the project".
    if (d.isGitRepo && !S.devDir) selectDevDir(d.path);
    renderDevFolderList(d);
  } catch (err) { toast(err.message, true); }
}

export function selectDevDir(path) {
  S.devDir = path;
  $('devPickedName').textContent = projectName(path);
  if (devFolderState.listing) renderDevFolderList(devFolderState.listing);
}

export function renderDevFolderList(d) {
  const list = $('devFolderList');
  list.innerHTML = '';
  list.appendChild(devFolderRow(d.path, projectName(d.path) || d.path, { isSelf: true, isGit: d.isGitRepo }));
  if (!d.entries.length) {
    const empty = document.createElement('div');
    empty.className = 'folder-empty';
    empty.textContent = t('web.folder.no_subdirs');
    list.appendChild(empty);
  }
  for (const ent of d.entries) list.appendChild(devFolderRow(ent.path, ent.name, { isSelf: false }));
}

export function devFolderRow(path, label, opts) {
  const picked = S.devDir === path;
  const row = document.createElement('div');
  row.className = 'folder-item' + (opts.isSelf ? ' folder-item--self' : '') + (picked ? ' on' : '');
  const box = document.createElement('button');
  box.type = 'button';
  box.className = 'folder-check folder-check--radio';
  box.setAttribute('aria-pressed', picked ? 'true' : 'false');
  box.title = picked ? t('web.dev.project_selected') : t('web.dev.project_use');
  box.textContent = picked ? '●' : '';
  box.addEventListener('click', (e) => { e.stopPropagation(); selectDevDir(path); });
  row.appendChild(box);
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'folder-item__label';
  const tail = opts.isSelf
    ? `<span class="folder-item__git ${opts.isGit ? 'ok' : 'no'}">${esc(opts.isGit ? t('web.folder.is_git') : t('web.folder.not_git'))}</span>`
    : '<span class="folder-item__go" aria-hidden="true">›</span>';
  name.innerHTML = `<span class="folder-item__icon" aria-hidden="true">${opts.isSelf ? '📍' : '📁'}</span>`
    + `<span class="folder-item__name">${esc(label)}${opts.isSelf ? ` <span class="muted">· ${esc(t('web.folder.this_folder'))}</span>` : ''}</span>`
    + tail;
  name.addEventListener('click', () => { if (opts.isSelf) selectDevDir(path); else loadDevFolder(path); });
  row.appendChild(name);
  return row;
}

/* ---------------- Dev: dictate the goal ----------------
   OpenRouter accepts wav/mp3/ogg/flac/… for `input_audio` but NOT the webm a
   browser's MediaRecorder produces by default. So: record with MediaRecorder
   (whatever container the browser gives), decode it with the Web Audio API,
   and re-encode 16 kHz mono WAV ourselves. No build step, no library, and it
   behaves the same in Chrome and Firefox. */
const TRANSCRIBE_SAMPLE_RATE = 16000;
let micState = { recorder: null, chunks: [], stream: null, busy: false };

export function setMicUi(mode, hint) {
  const btn = /** @type {HTMLButtonElement | null} */ ($('devMic'));
  if (!btn) return;
  btn.classList.toggle('is-recording', mode === 'recording');
  btn.classList.toggle('is-busy', mode === 'busy');
  btn.disabled = mode === 'busy';
  btn.title = mode === 'recording' ? t('web.dev.mic_stop') : t('web.dev.mic_title');
  if (hint !== undefined) $('devMicHint').textContent = hint;
}

/** AudioBuffer → 16-bit PCM WAV bytes (mono). */
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function bytesToBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;                      // avoid blowing the argument limit
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/** Decode any recorded container, downmix to mono and resample to 16 kHz. */
export async function blobToWavBase64(blob) {
  // webkitAudioContext is the legacy Safari alias — absent from the DOM lib types.
  const ctx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * TRANSCRIBE_SAMPLE_RATE));
    const off = new OfflineAudioContext(1, frames, TRANSCRIBE_SAMPLE_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return bytesToBase64(encodeWav(rendered.getChannelData(0), TRANSCRIBE_SAMPLE_RATE));
  } finally {
    ctx.close().catch(() => {});
  }
}

export function stopMicTracks() {
  if (micState.stream) for (const track of micState.stream.getTracks()) track.stop();
  micState.stream = null;
}

export async function toggleDictation() {
  if (micState.busy) return;
  if (micState.recorder && micState.recorder.state === 'recording') {
    micState.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast(t('web.dev.mic_unsupported'), true);
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    // NotAllowedError is the common one — a denied or dismissed permission.
    toast(e && e.name === 'NotAllowedError' ? t('web.dev.mic_denied') : t('web.dev.mic_absent'), true);
    return;
  }
  micState = { recorder: new MediaRecorder(stream), chunks: [], stream, busy: false };
  micState.recorder.addEventListener('dataavailable', (ev) => { if (ev.data.size) micState.chunks.push(ev.data); });
  micState.recorder.addEventListener('stop', () => { void finishDictation(); });
  micState.recorder.start();
  setMicUi('recording', t('web.dev.mic_recording'));
}

export async function finishDictation() {
  stopMicTracks();
  const blob = new Blob(micState.chunks, { type: micState.chunks[0]?.type || 'audio/webm' });
  micState.recorder = null;
  micState.chunks = [];
  if (!blob.size) { setMicUi('idle', t('web.dev.mic_nothing')); return; }

  micState.busy = true;
  setMicUi('busy', t('web.dev.mic_transcribing'));
  try {
    const audio = await blobToWavBase64(blob);
    const specName = backendSpecName('pi');           // transcription is OpenRouter-only
    const res = await api('/api/dev/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audio, format: 'wav', apiKey: sessionKey(specName) || undefined }),
    });
    const text = (res.text || '').trim();
    if (!text) { setMicUi('idle', t('web.dev.mic_no_speech')); return; }
    // APPEND rather than replace: dictating twice should build up the goal, and
    // silently discarding what the user already typed would be hostile.
    const box = /** @type {HTMLTextAreaElement} */ ($('devGoal'));
    box.value = box.value.trim() ? `${box.value.trim()} ${text}` : text;
    renderDevGoalCount();
    box.focus();
    setMicUi('idle', t('web.dev.mic_done', { model: res.modelId }));
  } catch (e) {
    setMicUi('idle', t('web.dev.mic_failed'));
    toast(e.message, true);
  } finally {
    micState.busy = false;
  }
}

export function renderDevGoalCount() {
  const n = /** @type {HTMLTextAreaElement} */ ($('devGoal')).value.trim().length;
  $('devGoalCount').textContent = n ? t('web.dev.chars', { count: n }) : '';
}

/** `role: id` / `epoch·phase: runId` chips — one compact row, never a wall of text. */
export function devChips(pairs) {
  return `<span class="rolechips">${pairs
    .map(([k, v]) => `<span class="rolechip"><b>${esc(k)}</b>${esc(v)}</span>`)
    .join('')}</span>`;
}

export function renderDevSession(session) {
  if (!session) return;
  S.devSession = session;
  $('devStatusPanel').hidden = false;
  const phaseEl = $('devPhase');
  phaseEl.textContent = DEV_PHASE_LABEL[session.phase] || session.phase;
  // Expose the raw phase so a state with its own meaning (knowledge) can also
  // read as its own state, not just as another line of grey text.
  phaseEl.dataset.phase = session.phase || '';

  const k = session.knowledge;
  const rows = [
    `<div class="dev-row"><span class="muted">${esc(t('web.dev.row_goal'))}</span><span>${esc(session.goal)}</span></div>`,
    `<div class="dev-row"><span class="muted">${esc(t('web.dev.row_project'))}</span><span>${esc(session.runDirectory)}</span></div>`,
    `<div class="dev-row"><span class="muted">Época</span><span>${session.currentEpoch}${
      session.maxEpochs ? ` / ${session.maxEpochs}` : ` <span class="muted">(${esc(t('web.dev.no_epoch_cap'))})</span>`
    }</span></div>`,
  ];
  if (session.sessionId) {
    rows.push(
      `<div class="dev-row"><span class="muted">${esc(t('web.dev.row_session'))}</span><span><code>${esc(session.sessionId)}</code>` +
      `${session.resumed ? ` <span class="muted">(${esc(t('web.dev.resumed'))})</span>` : ''}</span></div>`,
    );
  }
  // The models that ACTUALLY ran — the effective ids, after preset expansion
  // and fallback. Worth showing: it is the only place the routing is provable.
  const models = session.models && typeof session.models === 'object' ? session.models : null;
  const modelPairs = models ? Object.keys(models).filter((r) => models[r]).map((r) => [r, models[r]]) : [];
  if (modelPairs.length) {
    rows.push(`<div class="dev-row"><span class="muted">${esc(t('web.dev.row_models'))}</span>${devChips(modelPairs)}</div>`);
  }
  const runIds = Array.isArray(session.runIds) ? session.runIds : [];
  if (runIds.length) {
    rows.push(`<div class="dev-row"><span class="muted">Runs</span>${devChips(runIds.map((r) => [
      `${Number(r.epoch) || 0}${r.phase ? '·' + r.phase : ''}`,
      String(r.runId || '').slice(0, 14),
    ]))}</div>`);
  }
  if (k) {
    rows.push(
      `<div class="dev-row"><span class="muted">${esc(t('web.dev.row_knowledge'))}</span><span>${k.present ? '✓ ' : '✗ '}${esc(k.reason)}</span></div>`,
    );
  }
  if (session.stoppedBecause) {
    rows.push(
      `<div class="dev-row"><span class="muted">${esc(t('web.dev.row_stopped'))}</span><span>${esc(session.stoppedBecause)}${session.detail ? ' — ' + esc(session.detail) : ''}</span></div>`,
    );
  }
  $('devStatus').innerHTML = rows.join('');

  const plan = session.plan;
  $('devPlan').innerHTML = plan
    ? `<div class="dev-plan__head">${esc(plan.epochGoal)}</div>` +
      `<div class="muted dev-plan__done">${esc(t('web.dev.done_when', { text: plan.doneWhen }))}</div>` +
      plan.fronts
        .map(
          (f) =>
            `<div class="dev-front"><div class="dev-front__title">${esc(f.title)} <span class="muted">[${esc(f.id)}]</span></div>` +
            `<div class="muted">${esc(f.rationale)}</div>` +
            `<div class="muted dev-front__meta">${esc(t('web.dev.front_max', { count: f.maxTasks }))}` +
            `${f.dependsOnFronts.length ? ' · ' + esc(t('web.dev.front_after', { list: f.dependsOnFronts.join(', ') })) : ' · ' + esc(t('web.dev.front_parallel'))}</div></div>`,
        )
        .join('') +
      (session.planWarnings || []).map((w) => `<div class="dev-warn">⚠ ${esc(w)}</div>`).join('')
    : '';

  $('devGate').hidden = !session.awaitingApproval;
  renderDevResumeGate(session);
  renderDevOrphanGate(session);

  $('devEpochList').innerHTML = (session.epochs || [])
    .map(
      (e) =>
        `<div class="dev-epoch dev-epoch--${e.landingError ? 'err' : e.status}">` +
        `<span>${esc(t('web.dev.epoch_n', { n: e.epoch }))}</span><span class="muted">${esc(e.epochGoal)}</span>` +
        `<span class="muted">${e.landingError ? '⚠ ' + esc(e.landingError) : '✓ ' + String(e.landedCommit || '').slice(0, 8)}</span></div>`,
    )
    .join('');

  $('devLogs').textContent = (session.logs || []).map((l) => `[${l.level}] ${l.message}`).join('\n');
  $('devLogs').scrollTop = $('devLogs').scrollHeight;

  const running = session.active;
  /** @type {HTMLButtonElement} */ ($('devStartBtn')).disabled = running;
  $('devAbort').hidden = !running;
  // While a session is live the form is noise — and editing it would imply the
  // running session could be reconfigured, which it cannot.
  $('devForm').hidden = running;

  // Mark the mode switch while a session is live, so someone sitting on the
  // Pipelines side can see it — amber when ANY gate is blocking on THEM.
  const opt = $('modeDev');
  if (opt) {
    opt.classList.toggle('is-live', running);
    opt.classList.toggle(
      'is-waiting',
      !!(session.awaitingApproval || session.awaitingResume || session.awaitingOrphans),
    );
  }
}

/* Resume gate: a previous session with THIS goal stopped unfinished. Declining
   is not destructive — it just starts a fresh session (its own blackboard
   namespace), so the old epochs stay on disk. */
export function renderDevResumeGate(session) {
  const gate = $('devResumeGate');
  if (!gate) return;
  gate.hidden = !session.awaitingResume;
  const body = $('devResumeBody');
  if (!body) return;
  const o = session.resumeOffer;
  body.innerHTML = o
    ? `<div class="dev-row"><span class="muted">${esc(t('web.dev.row_session'))}</span><span><code>${esc(o.sessionId || '')}</code></span></div>` +
      `<div class="dev-row"><span class="muted">${esc(t('web.dev.row_goal'))}</span><span>${esc(o.goal || '')}</span></div>` +
      `<div class="dev-row"><span class="muted">${esc(t('web.dev.row_progress'))}</span><span>${esc(t('web.dev.progress', { done: Number(o.epochsDone) || 0, next: Number(o.nextEpoch) || 1 }))}</span></div>`
    : `<div class="muted">${esc(t('web.dev.resume_generic'))}</div>`;
}

/* Orphan gate: huu integration branches that are ahead of HEAD, i.e. work an
   earlier session left unlanded. "Ignorar" is always safe — a forgotten branch
   must never block a new session; the log names the branch and the merge. */
export function renderDevOrphanGate(session) {
  const gate = $('devOrphanGate');
  if (!gate) return;
  gate.hidden = !session.awaitingOrphans;
  const body = $('devOrphanBody');
  if (!body) return;
  const list = Array.isArray(session.orphans) ? session.orphans : [];
  body.innerHTML = list.length
    ? list.map((o) =>
        `<div class="dev-orphan"><code>${esc(o.branch || '')}</code>` +
        `<span class="muted">${esc(t('web.dev.commits_ahead', { count: Number(o.ahead) || 0 }))}` +
        `${o.epoch ? ' · ' + esc(t('web.dev.epoch_n', { n: Number(o.epoch) || 0 })) : ''}</span></div>`).join('')
    : `<div class="muted">${esc(t('web.dev.no_branches'))}</div>`;
}

export function devApprovalMode() {
  const on = /** @type {HTMLButtonElement | null} */ ($('devApprovalSeg').querySelector('button.on'));
  return on ? on.dataset.approval : 'autonomous';
}

/** Auto ⇒ let the planner choose (send nothing); Manual ⇒ pin the ceiling. */
export function devFrontsCap() {
  const on = /** @type {HTMLButtonElement | null} */ ($('devFrontsSeg').querySelector('button.on'));
  if (!on || on.dataset.frontsMode !== 'manual') return undefined;
  return Number(/** @type {HTMLInputElement} */ ($('devFronts')).value);
}

export function wireDev() {
  if (!$('devForm')) return;

  $('devGoal').addEventListener('input', renderDevGoalCount);
  $('devMic').addEventListener('click', () => { void toggleDictation(); });

  $('devFolderUp').addEventListener('click', () => {
    if (devFolderState.parent) loadDevFolder(devFolderState.parent);
  });
  $('devFolderHome').addEventListener('click', () => loadDevFolder(S.boot?.workspace || ''));

  // Both segmented controls follow the design system: `.segmented` + `.on`.
  const wireSeg = (id, attr, after) => {
    $(id).addEventListener('click', (ev) => {
      const btn = /** @type {Element} */ (ev.target).closest(`[data-${attr}]`);
      if (!btn) return;
      // Array.from: NodeListOf has no Symbol.iterator without the DOM.Iterable lib.
      for (const b of Array.from($(id).querySelectorAll(`[data-${attr}]`))) b.classList.toggle('on', b === btn);
      if (after) after(btn);
    });
  };
  wireSeg('devApprovalSeg', 'approval', (btn) => {
    $('devApprovalHint').textContent =
      btn.dataset.approval === 'each-epoch'
        ? t('web.dev.approval_hint_each')
        : t('web.dev.approval_hint_auto');
  });
  wireSeg('devFrontsSeg', 'fronts-mode', (btn) => {
    $('devFrontsRow').hidden = btn.dataset.frontsMode !== 'manual';
  });
  $('devFronts').addEventListener('input', () => { $('devFrontsOut').textContent = /** @type {HTMLInputElement} */ ($('devFronts')).value; });

  // Per-role routing. Both hosts are STABLE containers whose children are
  // rebuilt on every preset switch, so the listeners are delegated and wired
  // once. Null-safe: a stale cached index.html without the panel must degrade
  // to "no routing", never take the whole module down at load.
  const presetSeg = $('devPresetSeg');
  if (presetSeg) presetSeg.addEventListener('click', (ev) => {
    const t = /** @type {Element} */ (ev.target);
    // closest() types as Element; the matches are always our <button>s (dataset).
    const btn = /** @type {HTMLElement | null} */ (t.closest ? t.closest('[data-preset]') : null);
    if (!btn || !devModels.presets) return;
    devModels.preset = btn.dataset.preset;
    devModels.values = presetValues(devModels.roles, devModels.presets, devModels.preset);
    renderDevPresetSeg();
    renderDevRoleFields();
    renderDevModelsSummary();
  });
  const roleFields = $('devRoleFields');
  if (roleFields) roleFields.addEventListener('input', (ev) => {
    const t = /** @type {HTMLInputElement | null} */ (ev.target);
    const role = t && t.dataset ? t.dataset.role : '';
    if (!role) return;
    devModels.values[role] = t.value;
    renderDevModelsSummary();
  });

  // Methodology toggles. The list is a STABLE container whose children are
  // rebuilt on every toggle, so the listener is delegated and wired once —
  // null-safe so a stale cached shell degrades to "no methodology", never a
  // module-load crash. Each toggle persists immediately under
  // huu.settings.v1 (mirrored on S.settings so the ⚙ modal's saves keep it).
  const methodList = $('devMethodList');
  if (methodList) methodList.addEventListener('click', (ev) => {
    // instanceof (not `ev.target.closest ? …`) so the client typecheck sees a
    // real Element instead of adding to its pre-existing TS2339 pile.
    const btn = ev.target instanceof Element ? ev.target.closest('[data-method]') : null;
    if (!btn) return;
    const key = btn.getAttribute('data-method');
    if (!key) return;
    if (devMethods.on.has(key)) devMethods.on.delete(key);
    else devMethods.on.add(key);
    S.settings.devMethodology = [...devMethods.on];
    saveSettings();
    renderDevMethodology();
  });

  $('devForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const goal = /** @type {HTMLTextAreaElement} */ ($('devGoal')).value.trim();
    if (!goal) { toast(t('web.dev.err_no_goal'), true); $('devGoal').focus(); return; }
    const modelId = devFallbackModelId();
    if (!modelId) { toast(t('web.dev.err_no_model'), true); return; }
    if (!S.devDir) { toast(t('web.dev.err_no_dir'), true); return; }

    const specName = backendSpecName(S.backend);
    try {
      const res = await api('/api/dev', {
        method: 'POST',
        body: JSON.stringify({
          goal,
          provider: S.provider,
          modelId,
          apiKey: sessionKey(specName) || undefined,
          runDirectory: S.devDir,
          approval: devApprovalMode(),
          // No maxEpochs on purpose: the session runs until the planner reports
          // the goal complete or the user aborts.
          maxFronts: devFrontsCap(),
          // `models` / `modelsPreset`, or NOTHING when no role is pinned —
          // `modelId` above stays the fallback for every unset role, so an
          // untouched panel POSTs the body this form has always posted.
          ...devModelsPayload(),
          // `methodology`, or NOTHING when every toggle is off — the same
          // byte-identical contract as the routing fields above.
          ...devMethodologyPayload(),
        }),
      });
      toast(t('web.dev.session_started', { id: res.sessionId }));
    } catch (e) {
      toast(e.message, true);
    }
  });

  $('devApprove').addEventListener('click', async () => {
    try { await api('/api/dev/approve', { method: 'POST', body: JSON.stringify({ approved: true }) }); }
    catch (e) { toast(e.message, true); }
  });
  $('devReject').addEventListener('click', async () => {
    try { await api('/api/dev/approve', { method: 'POST', body: JSON.stringify({ approved: false }) }); }
    catch (e) { toast(e.message, true); }
  });
  $('devAbort').addEventListener('click', async () => {
    try { await api('/api/dev/abort', { method: 'POST', body: '{}' }); }
    catch (e) { toast(e.message, true); }
  });

  // Resume + orphan gates: same shape as the approval gate above — one POST,
  // the server answers 409 when nothing is waiting, and the next SSE frame
  // hides the block. Null-safe so an older cached shell degrades quietly.
  const wireGate = (id, path, body) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', async () => {
      try { await api(path, { method: 'POST', body: JSON.stringify(body) }); }
      catch (e) { toast(e.message, true); }
    });
  };
  wireGate('devResumeAccept', '/api/dev/resume', { accept: true });
  wireGate('devResumeReject', '/api/dev/resume', { accept: false });
  wireGate('devOrphanLand', '/api/dev/orphans', { action: 'land' });
  wireGate('devOrphanIgnore', '/api/dev/orphans', { action: 'ignore' });

  $('devViewBoard').addEventListener('click', () => { showView('run'); renderActiveRun(); });
}
wireDev();
wireModeSwitch();

/* Pick the surface SYNCHRONOUSLY, before /api/bootstrap is even requested.
   Deciding it after the fetch resolved made a direct /dev load paint the
   pipeline picker first and swap a beat later — a visible flash. This is a
   pure DOM toggle; `initDevSurface()` still runs later, once boot() has the
   providers and models it needs. */
if (location.pathname.replace(/\/+$/, '') === '/dev') showView('dev');

boot().catch((e) => { document.body.insertAdjacentHTML('afterbegin', `<div class="run-error" style="margin:20px">Failed to load huu: ${esc(e.message)}</div>`); });
