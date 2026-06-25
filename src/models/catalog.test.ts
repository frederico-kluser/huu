import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecommendedModels } from './catalog.js';

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
});
