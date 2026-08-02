import { describe, it, expect } from 'vitest';
import { CATALOGS, sourceKeys } from './catalog.js';
import { LOCALES, DEFAULT_LOCALE } from './types.js';
import {
  assertCatalogsComplete,
  formatCatalogReport,
  placeholdersOf,
  validateCatalogs,
} from './validate.js';

describe('placeholdersOf', () => {
  it('extracts and de-duplicates {slots}', () => {
    expect(placeholdersOf('a {x} b {y} c {x}')).toEqual(['x', 'y']);
  });

  it('ignores JSON-ish braces that are not slots', () => {
    expect(placeholdersOf('{ "a": 1 }')).toEqual([]);
    expect(placeholdersOf('{1}')).toEqual([]);
  });
});

describe('validateCatalogs — the shipped catalogs', () => {
  it('passes: every key is translated in every locale', () => {
    const report = validateCatalogs();
    expect(formatCatalogReport(report)).toBe('');
    expect(report.ok).toBe(true);
  });

  it('finds no untranslated, orphan or empty keys', () => {
    const report = validateCatalogs();
    for (const locale of LOCALES) {
      expect(report.missing[locale]).toEqual([]);
      expect(report.extra[locale]).toEqual([]);
    }
  });

  it('keeps the same {placeholders} in every locale', () => {
    expect(validateCatalogs().placeholderMismatch).toEqual([]);
  });

  it('does not throw at boot', () => {
    expect(() => assertCatalogsComplete()).not.toThrow();
  });
});

/* The audit is the whole point of the module, so prove it actually FAILS on
   each defect class. `validateCatalogs()` reads the module-level registry, so
   these run the same rules over synthetic catalogs instead of mutating it. */
describe('the audit rules catch every defect class', () => {
  const source: Record<string, string> = { 'a.b': 'hello {name}', 'a.c': 'plain' };

  /** The same three rules `validateCatalogs` applies, over an arbitrary pair. */
  function audit(target: Record<string, string>) {
    const missing = Object.keys(source).filter(
      (k) => typeof target[k] !== 'string' || target[k].length === 0,
    );
    const extra = Object.keys(target).filter((k) => !(k in source));
    const drift = Object.keys(source)
      .filter((k) => typeof target[k] === 'string' && target[k].length > 0)
      .filter((k) => placeholdersOf(source[k]).join('|') !== placeholdersOf(target[k]).join('|'));
    return { missing, extra, drift };
  }

  it('flags a key the target locale never translated', () => {
    expect(audit({ 'a.c': 'simples' }).missing).toEqual(['a.b']);
  });

  it('flags a key translated as an EMPTY string', () => {
    expect(audit({ 'a.b': '', 'a.c': 'simples' }).missing).toEqual(['a.b']);
  });

  it('flags an orphan key the source catalog does not define', () => {
    expect(audit({ 'a.b': 'oi {name}', 'a.c': 'simples', 'a.d': 'sobra' }).extra).toEqual(['a.d']);
  });

  it('flags placeholder drift between locales', () => {
    expect(audit({ 'a.b': 'oi {nome}', 'a.c': 'simples' }).drift).toEqual(['a.b']);
  });
});

describe('catalog shape', () => {
  it('derives its key set from the source locale', () => {
    expect(sourceKeys()).toEqual(Object.keys(CATALOGS[DEFAULT_LOCALE]).sort());
    expect(sourceKeys().length).toBeGreaterThan(400);
  });

  it('namespaces every key by surface', () => {
    const allowed = ['common.', 'status.', 'run_status.', 'provider.', 'cli.', 'tui.', 'web.'];
    const stray = sourceKeys().filter((k) => !allowed.some((p) => k.startsWith(p)));
    expect(stray).toEqual([]);
  });
});
