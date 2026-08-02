/**
 * The build-time half of huu's "no half-translated key" rule.
 *
 * `t()` throws when a key is missing at RUN time, and `assertCatalogsComplete()`
 * throws at boot when the catalogs disagree — but neither notices a key a
 * developer typed into a component and forgot to add anywhere. This test walks
 * the SOURCE, collects every catalog key the app references (typed `t()` calls,
 * runtime `translate()` calls, `data-i18n*` markup, and bare key literals in the
 * lookup tables), and fails when one of them is not fully translated.
 *
 * It also fails on catalog keys nothing references, so the files cannot silently
 * grow dead weight; families built at run time are listed in DYNAMIC_PREFIXES.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOGS, sourceKeys } from './catalog.js';
import { LOCALES } from './types.js';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/** Every namespace the catalogs define. A literal outside these is not a key. */
const NAMESPACES = ['common.', 'status.', 'run_status.', 'provider.', 'cli.', 'tui.', 'web.'];

/**
 * Key families assembled at run time, so no literal exists for the scanner to
 * find. Each entry names WHO builds it — an unreferenced prefix here is dead
 * weight the same as an unused key, so keep the list honest.
 */
const DYNAMIC_PREFIXES = [
  'status.', //            tStatus() over card-state.ts codes
  'run_status.', //        RunDashboard / MultiRunDashboard over OrchestratorState.status
  'provider.', //          BackendSelector over PROVIDERS
  'web.phase.', //         board.js phaseLabel() over card-state.js plabels
  'tui.faq.', //           app.tsx FAQ_KEYS
  'tui.step.scope_', //    StepEditor over StepScope
  'tui.editor.pattern_', // PipelineEditor over Pattern
  'web.dev.method.', //    dev.js over the DevMethodology keys /api/bootstrap serves
];

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.html'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The catalogs themselves are the definition, not a usage; vendored
      // third-party code is not ours to translate.
      if (entry === 'locales' || entry === 'vendor' || entry === '__fixtures__') continue;
      walk(full, out);
      continue;
    }
    // Tests deliberately reference keys that do not exist (that IS the
    // assertion), so they can never be a usage source.
    if (/\.test\.(ts|tsx|js)$/.test(entry)) continue;
    if (SCANNED_EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const KEY_SHAPE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
/**
 * A quoted, key-SHAPED literal. Anchoring on the shape (rather than pairing
 * quotes across a whole file) is what makes the scan robust: an apostrophe in
 * prose — `the worker's own model` — cannot swallow the real keys that follow,
 * because the body between the quotes would itself have to look like a key.
 */
const QUOTED = /(['"])([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)\1/g;
const I18N_ATTR = /data-i18n(?:-html|-placeholder|-title|-aria-label)?="([^"]+)"/g;

interface Usage {
  key: string;
  file: string;
}

function collectUsages(): Usage[] {
  const out: Usage[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    const short = relative(SRC, file);
    for (const m of text.matchAll(QUOTED)) {
      const value = m[2];
      if (!value || !KEY_SHAPE.test(value)) continue;
      if (!NAMESPACES.some((ns) => value.startsWith(ns))) continue;
      out.push({ key: value, file: short });
    }
    if (file.endsWith('.html')) {
      for (const m of text.matchAll(I18N_ATTR)) out.push({ key: m[1], file: short });
    }
  }
  return out;
}

const usages = collectUsages();
const referenced = new Set(usages.map((u) => u.key));
const defined = new Set(sourceKeys());

describe('i18n coverage — source references vs catalogs', () => {
  it('finds the app actually using the catalogs', () => {
    // A scanner that silently matched nothing would make every other assertion
    // in this file vacuously true.
    expect(referenced.size).toBeGreaterThan(300);
  });

  it('every key the source references exists in the source catalog', () => {
    const unknown = usages
      .filter((u) => !defined.has(u.key))
      .map((u) => `${u.key}  (${u.file})`)
      .sort();
    expect(unknown).toEqual([]);
  });

  it('every referenced key is translated in EVERY shipped locale', () => {
    const holes: string[] = [];
    for (const key of [...referenced].sort()) {
      for (const locale of LOCALES) {
        const value = CATALOGS[locale][key];
        if (typeof value !== 'string' || value.length === 0) holes.push(`${key} → ${locale}`);
      }
    }
    expect(holes).toEqual([]);
  });

  it('has no orphan catalog keys', () => {
    const orphans = [...defined]
      .filter((k) => !referenced.has(k))
      .filter((k) => !DYNAMIC_PREFIXES.some((p) => k.startsWith(p)))
      .sort();
    expect(orphans).toEqual([]);
  });

  it('every dynamic family it exempts is actually populated', () => {
    for (const prefix of DYNAMIC_PREFIXES) {
      const members = [...defined].filter((k) => k.startsWith(prefix));
      expect(members.length, `no catalog keys under "${prefix}"`).toBeGreaterThan(0);
    }
  });
});

describe('i18n coverage — no stray English left in the shells', () => {
  /** Surfaces whose user-visible text must come from the catalog. */
  const UI_FILES = [
    'ui/components',
    'web/client/index.html',
    'web/client/modules',
  ];

  it('routes the Ink components through t()', () => {
    const components = walk(join(SRC, 'ui', 'components'));
    const withoutT = components
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => !readFileSync(f, 'utf8').includes("from '../../lib/i18n/index.js'"))
      .map((f) => relative(SRC, f));
    // ActionBar/Spinner render only what their callers pass in.
    expect(withoutT.sort()).toEqual(['ui/components/ActionBar.tsx', 'ui/components/Spinner.tsx']);
  });

  it('declares its markup strings with data-i18n', () => {
    const html = readFileSync(join(SRC, 'web', 'client', 'index.html'), 'utf8');
    const keys = [...html.matchAll(I18N_ATTR)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.every((k) => defined.has(k))).toBe(true);
  });

  it('keeps the scanned surface list in sync with the tree', () => {
    for (const rel of UI_FILES) {
      expect(() => statSync(join(SRC, rel))).not.toThrow();
    }
  });
});
