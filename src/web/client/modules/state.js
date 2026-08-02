/* huu web UI — application state and infrastructure. */

export const $ = (id) => document.getElementById(id);

// Canonical default model
export const DEFAULT_MODEL_ID = 'deepseek/deepseek-v4-flash';

const _TOKEN = new URLSearchParams(location.search).get('token') || '';
export const TOKEN = _TOKEN;
export const withTok = (url) => (_TOKEN ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(_TOKEN) : url);

export async function api(path, opts = {}) {
  const { headers: extra, ...rest } = opts;
  const res = await fetch(withTok(path), {
    headers: {
      'Content-Type': 'application/json',
      ...(_TOKEN ? { 'x-huu-token': _TOKEN } : {}),
      ...extra,
    },
    ...rest,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------------- Theme ---------------- */
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const btn = $('themeBtn'); if (btn) btn.querySelector('use').setAttribute('href', t === 'light' ? '#ic-sun' : t === 'dark' ? '#ic-moon' : '#ic-auto');
  try { localStorage.setItem('huu.theme', t); } catch {}
}

/* ---------------- Browser-only API keys ---------------- */
export const keyStoreName = (name) => 'huu.key.' + name;
export function sessionKey(name) {
  if (!name) return '';
  try { return sessionStorage.getItem(keyStoreName(name)) || ''; } catch { return ''; }
}
export function setSessionKey(name, value) {
  if (!name) return;
  try { sessionStorage.setItem(keyStoreName(name), value); } catch {}
}
export function backendSpecName(id, boot) {
  const b = ((boot && boot.backends) || []).find((x) => x.id === id);
  return b ? b.apiKeySpecName : undefined;
}

/* ---------------- Provider helpers ---------------- */
export const PIPE_ICONS = { test: '✓', audit: '◎', security: '🛡', performance: '⚡', docs: '✦', quality: '◆', refactor: '↻', knowledge: '✸' };
export function pipeIcon(name) {
  const n = name.toLowerCase();
  for (const k in PIPE_ICONS) if (n.includes(k)) return PIPE_ICONS[k];
  return '◇';
}
export function providerInfoById(S, id) {
  return (S.providers || []).find((p) => p.id === id) || null;
}
export function providerBackend(S, id) {
  const p = providerInfoById(S, id);
  return p ? p.backend : id === 'azure' ? 'azure' : 'pi';
}
export function providerReady(S, p) {
  if (!p) return false;
  if (p.hasKey) return true;
  const specs = p.keySpecs || [];
  return specs.length > 0 && specs.every((s) => sessionKey(s.name));
}

export function globalTimeoutMinutes(S) { return S.settings.maxAgentMinutes; }
export function parseRamPercent(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(10, Math.min(95, n));
}
export function syncTimeoutField() {
  const g = S.settings.maxAgentMinutes;
  // index.html:220 — <input type="number" id="timeoutInput">, so the input-only
  // .placeholder is safe; getElementById just can't see that statically.
  const el = /** @type {HTMLInputElement | null} */ ($('timeoutInput'));
  if (el) el.placeholder = g ? g + ' (global)' : 'default';
}

/* ---------------- App state ---------------- */
export const S = {
  boot: null,
  pipelines: [],
  selectedPipe: null,
  provider: 'openrouter',
  providers: [],
  backend: 'pi',
  runDir: '',
  cwd: '',
  models: [],
  modelId: '',
  conflictResolverModelId: '',
  modelSource: 'recommended',
  mode: 'auto',
  manualN: 10,
  timeoutMin: '',
  settings: { maxAgentMinutes: undefined, ramPercent: undefined },
  keyStatus: { ok: true, missing: [] },
  run: { phase: 'idle' },
  runs: new Map(),
  activeRunId: null,
  runPinnedId: null,
  openCardKey: null,
  homePinned: false,
  wizard: { step: 1 },
  markedDirs: new Set(),
  sim: false,
  simModels: [],
  simSuggest: [],
  simFiles: 12,
  simAgents: 6,
  simPaused: false,
  lastSim: null,
  logOpen: false,
  logFilter: 'all',
  logAutoExpanded: false,
  logUserToggled: false,
  queue: {
    items: [],
    running: false,
    live: null,
    settled: 0,
    processed: null,
    stopping: false,
    id: '',
  },
  // Dev surface
  devBooted: false,
  devDir: '',
  devSession: null,
  lastBudget: null,
};
