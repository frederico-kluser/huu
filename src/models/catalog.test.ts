import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecommendedModels, modelAcceptsImage, resolveSuggestedModel, DEFAULT_MODEL_ID } from './catalog.js';
import { RecommendedModelsFileSchema } from '../contracts/models.js';
import { modelIdForProvider } from '../lib/providers.js';

describe('loadRecommendedModels (provider filter)', () => {
  // TWO providers again (`deepseek`, `openrouter`) — both served by the SAME
  // `jcode` backend. That is why the sharp filter is keyed on the PROVIDER:
  // the backend cannot tell a Claude entry from a DeepSeek one. These tests
  // regained their teeth with the second `ModelProvider` member.
  let tmpDir: string;

  /** Write a recommended-models.json into the temp project root. */
  const writeCatalog = (models: unknown[]): void => {
    writeFileSync(
      join(tmpDir, 'recommended-models.json'),
      JSON.stringify({ models }),
      'utf-8',
    );
  };

  // One entry states its provider explicitly, the other omits it — the
  // back-compat shape written before the field existed.
  const TWO_ENTRIES = [
    { id: 'deepseek/explicit', label: 'Explicit', provider: 'deepseek' },
    { id: 'deepseek/implicit', label: 'Implicit' },
  ];

  // One entry per provider — the fixture that lets the filter DISCARD, which
  // a single-provider catalog could never prove.
  const MIXED_ENTRIES = [
    { id: 'deepseek/v4-pro', label: 'DS', provider: 'deepseek' },
    { id: 'anthropic/claude-opus-5', label: 'Opus', provider: 'openrouter' },
    { id: 'deepseek/legacy-shape', label: 'No provider field' },
  ];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'huu-catalog-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('without backend arg: returns the whole catalog unfiltered', () => {
    writeCatalog(TWO_ENTRIES);
    const all = loadRecommendedModels(tmpDir);
    expect(all.map((m) => m.id)).toEqual(['deepseek/explicit', 'deepseek/implicit']);
  });

  it('parses an openrouter-provider entry instead of silently dropping the file', () => {
    // `loadRecommendedModels` SWALLOWS zod parse errors and falls back to the
    // in-code catalog, so a provider missing from `ModelProviderSchema` would
    // discard the WHOLE user file in silence. This proves the enum admits
    // 'openrouter' — the fallback would not contain this id.
    writeCatalog(MIXED_ENTRIES);
    expect(loadRecommendedModels(tmpDir).map((m) => m.id)).toContain(
      'anthropic/claude-opus-5',
    );
  });

  it('never surfaces a copilot model (removed)', () => {
    const all = loadRecommendedModels(tmpDir);
    expect(all.some((m) => m.provider === ('copilot' as unknown))).toBe(false);
  });

  it('backend=jcode: keeps every deepseek model, provider-less entries included', () => {
    // The `provider ?? 'deepseek'` default is what keeps a file written before
    // the field existed from being filtered out of the picker entirely.
    writeCatalog(TWO_ENTRIES);
    const onlyJcode = loadRecommendedModels(tmpDir, 'jcode');
    expect(onlyJcode.map((m) => m.id)).toEqual(['deepseek/explicit', 'deepseek/implicit']);
    // Isolate the default: a catalog holding ONLY the provider-less entry must
    // still come back NON-empty. Dropping `?? 'deepseek'` in `providerFor`
    // makes this one fail empty even if the assertion above is ever relaxed
    // into a subset check. (Asserting `(m.provider ?? 'deepseek') === 'deepseek'`
    // on the results would NOT: it re-implements the very default under test
    // and is true for any input.)
    writeCatalog([TWO_ENTRIES[1]]);
    expect(loadRecommendedModels(tmpDir, 'jcode').map((m) => m.id)).toEqual([
      'deepseek/implicit',
    ]);
  });

  it('provider=openrouter: DISCARDS the deepseek entries', () => {
    // The condition the previous era could not test: with a second provider
    // the filter can finally REMOVE something.
    // MUTATION KILLED: `providerFor(m) === provider` → `true` (or restoring
    // the old `backendToModelProvider()` that ignored its argument and always
    // answered 'deepseek') — both make this return all three entries.
    writeCatalog(MIXED_ENTRIES);
    expect(loadRecommendedModels(tmpDir, 'jcode', 'openrouter').map((m) => m.id)).toEqual([
      'anthropic/claude-opus-5',
    ]);
  });

  it('provider=deepseek: DISCARDS the openrouter entry, keeps the provider-less one', () => {
    // Symmetric direction, and it re-pins the `?? 'deepseek'` default: the
    // entry with no `provider` field must land on the deepseek side.
    writeCatalog(MIXED_ENTRIES);
    expect(loadRecommendedModels(tmpDir, 'jcode', 'deepseek').map((m) => m.id)).toEqual([
      'deepseek/v4-pro',
      'deepseek/legacy-shape',
    ]);
  });

  it('backend=stub: returns BOTH providers (the bypass, now provable)', () => {
    // --stub is for smoke-testing the UI. It MUST NOT filter the catalog so
    // users can still pick any model when running `huu --stub`.
    // MUTATION KILLED (finally): deleting the stub bypass
    // (`if (!backend || backend === 'stub')` → `if (!backend)`) drops through
    // to the backend branch, where `providersForBackend('stub')` is EMPTY —
    // so the mutant returns [] instead of the full catalog.
    writeCatalog(MIXED_ENTRIES);
    const all = loadRecommendedModels(tmpDir, 'stub');
    expect(all.map((m) => m.id)).toEqual(MIXED_ENTRIES.map((m) => m.id));
    expect(all.map((m) => m.id)).toEqual(loadRecommendedModels(tmpDir).map((m) => m.id));
  });

  it('backend=jcode with NO provider: keeps both, because jcode serves both', () => {
    // Honest non-answer: `jcode` really does serve deepseek AND openrouter, so
    // a backend-only filter cannot discriminate. This pins that the widening
    // is DERIVED from the provider table (`providersForBackend`) and not a
    // filter that silently does nothing.
    writeCatalog(MIXED_ENTRIES);
    expect(loadRecommendedModels(tmpDir, 'jcode').map((m) => m.id)).toEqual(
      MIXED_ENTRIES.map((m) => m.id),
    );
  });

  it('an explicit provider outranks the backend argument', () => {
    // Precedence pin: provider wins even when the backend says "no filter".
    writeCatalog(MIXED_ENTRIES);
    expect(loadRecommendedModels(tmpDir, 'stub', 'openrouter').map((m) => m.id)).toEqual([
      'anthropic/claude-opus-5',
    ]);
  });

  it('in-code fallback (no file) leads with the default model', () => {
    // tmpDir has no recommended-models.json, so this exercises
    // DEFAULT_RECOMMENDED_MODELS — the fallback must headline the default.
    const fallback = loadRecommendedModels(tmpDir, 'jcode');
    expect(fallback[0]?.id).toBe(DEFAULT_MODEL_ID);
  });
});

