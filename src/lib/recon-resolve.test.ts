import { describe, it, expect } from 'vitest';
import {
  MAX_SELECTIONS,
  fallbackCoreItems,
  resolveCatalogId,
  resolveSelections,
} from './recon-resolve.js';

describe('resolveCatalogId — exact match', () => {
  it('finds an entry by its exact id', () => {
    expect(resolveCatalogId('stack')?.id).toBe('stack');
    expect(resolveCatalogId('build-deploy')?.id).toBe('build-deploy');
  });

  it('returns null for the empty string', () => {
    expect(resolveCatalogId('')).toBeNull();
  });
});

describe('resolveCatalogId — fuzzy match', () => {
  it('matches case-insensitively (model used wrong case)', () => {
    expect(resolveCatalogId('Stack')?.id).toBe('stack');
    expect(resolveCatalogId('BUILD-DEPLOY')?.id).toBe('build-deploy');
  });

  it('strips punctuation differences', () => {
    expect(resolveCatalogId('build_deploy')?.id).toBe('build-deploy');
    expect(resolveCatalogId('build deploy')?.id).toBe('build-deploy');
    expect(resolveCatalogId('builddeploy')?.id).toBe('build-deploy');
  });

  it('tolerates small typos via Levenshtein ≤ 2', () => {
    expect(resolveCatalogId('structre')?.id).toBe('structure');
    expect(resolveCatalogId('libaries')?.id).toBe('libraries');
  });

  it('falls back to substring containment for verbose ids', () => {
    expect(resolveCatalogId('module-structure')?.id).toBe('structure');
    expect(resolveCatalogId('quality')?.id).toBe('quality-tooling');
  });

  it('returns null when nothing reasonable matches', () => {
    expect(resolveCatalogId('totally-unrelated-thing-xyz')).toBeNull();
  });
});

describe('resolveSelections — happy path', () => {
  it('keeps order, preserves catalog labels', () => {
    const r = resolveSelections(['stack', 'libraries']);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!.tag).toBe('stack');
    expect(r.items[0]!.source).toBe('catalog');
    expect(r.items[1]!.tag).toBe('libraries');
    expect(r.dropped).toHaveLength(0);
  });

  it('accepts custom items verbatim', () => {
    const r = resolveSelections([
      { title: 'Custom mission', prompt: 'do something specific with X and Y.' },
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.label).toBe('Custom mission');
    expect(r.items[0]!.source).toBe('custom');
    expect(r.items[0]!.tag).toMatch(/^custom:\d+$/);
  });

  it('mixes catalog refs and custom items in order', () => {
    const r = resolveSelections([
      'stack',
      { title: 'Routing analysis', prompt: 'look at src/router/* and list routes' },
      'structure',
    ]);
    expect(r.items.map((i) => i.source)).toEqual(['catalog', 'custom', 'catalog']);
    expect(r.items[0]!.tag).toBe('stack');
    expect(r.items[1]!.label).toBe('Routing analysis');
    expect(r.items[2]!.tag).toBe('structure');
  });
});

describe('resolveSelections — dedupe & cap', () => {
  it('dedupes by catalog id', () => {
    const r = resolveSelections(['stack', 'stack', 'STACK', 'structure']);
    expect(r.items.map((i) => i.tag)).toEqual(['stack', 'structure']);
  });

  it('dedupes custom items with identical prompts', () => {
    const r = resolveSelections([
      { title: 'A', prompt: 'identical prompt body here for dedupe test' },
      { title: 'B', prompt: 'identical prompt body here for dedupe test' },
    ]);
    expect(r.items).toHaveLength(1);
  });

  it(`caps at ${MAX_SELECTIONS} items`, () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      title: `T${i}`,
      prompt: `unique prompt body number ${i} for cap testing`,
    }));
    const r = resolveSelections(raw);
    expect(r.items).toHaveLength(MAX_SELECTIONS);
  });
});

describe('resolveSelections — drops invalid input', () => {
  it('drops strings that match nothing in the catalog', () => {
    const r = resolveSelections(['stack', 'totally-unknown-id']);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.tag).toBe('stack');
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]!.raw).toBe('totally-unknown-id');
  });

  it('drops custom items with empty title or too-short prompt', () => {
    const r = resolveSelections([
      { title: '', prompt: 'long enough prompt body here' },
      { title: 'OK', prompt: 'short' },
    ] as Array<{ title: string; prompt: string }>);
    expect(r.items).toHaveLength(0);
    expect(r.dropped).toHaveLength(2);
  });
});

describe('fallbackCoreItems', () => {
  it('returns the 4 foundational catalog items', () => {
    const items = fallbackCoreItems();
    const tags = items.map((i) => i.tag).sort();
    expect(tags).toEqual(['conventions', 'libraries', 'stack', 'structure']);
    for (const item of items) {
      expect(item.source).toBe('catalog');
      expect(item.mission.length).toBeGreaterThan(20);
    }
  });
});
