import { describe, expect, it } from 'vitest';
import { RunConfigSchema, applyRunConfig } from './run-config.js';
import type { Pipeline } from './types.js';

const fakePipeline: Pipeline = {
  name: 'p',
  steps: [
    { type: 'work', name: 'one', prompt: 'do A', files: [] },
    { type: 'work', name: 'two', prompt: 'do B', files: ['existing.ts'], scope: 'per-file' },
  ],
};

describe('RunConfigSchema', () => {
  it('accepts a minimal config (only modelId)', () => {
    const r = RunConfigSchema.safeParse({ modelId: 'x/y' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.backend).toBe('pi');
  });

  it('rejects an empty modelId', () => {
    const r = RunConfigSchema.safeParse({ modelId: '' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown backend', () => {
    const r = RunConfigSchema.safeParse({ modelId: 'x/y', backend: 'gpt5' });
    expect(r.success).toBe(false);
  });

  it('accepts files map', () => {
    const r = RunConfigSchema.safeParse({
      modelId: 'x/y',
      files: { one: ['a.ts'], two: ['b.ts', 'c.ts'] },
    });
    expect(r.success).toBe(true);
  });
});

describe('applyRunConfig', () => {
  it('injects files into the step matching by name', () => {
    const { pipeline, warnings } = applyRunConfig(fakePipeline, {
      modelId: 'x',
      backend: 'pi',
      files: { one: ['inject1.ts', 'inject2.ts'] },
    });
    expect(warnings).toEqual([]);
    expect((pipeline.steps[0] as { files: string[] }).files).toEqual(['inject1.ts', 'inject2.ts']);
    // unmodified step keeps its original files
    expect((pipeline.steps[1] as { files: string[] }).files).toEqual(['existing.ts']);
  });

  it('warns when config mentions a step name not in the pipeline', () => {
    const { warnings } = applyRunConfig(fakePipeline, {
      modelId: 'x',
      backend: 'pi',
      files: { 'no-such-step': ['x.ts'] },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no-such-step');
  });

  it('does not mutate the source pipeline', () => {
    const before = JSON.stringify(fakePipeline);
    applyRunConfig(fakePipeline, {
      modelId: 'x',
      backend: 'pi',
      files: { one: ['z.ts'] },
    });
    expect(JSON.stringify(fakePipeline)).toBe(before);
  });

  it('propagates timeouts/retries from config when pipeline omits them', () => {
    const { pipeline } = applyRunConfig(fakePipeline, {
      modelId: 'x',
      backend: 'pi',
      cardTimeoutMs: 999,
      singleFileCardTimeoutMs: 444,
      maxRetries: 3,
    });
    expect(pipeline.cardTimeoutMs).toBe(999);
    expect(pipeline.singleFileCardTimeoutMs).toBe(444);
    expect(pipeline.maxRetries).toBe(3);
  });

  it('preserves pipeline timeouts when config does not set them', () => {
    const withTimeouts: Pipeline = { ...fakePipeline, cardTimeoutMs: 11111 };
    const { pipeline } = applyRunConfig(withTimeouts, { modelId: 'x', backend: 'pi' });
    expect(pipeline.cardTimeoutMs).toBe(11111);
  });
});
