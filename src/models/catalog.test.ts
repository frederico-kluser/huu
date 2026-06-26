import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecommendedModels, DEFAULT_MODEL_ID } from './catalog.js';
import { RecommendedModelsFileSchema } from '../contracts/models.js';

describe('loadRecommendedModels (provider filter)', () => {
  // The catalog merges the OpenRouter defaults with the Azure built-ins.
  // With no backend arg, both lists are returned. With a backend arg
  // ('pi'/'azure'), only matching entries; with 'stub', ALL entries because
  // stub doesn't actually call any provider.
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'huu-catalog-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('without backend arg: returns OpenRouter + Azure models', () => {
    const all = loadRecommendedModels(tmpDir);
    const providers = new Set(all.map((m) => m.provider ?? 'openrouter'));
    expect(providers.has('openrouter')).toBe(true);
    expect(providers.has('azure')).toBe(true);
  });

  it('never surfaces a copilot model (removed)', () => {
    const all = loadRecommendedModels(tmpDir);
    expect(all.some((m) => m.provider === ('copilot' as unknown))).toBe(false);
  });

  it('backend=pi: filters to only OpenRouter models', () => {
    const onlyPi = loadRecommendedModels(tmpDir, 'pi');
    expect(onlyPi.length).toBeGreaterThan(0);
    expect(onlyPi.every((m) => (m.provider ?? 'openrouter') === 'openrouter')).toBe(true);
  });

  it('backend=azure: filters to only Azure models', () => {
    const onlyAzure = loadRecommendedModels(tmpDir, 'azure');
    expect(onlyAzure.length).toBeGreaterThan(0);
    expect(onlyAzure.every((m) => m.provider === 'azure')).toBe(true);
  });

  it('backend=stub: returns all models (regression guard)', () => {
    // --stub is for smoke-testing the UI. It MUST NOT filter the catalog so
    // users can still pick any model when running `huu --stub`.
    const all = loadRecommendedModels(tmpDir, 'stub');
    const fullList = loadRecommendedModels(tmpDir);
    expect(all.length).toBe(fullList.length);
    const providers = new Set(all.map((m) => m.provider ?? 'openrouter'));
    expect(providers.has('openrouter')).toBe(true);
    expect(providers.has('azure')).toBe(true);
  });

  it('in-code fallback (no file) leads with the default model', () => {
    // tmpDir has no recommended-models.json, so this exercises
    // DEFAULT_RECOMMENDED_MODELS — the fallback must headline the default.
    const fallback = loadRecommendedModels(tmpDir, 'pi');
    expect(fallback[0]?.id).toBe(DEFAULT_MODEL_ID);
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
    const models = loadRecommendedModels(process.cwd(), 'pi');
    expect(models[0]?.id).toBe(DEFAULT_MODEL_ID);
  });
});