describe('modelAcceptsImage — the vision gate predicate', () => {
  // Some surfaces REQUIRE vision; this predicate is the whole gate. Its
  // contract is fail-safe: an entry without `inputModalities` is UNKNOWN and
  // answers false — gating a capable model out is a visible complaint, an
  // image that dies (or is silently dropped) mid-run is neither. Never from
  // the model NAME: the MiMo family mixes omni and text-only members.
  it('answers true only when `image` is an explicit input modality', () => {
    expect(modelAcceptsImage({ id: 'x/y', label: 'Y', inputModalities: ['text', 'image'] })).toBe(true);
    expect(modelAcceptsImage({ id: 'x/y', label: 'Y', inputModalities: ['text', 'video'] })).toBe(false);
  });

  it('treats an ABSENT field as unknown → false (fail-safe text-only)', () => {
    expect(modelAcceptsImage({ id: 'x/y', label: 'Y' })).toBe(false);
  });
});

describe('recommended-models.json (shipped catalog)', () => {
  // Regression: the shipped file once carried tier/bestFor values that were
  // NOT in the schema enums, so it failed zod validation and the catalog
  // silently fell back to the 2-entry in-code list — the documented default
  // never loaded. These guards keep the file authoritative.
  const repoFile = join(process.cwd(), 'recommended-models.json');

  it('parses against the schema (no silent fallback)', () => {
    const raw = JSON.parse(readFileSync(repoFile, 'utf-8'));
    const parsed = RecommendedModelsFileSchema.safeParse(raw);
    expect(
      parsed.success ? '' : JSON.stringify(parsed.error.issues[0]),
    ).toBe('');
  });

  it('leads with the default model', () => {
    const models = loadRecommendedModels(process.cwd(), 'jcode');
    expect(models[0]?.id).toBe(DEFAULT_MODEL_ID);
  });
});

