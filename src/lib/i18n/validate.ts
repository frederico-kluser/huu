/**
 * Catalog audit — the boot-time half of huu's "no half-translated key" rule.
 *
 * The type system already blocks a `pt-BR` catalog that omits an `en` key, but
 * types vanish at run time and say nothing about EMPTY strings, EXTRA keys, or
 * placeholder drift between locales. `assertCatalogsComplete()` closes that gap
 * and is called from every entrypoint (CLI, web server, TUI) before the first
 * frame is drawn.
 */

import type { Locale } from './types.js';
import { LOCALES, DEFAULT_LOCALE } from './types.js';
import { CATALOGS, sourceKeys } from './catalog.js';
import { CatalogIntegrityError } from './errors.js';

export interface CatalogReport {
  /** Keys present in the source catalog but absent/empty in this locale. */
  missing: Record<Locale, string[]>;
  /** Keys present in this locale but absent from the source catalog. */
  extra: Record<Locale, string[]>;
  /** Keys whose `{placeholder}` set differs from the source catalog's. */
  placeholderMismatch: Array<{ key: string; locale: Locale; expected: string[]; actual: string[] }>;
  ok: boolean;
}

const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/** Placeholder names used by a message, sorted and de-duplicated. */
export function placeholdersOf(message: string): string[] {
  const out = new Set<string>();
  for (const m of message.matchAll(PLACEHOLDER_RE)) out.add(m[1]);
  return [...out].sort();
}

function emptyPerLocale(): Record<Locale, string[]> {
  return Object.fromEntries(LOCALES.map((l) => [l, [] as string[]])) as Record<Locale, string[]>;
}

/** Full audit of every shipped catalog against the source catalog. */
export function validateCatalogs(): CatalogReport {
  const keys = sourceKeys();
  const source = CATALOGS[DEFAULT_LOCALE];
  const missing = emptyPerLocale();
  const extra = emptyPerLocale();
  const placeholderMismatch: CatalogReport['placeholderMismatch'] = [];

  for (const locale of LOCALES) {
    const cat = CATALOGS[locale];
    for (const key of keys) {
      const value = cat[key];
      if (typeof value !== 'string' || value.length === 0) {
        missing[locale].push(key);
        continue;
      }
      const expected = placeholdersOf(source[key] ?? '');
      const actual = placeholdersOf(value);
      if (expected.join('|') !== actual.join('|')) {
        placeholderMismatch.push({ key, locale, expected, actual });
      }
    }
    for (const key of Object.keys(cat).sort()) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) extra[locale].push(key);
    }
  }

  const ok =
    LOCALES.every((l) => missing[l].length === 0 && extra[l].length === 0) &&
    placeholderMismatch.length === 0;

  return { missing, extra, placeholderMismatch, ok };
}

/** Human-readable rendering of a failing report — used in the thrown message. */
export function formatCatalogReport(report: CatalogReport): string {
  const lines: string[] = [];
  for (const locale of LOCALES) {
    if (report.missing[locale].length > 0) {
      lines.push(
        `  ${locale}: ${report.missing[locale].length} untranslated key(s) → ` +
          report.missing[locale].slice(0, 10).join(', ') +
          (report.missing[locale].length > 10 ? ', …' : ''),
      );
    }
    if (report.extra[locale].length > 0) {
      lines.push(
        `  ${locale}: ${report.extra[locale].length} orphan key(s) not in ${DEFAULT_LOCALE} → ` +
          report.extra[locale].slice(0, 10).join(', ') +
          (report.extra[locale].length > 10 ? ', …' : ''),
      );
    }
  }
  for (const m of report.placeholderMismatch.slice(0, 10)) {
    lines.push(
      `  ${m.locale}: "${m.key}" expects {${m.expected.join('}, {')}} but declares {${m.actual.join('}, {')}}`,
    );
  }
  return lines.join('\n');
}

/**
 * Throw unless every locale translates every key with matching placeholders.
 * Call this ONCE per process, at startup, before any UI renders.
 */
export function assertCatalogsComplete(): void {
  const report = validateCatalogs();
  if (report.ok) return;
  throw new CatalogIntegrityError(
    `i18n: translation catalogs are incomplete — huu refuses to start with ` +
      `half-translated messages.\n${formatCatalogReport(report)}`,
    report.missing,
    report.extra,
  );
}
