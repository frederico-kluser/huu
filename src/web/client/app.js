/* huu web UI — vanilla ES module entry point.
   Real-time over one SSE stream, actions over fetch POSTs.
   App state and infrastructure → modules/state.js
   Utilities → modules/utils.js
   Screens → modules/launch.js, queue.js, settings.js, board.js, dev.js */

import { esc, toast } from './modules/utils.js';
import { $, S, api, applyTheme, withTok, TOKEN, pipeIcon, sessionKey, setSessionKey, backendSpecName, providerInfoById, providerReady, providerBackend, parseRamPercent, syncTimeoutField, DEFAULT_MODEL_ID } from './modules/state.js';

import { goStep, renderGallery, selectPipelineByName, showView, switchMode } from './modules/launch.js';

import { renderQueue, restoreQueue, refreshHistoryBadge } from './modules/queue.js';

import { loadSettings, saveSettings } from './modules/settings.js';

import { bootSimulation, connectSse, ingestRun, renderActiveRun, renderBudget } from './modules/board.js';

import { initDevSurface } from './modules/dev.js';
import { applyI18n, initI18n, t } from './i18n.js';

/* ── Cross-surface links ── */
function tokenizeNavLinks() {
  if (!TOKEN) return;
  // tsconfig.client.json omits the DOM.Iterable lib; the cast supplies the
  // Symbol.iterator a real NodeList already has at runtime — no config change.
  for (const a of /** @type {NodeListOf<Element> & Iterable<Element>} */ (document.querySelectorAll('a.mode-switch__opt, a.sim-back'))) {
    const href = a.getAttribute('href');
    if (href && href.startsWith('/')) a.setAttribute('href', withTok(href));
  }
}

function pickDefaultProvider(providers) {
  const ready = (providers || []).find((x) => providerReady(S, x));
  if (ready) return ready.id;
  return (providers && providers[0] && providers[0].id) || 'openrouter';
}

/* ── Bootstrap ── */
export async function boot() {
  // The catalog comes from the server, so both front-ends share one source of
  // truth. Fetched BEFORE the first render — every later `t()` is synchronous.
  await initI18n(api);
  applyI18n();
  tokenizeNavLinks();
  applyTheme(localStorage.getItem('huu.theme') || 'auto');
  $('themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || 'auto';
    const THEMES = ['auto', 'light', 'dark'];
    applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
  });

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

  // /dev does NOT short-circuit: development mode is one half of the mode
  // SWITCH, so both surfaces boot together and switching between them is a
  // view swap, not a page load (which would drop the SSE stream and the board).
  if (b.defaults && typeof b.defaults.concurrency === 'number') { S.manualN = b.defaults.concurrency; }
  if (b.defaults && b.defaults.autoScale === false) { S.mode = 'manual'; }
  S.provider = b.lockedProvider || pickDefaultProvider(b.providers);
  S.backend = providerBackend(S, S.provider);
  renderGallery();
  goStep(1);                       // start the guided launch at step 1
  if (b.initialPipeline) selectPipelineByName(b.initialPipeline);
  for (const r of b.runs || []) ingestRun(r);
  connectSse();
  // Restore a half-built queue (config only — keys are never persisted) and
  // reflect the saved-history count on the topbar.
  restoreQueue();
  loadSettings();
  // The SERVER is the source of truth for the machine-global RAM dial (it
  // persists + applies it); localStorage is only a display cache. Sync it so
  // the ⚙ modal always shows the value actually in force.
  if (b.settings && typeof b.settings.ramPercent === 'number') {
    S.settings.ramPercent = parseRamPercent(b.settings.ramPercent);
    saveSettings();
  }
  if (b.budget) renderBudget(b.budget);
  renderQueue();
  syncTimeoutField();
  refreshHistoryBadge();
  // Now that providers/models are loaded, finish wiring the dev surface. The
  // VIEW was already chosen synchronously at parse time (see below) so there
  // is no flash; this only fills it in.
  if (location.pathname.replace(/\/+$/, '') === '/dev') switchMode('dev', { push: false });
  // Same deal for the method canvas: the VIEW was already picked synchronously
  // below, and this is what actually mounts it — the palette needs the sample
  // list `/api/bootstrap` carries, so the mount waits for boot to have it.
  if (location.pathname.replace(/\/+$/, '') === '/graph') switchMode('graph', { push: false });
}

/* Pick the surface SYNCHRONOUSLY, before /api/bootstrap is even requested.
   Deciding it after the fetch resolved made a direct /dev load paint the
   pipeline picker first and swap a beat later — a visible flash. This is a
   pure DOM toggle; `initDevSurface()` still runs later, once boot() has the
   providers and models it needs. */
if (location.pathname.replace(/\/+$/, '') === '/dev') showView('dev');
if (location.pathname.replace(/\/+$/, '') === '/graph') showView('graph');

boot().catch((e) => {
  // The catalog may not have loaded — fall back to the English literal so the
  // failure is still readable instead of turning into a second exception.
  let msg;
  try { msg = t('web.boot.failed', { message: e.message }); }
  catch { msg = `Failed to load huu: ${e.message}`; }
  document.body.insertAdjacentHTML('afterbegin', `<div class="run-error" style="margin:20px">${esc(msg)}</div>`);
});
