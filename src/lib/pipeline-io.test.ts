import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPipeline, importPipeline } from './pipeline-io.js';
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

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
});
