import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPipeline, importPipeline, listPipelines } from './pipeline-io.js';
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
    expect(() => importPipeline(join(tmp, 'nope.json'))).toThrow(/nao encontrado/);
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

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
});
