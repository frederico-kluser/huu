import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecommendedModels } from './catalog.js';

describe('loadRecommendedModels (backend filter)', () => {
  // The catalog merges the OpenRouter defaults with the Copilot
  // built-ins. With no backend arg, both lists are returned. With a
  // backend arg ('pi'/'copilot'), only matching entries; with 'stub',
  // ALL entries because stub doesn't actually call any provider.
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'huu-catalog-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('without backend arg: returns OpenRouter + Copilot models', () => {
    const all = loadRecommendedModels(tmpDir);
    const providers = new Set(all.map((m) => m.provider ?? 'openrouter'));
    expect(providers.has('openrouter')).toBe(true);
    expect(providers.has('copilot')).toBe(true);
  });

  it('backend=pi: filters out Copilot models', () => {
    const onlyPi = loadRecommendedModels(tmpDir, 'pi');
    expect(onlyPi.length).toBeGreaterThan(0);
    expect(onlyPi.every((m) => (m.provider ?? 'openrouter') === 'openrouter')).toBe(true);
  });

  it('backend=copilot: filters to only Copilot models', () => {
    const onlyCopilot = loadRecommendedModels(tmpDir, 'copilot');
    expect(onlyCopilot.length).toBeGreaterThan(0);
    expect(onlyCopilot.every((m) => m.provider === 'copilot')).toBe(true);
  });

  it('backend=stub: returns all models (regression guard)', () => {
    // --stub is for smoke-testing the UI. It MUST NOT filter the
    // catalog so users can pick e.g. a Copilot model when running
    // `huu --copilot --stub` to validate the Copilot screens
    // without burning quota.
    const all = loadRecommendedModels(tmpDir, 'stub');
    const fullList = loadRecommendedModels(tmpDir);
    expect(all.length).toBe(fullList.length);
    const providers = new Set(all.map((m) => m.provider ?? 'openrouter'));
    expect(providers.has('openrouter')).toBe(true);
    expect(providers.has('copilot')).toBe(true);
  });
});