describe('recommended-models.json — every entry is reachable on its provider', () => {
  // The catalog is what the model picker offers. An entry whose id is written
  // in a namespace its provider's endpoint does not serve is an offer that
  // cannot be honored — the user picks it, the run starts, and the vendor
  // answers "model not found" several seconds and one spawn later.
  //
  // MUTATION KILLED: dropping the `provider` field from an entry (it then
  // defaults to `deepseek`) — which is exactly how `anthropic/claude-opus-4.6`
  // and friends came to be offered to DeepSeek users, and how the OpenRouter
  // picker came to be EMPTY.
  const repoRoot = process.cwd();

  it('offers only DeepSeek-namespaced ids on the DeepSeek endpoint', () => {
    const deepseek = loadRecommendedModels(repoRoot, 'jcode', 'deepseek');
    expect(deepseek.length).toBeGreaterThan(0);
    for (const m of deepseek) {
      // api.deepseek.com is single-vendor: after `modelIdForProvider` strips
      // the `deepseek/` prefix, a bare id is left. Anything else would go out
      // verbatim carrying someone else's vendor segment.
      expect(modelIdForProvider('deepseek', m.id)).not.toContain('/');
    }
  });

  it('offers a NON-EMPTY, prefix-shaped roster on OpenRouter', () => {
    const openrouter = loadRecommendedModels(repoRoot, 'jcode', 'openrouter');
    expect(openrouter.length).toBeGreaterThan(0);
    for (const m of openrouter) {
      // openrouter.ai addresses `vendor/model`; the id travels verbatim.
      expect(modelIdForProvider('openrouter', m.id)).toBe(m.id);
      expect(m.id).toMatch(/^[^/]+\/[^/]+$/);
    }
  });

  it('keeps the DEFAULT model selectable on the provider that serves it', () => {
    // The default is a SUGGESTION, not a summons: `xiaomi/…` is
    // OpenRouter-namespaced and api.deepseek.com cannot serve it, so listing
    // it under BOTH providers would be a guaranteed "model not found" — the
    // exact offer this suite exists to forbid. The contract is therefore:
    // the default lives on a roster that can honor it.
    const openrouter = loadRecommendedModels(repoRoot, 'jcode', 'openrouter').map((m) => m.id);
    expect(openrouter).toContain(DEFAULT_MODEL_ID);
  });

  it('resolves a suggestion INSIDE every provider roster (never a phantom)', () => {
    // The two front-ends seed their pick from the roster; when the canonical
    // default is absent (another provider), they must open on a real option —
    // `resolveSuggestedModel` is that rule, and this pins it per provider.
    for (const provider of ['deepseek', 'openrouter'] as const) {
      const roster = loadRecommendedModels(repoRoot, 'jcode', provider);
      const suggested = resolveSuggestedModel(roster, DEFAULT_MODEL_ID);
      expect(roster.map((m) => m.id)).toContain(suggested);
    }
  });
});
