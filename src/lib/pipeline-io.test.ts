import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPipeline, importPipeline, listPipelines, parsePipelineFromJson } from './pipeline-io.js';
import type { Pipeline } from './types.js';

describe('pipeline-io', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pa-test-'));

  it('round-trips a pipeline through export/import', () => {
    const original: Pipeline = {
      name: 'demo',
      steps: [
        {
          name: 'Step 1',
          prompt: 'Refactor $file',
          files: ['src/a.ts', 'src/b.ts'],
        },
        {
          name: 'Step 2',
          prompt: 'Generate CHANGELOG',
          files: [],
        },
      ],
    };

    const file = join(tmp, 'pipeline.json');
    exportPipeline(original, file);
    const restored = importPipeline(file);

    expect(restored).toEqual(original);
  });

  it('round-trips the scope field on each step', () => {
    const original: Pipeline = {
      name: 'with-scopes',
      steps: [
        { name: 'P', prompt: 'project-wide', files: [], scope: 'project' },
        { name: 'F', prompt: 'each $file', files: ['a.ts'], scope: 'per-file' },
        { name: 'X', prompt: 'open', files: [], scope: 'flexible' },
        { name: 'L', prompt: 'legacy', files: [] }, // no scope = back-compat
      ],
    };
    const file = join(tmp, 'scopes.pipeline.json');
    exportPipeline(original, file);
    expect(importPipeline(file)).toEqual(original);
  });

  it('round-trips integrationModelId and portAllocation', () => {
    const original: Pipeline = {
      name: 'with-integration-model',
      steps: [{ name: 'S', prompt: 'p', files: [] }],
      integrationModelId: 'anthropic/claude-sonnet-4.6',
      portAllocation: { basePort: 56000, windowSize: 12, enabled: true },
    };
    const file = join(tmp, 'integration-model.pipeline.json');
    exportPipeline(original, file);
    expect(importPipeline(file)).toEqual(original);
  });

  it('keeps integrationModelId absent when not set', () => {
    const original: Pipeline = {
      name: 'no-integration-model',
      steps: [{ name: 'S', prompt: 'p', files: [] }],
    };
    const file = join(tmp, 'no-integration-model.pipeline.json');
    exportPipeline(original, file);
    const restored = importPipeline(file);
    expect(restored).toEqual(original);
    expect('integrationModelId' in restored).toBe(false);
  });

  it('accepts a raw pipeline JSON without the format wrapper', () => {
    const file = join(tmp, 'raw.json');
    writeFileSync(
      file,
      JSON.stringify({ name: 'raw', steps: [{ name: 's', prompt: 'p', files: [] }] }),
    );
    const loaded = importPipeline(file);
    expect(loaded.name).toBe('raw');
    expect(loaded.steps).toHaveLength(1);
  });

  it('throws on missing file', () => {
    expect(() => importPipeline(join(tmp, 'nope.json'))).toThrow(/not found/);
  });

  it('throws on invalid schema', () => {
    const file = join(tmp, 'bad.json');
    writeFileSync(file, JSON.stringify({ name: 'x' }));
    expect(() => importPipeline(file)).toThrow();
  });

  it('lists pipelines from a directory', () => {
    const subDir = join(tmp, 'pipelines');
    mkdirSync(subDir);
    const p1: Pipeline = { name: 'Pipeline A', steps: [{ name: 's1', prompt: 'p1', files: [] }] };
    const p2: Pipeline = { name: 'Pipeline B', steps: [{ name: 's2', prompt: 'p2', files: [] }] };
    exportPipeline(p1, join(subDir, 'a.pipeline.json'));
    exportPipeline(p2, join(subDir, 'b.pipeline.json'));
    writeFileSync(join(subDir, 'ignore.txt'), 'not a pipeline');

    const entries = listPipelines(subDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].fileName).toBe('a.pipeline.json');
    expect(entries[0].pipeline.name).toBe('Pipeline A');
    expect(entries[1].fileName).toBe('b.pipeline.json');
    expect(entries[1].pipeline.name).toBe('Pipeline B');
  });

  it('returns empty array for non-existent directory', () => {
    expect(listPipelines(join(tmp, 'nonexistent'))).toEqual([]);
  });

  describe('parsePipelineFromJson', () => {
    it('parses a wrapped pipeline JSON string', () => {
      const json = JSON.stringify({
        _format: 'huu-pipeline-v1',
        exportedAt: '2025-01-01T00:00:00.000Z',
        pipeline: { name: 'wrapped', steps: [{ name: 's', prompt: 'do it', files: [] }] },
      });
      const result = parsePipelineFromJson(json);
      expect(result.name).toBe('wrapped');
      expect(result.steps).toHaveLength(1);
    });

    it('parses a bare pipeline JSON string', () => {
      const json = JSON.stringify({
        name: 'bare',
        steps: [{ name: 'step1', prompt: 'hello', files: ['a.ts'] }],
      });
      const result = parsePipelineFromJson(json);
      expect(result.name).toBe('bare');
      const step0 = result.steps[0];
      if (step0.type === 'check') throw new Error('expected work step');
      expect(step0.files).toEqual(['a.ts']);
    });

    it('throws on invalid JSON string', () => {
      expect(() => parsePipelineFromJson('not json {')).toThrow();
    });

    it('throws on valid JSON but invalid pipeline schema', () => {
      const json = JSON.stringify({ name: 'no-steps' });
      expect(() => parsePipelineFromJson(json)).toThrow();
    });
  });

  describe('v2 conditional pipelines', () => {
    it('round-trips a pipeline with check steps', () => {
      const original: Pipeline = {
        name: 'cond',
        steps: [
          { name: 'build', prompt: 'compile', files: [] },
          {
            type: 'check',
            name: 'gate',
            condition: 'coverage > 60% on attempt $runs',
            outcomes: [
              { label: 'ok', nextStepName: 'release', default: true },
              { label: 'low', nextStepName: 'build' },
            ],
            maxRuns: 3,
          },
          { name: 'release', prompt: 'tag', files: [] },
        ],
      };
      const file = join(tmp, 'cond.pipeline.json');
      exportPipeline(original, file);
      expect(importPipeline(file)).toEqual(original);
    });

    it('rejects when next references a missing step', () => {
      const json = JSON.stringify({
        name: 'bad',
        steps: [
          { name: 'a', prompt: 'p', files: [], next: 'missing' },
        ],
      });
      expect(() => parsePipelineFromJson(json)).toThrow(/missing|next|reference/i);
    });

    it('rejects check step with no default outcome', () => {
      const json = JSON.stringify({
        name: 'bad',
        steps: [
          { name: 'a', prompt: 'p', files: [] },
          {
            type: 'check',
            name: 'g',
            condition: 'x',
            outcomes: [
              { label: 'ok', nextStepName: 'a' },
              { label: 'no', nextStepName: 'a' },
            ],
          },
        ],
      });
      expect(() => parsePipelineFromJson(json)).toThrow(/default/i);
    });

    it('rejects duplicate step names', () => {
      const json = JSON.stringify({
        name: 'bad',
        steps: [
          { name: 'a', prompt: 'p', files: [] },
          { name: 'a', prompt: 'q', files: [] },
        ],
      });
      expect(() => parsePipelineFromJson(json)).toThrow(/uniqu|duplicate/i);
    });

    it('rejects check outcome pointing to missing step', () => {
      const json = JSON.stringify({
        name: 'bad',
        steps: [
          { name: 'a', prompt: 'p', files: [] },
          {
            type: 'check',
            name: 'g',
            condition: 'x',
            outcomes: [
              { label: 'ok', nextStepName: 'ghost', default: true },
            ],
          },
        ],
      });
      expect(() => parsePipelineFromJson(json)).toThrow(/ghost|reference|missing/i);
    });
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('substituteRuns', () => {
  it('replaces $runs with the iteration count', async () => {
    const { substituteRuns } = await import('./pipeline-io.js');
    expect(substituteRuns('attempt $runs', 4)).toBe('attempt 4');
    expect(substituteRuns('$runs >= 3', 1)).toBe('1 >= 3');
    expect(substituteRuns('no token here', 99)).toBe('no token here');
  });
});
