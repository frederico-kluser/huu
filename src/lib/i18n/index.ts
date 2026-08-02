/**
 * huu's translation runtime.
 *
 * Contract (the reason this module exists):
 *   1. `t()` NEVER renders a key it cannot fully translate. If the key is
 *      missing from the active locale — or from ANY other shipped locale — it
 *      throws `MissingTranslationError` on the spot.
 *   2. `assertCatalogsComplete()` runs at every entrypoint, so a half-translated
 *      catalog fails the process at boot instead of at the unlucky frame that
 *      happens to need the key.
 *   3. `HUU_I18N_STRICT=0` degrades (1) to a stderr warning + English fallback
 *      for operators who would rather ship a rough string than stop — the
 *      default is strict.
 *
 * Layer: `src/lib/` (lowest). Imports nothing above it.
 */

import type { Locale, MessageParams } from './types.js';
import { DEFAULT_LOCALE, LOCALES, isLocale, normalizeLocale } from './types.js';
import type { MessageKey } from './catalog.js';
import { CATALOGS, localesMissing } from './catalog.js';
import { MissingParamError, MissingTranslationError } from './errors.js';
import { assertCatalogsComplete } from './validate.js';

export type { Locale, MessageParams } from './types.js';
export type { MessageKey } from './catalog.js';
export { LOCALES, DEFAULT_LOCALE, isLocale, normalizeLocale } from './types.js';
export { CATALOGS, localesMissing, localesWith, sourceKeys } from './catalog.js';
export {
  I18nError,
  MissingTranslationError,
  MissingParamError,
  CatalogIntegrityError,
} from './errors.js';
export {
  assertCatalogsComplete,
  validateCatalogs,
  formatCatalogReport,
  placeholdersOf,
  type CatalogReport,
} from './validate.js';

const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

let activeLocale: Locale = DEFAULT_LOCALE;
let strict = true;

/** Human-readable names, shown by the language pickers. Kept out of the
 *  catalogs on purpose: a language is always written in its OWN language. */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

export function getLocale(): Locale {
  return activeLocale;
}

export function setLocale(locale: Locale): void {
  if (!isLocale(locale)) throw new TypeError(`i18n: unsupported locale "${String(locale)}"`);
  activeLocale = locale;
}

export function isStrict(): boolean {
  return strict;
}

/** Escape hatch for operators — see the module contract. */
export function setStrict(value: boolean): void {
  strict = value;
}

/**
 * Pick a locale from the environment: `HUU_LANG` / `HUU_LOCALE` win, then the
 * usual POSIX chain. Anything unrecognised falls back to `en`.
 */
export function resolveLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  for (const name of ['HUU_LANG', 'HUU_LOCALE', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const hit = normalizeLocale(env[name]);
    if (hit) return hit;
  }
  return DEFAULT_LOCALE;
}

/**
 * Entrypoint bootstrap: audit the catalogs, then adopt the environment locale.
 * Throws `CatalogIntegrityError` when any key lacks a translation.
 */
export function initI18n(env: NodeJS.ProcessEnv = process.env): Locale {
  strict = env.HUU_I18N_STRICT !== '0' && env.HUU_I18N_STRICT !== 'false';
  if (strict) assertCatalogsComplete();
  const locale = resolveLocale(env);
  setLocale(locale);
  return locale;
}

function interpolate(
  key: string,
  template: string,
  params: MessageParams | undefined,
  locale: Locale,
): string {
  if (!template.includes('{')) return template;
  return template.replace(PLACEHOLDER_RE, (whole, name: string) => {
    if (!params || params[name] === undefined) {
      if (strict) throw new MissingParamError(key, name, locale);
      return whole;
    }
    return String(params[name]);
  });
}

/**
 * Translate `key` into the active locale.
 *
 * Throws `MissingTranslationError` when the key is untranslated in ANY shipped
 * locale — including locales the user is not currently running. That is the
 * point: an English-only key must not survive to production just because the
 * developer never switched to `pt-BR`.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(key as string, params);
}

/**
 * Same guarantees as `t()` for keys assembled at run time (e.g. `status.${x}`),
 * where the compiler cannot check the key literal.
 */
export function translate(key: string, params?: MessageParams): string {
  const missing = localesMissing(key);
  if (missing.length > 0) {
    if (strict) throw new MissingTranslationError(key, missing);
    process.stderr.write(
      `huu[i18n]: key "${key}" is missing in ${missing.join(', ')} — rendering the raw key.\n`,
    );
    const fallback = CATALOGS[DEFAULT_LOCALE][key];
    return fallback ? interpolate(key, fallback, params, DEFAULT_LOCALE) : key;
  }
  return interpolate(key, CATALOGS[activeLocale][key], params, activeLocale);
}

/**
 * Translate a kanban/status CODE (`'NO CHANGES'`, `'RUNNING'`, …) into the
 * catalog's `status.*` family. The codes themselves stay English and stable —
 * `src/lib/card-state.ts` is a pure classifier pinned by tests and mirrored in
 * the browser, so it must NOT know about locales. The translation happens here,
 * at the render boundary.
 */
export function tStatus(code: string): string {
  return translate(`status.${code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`);
}

/** True when `key` is fully translated in every shipped locale. */
export function hasMessage(key: string): boolean {
  return localesMissing(key).length === 0;
}

/** Whole catalog for one locale — used by `GET /api/i18n` to feed the browser. */
export function messagesFor(locale: Locale): Record<string, string> {
  return { ...CATALOGS[locale] };
}

/** Every locale huu can serve, with its self-named label. */
export function availableLocales(): Array<{ id: Locale; label: string }> {
  return LOCALES.map((id) => ({ id, label: LOCALE_LABELS[id] }));
}
