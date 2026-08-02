/* Browser translation runtime — the web half of src/lib/i18n.

   Contract, mirrored from the Node side:
     • The catalog is the SERVER's (`GET /api/i18n`), so there is exactly one
       source of truth for both front-ends and no duplicated string tables.
     • `t()` NEVER renders a key it cannot translate: an unknown key throws
       `MissingTranslationError`, the same way `t()` does in Node. The server's
       boot-time audit already guarantees every key exists in every locale, so
       a throw here means the CALLER typed a key that exists nowhere.
     • Markup declares its strings with `data-i18n` (textContent),
       `data-i18n-html` (innerHTML), `data-i18n-placeholder`, `data-i18n-title`
       and `data-i18n-aria-label`; `applyI18n(root)` fills them in.

   No DOM access at import time, so this module also imports cleanly in Node
   (see i18n.test.js). */

const STORAGE_KEY = 'huu.lang';

/** @type {{ locale: string, defaultLocale: string, messages: Record<string,string>, locales: Array<{id:string,label:string}> }} */
const state = {
  locale: 'en',
  defaultLocale: 'en',
  messages: {},
  locales: [],
};

export class MissingTranslationError extends Error {
  constructor(key) {
    super(
      `i18n: message key "${key}" is not in the catalog served by /api/i18n. ` +
        `Add it to src/lib/i18n/locales/<locale>/*.ts for EVERY locale.`,
    );
    this.name = 'MissingTranslationError';
    this.key = key;
  }
}

const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/** Fill `{name}` slots. A slot with no matching param is left verbatim so a
 *  formatting slip degrades to a visible marker instead of "undefined". */
export function interpolate(template, params) {
  if (!template.includes('{')) return template;
  return template.replace(PLACEHOLDER_RE, (whole, name) =>
    params && params[name] !== undefined ? String(params[name]) : whole,
  );
}

/** Load a catalog snapshot (used by boot and by the language switcher). */
export function setCatalog(payload) {
  state.locale = payload.locale;
  state.defaultLocale = payload.defaultLocale || 'en';
  state.messages = payload.messages || {};
  state.locales = payload.locales || [];
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = state.locale;
  }
}

export function getLocale() {
  return state.locale;
}

export function availableLocales() {
  return state.locales.slice();
}

/** The user's saved preference, or null to follow the server default. */
export function savedLocale() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLocale(locale) {
  try {
    if (locale) localStorage.setItem(STORAGE_KEY, locale);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode — the language simply does not persist */
  }
}

export function hasMessage(key) {
  return Object.prototype.hasOwnProperty.call(state.messages, key);
}

/** Translate. Throws on an unknown key — see the module contract. */
export function t(key, params) {
  if (!hasMessage(key)) throw new MissingTranslationError(key);
  return interpolate(state.messages[key], params);
}

/**
 * Fetch the catalog and adopt it. Called once, before the first render.
 * @param {(path: string) => Promise<any>} fetchJson  the app's `api()` helper
 */
export async function initI18n(fetchJson, preferred) {
  const locale = preferred || savedLocale();
  const payload = await fetchJson(
    locale ? `/api/i18n?locale=${encodeURIComponent(locale)}` : '/api/i18n',
  );
  setCatalog(payload);
  return state.locale;
}

/** Attribute → how it is applied. Order is irrelevant; each is independent. */
const ATTR_TARGETS = [
  { attr: 'data-i18n', apply: (el, text) => { el.textContent = text; } },
  { attr: 'data-i18n-html', apply: (el, text) => { el.innerHTML = text; } },
  { attr: 'data-i18n-placeholder', apply: (el, text) => { el.setAttribute('placeholder', text); } },
  { attr: 'data-i18n-title', apply: (el, text) => { el.setAttribute('title', text); } },
  { attr: 'data-i18n-aria-label', apply: (el, text) => { el.setAttribute('aria-label', text); } },
];

/**
 * Translate every `data-i18n*` node under `root` (default: the document).
 * Idempotent — re-running it after a language switch repaints the whole page.
 */
export function applyI18n(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope) return 0;
  let n = 0;
  for (const target of ATTR_TARGETS) {
    for (const el of scope.querySelectorAll(`[${target.attr}]`)) {
      const key = el.getAttribute(target.attr);
      if (!key) continue;
      target.apply(el, t(key));
      n++;
    }
  }
  return n;
}

/** Keys referenced by `data-i18n*` attributes in an HTML string (test helper). */
export function keysInMarkup(html) {
  const out = new Set();
  const re = /data-i18n(?:-html|-placeholder|-title|-aria-label)?="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  return [...out].sort();
}
