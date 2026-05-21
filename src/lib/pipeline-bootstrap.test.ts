import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDefaultPipeline } from './pipeline-bootstrap.js';
import { DEFAULT_PIPELINE_FILENAME } from './default-pipelines/huu-test-suite.js';
import { importPipeline } from './pipeline-io.js';

describe('pipeline-bootstrap', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'huu-bootstrap-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates pipelines/huu-test-suite.pipeline.json when missing', () => {
    const res = ensureDefaultPipeline(tmp);
    expect(res.created).toBe(true);
    expect(existsSync(res.filePath)).toBe(true);
    expect(res.filePath.endsWith(DEFAULT_PIPELINE_FILENAME)).toBe(true);
  });

  it('creates the pipelines/ dir if it does not exist', () => {
    const res = ensureDefaultPipeline(tmp);
    expect(existsSync(join(tmp, 'pipelines'))).toBe(true);
    expect(res.created).toBe(true);
  });

  it('is idempotent: does not overwrite an existing file', () => {
    const dir = join(tmp, 'pipelines');
    mkdirSync(dir);
    const target = join(dir, DEFAULT_PIPELINE_FILENAME);
    const userContent = '{"_format":"huu-pipeline-v2","pipeline":{"name":"edited","steps":[{"name":"x","prompt":"y","files":[]}]}}';
    writeFileSync(target, userContent, 'utf8');

    const res = ensureDefaultPipeline(tmp);
    expect(res.created).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe(userContent);
  });

  it('produces a file that re-imports as a valid pipeline with 4 steps', () => {
    const res = ensureDefaultPipeline(tmp);
    const pipeline = importPipeline(res.filePath);
    expect(pipeline.name).toBe('huu Test Suite');
    expect(pipeline._default).toBe(true);
    expect(pipeline.steps).toHaveLength(4);
    // Per-file is the user-selected step (step 3, 0-indexed: 2).
    const perFile = pipeline.steps[2];
    expect(perFile.type === undefined || perFile.type === 'work').toBe(true);
    if (perFile.type !== 'check') {
      expect(perFile.scope).toBe('per-file');
    }
  });

  it('calls onError when writing fails (read-only parent)', () => {
    // Simulate failure by passing a path that is a file, not a directory.
    const fakeRoot = join(tmp, 'a-file');
    writeFileSync(fakeRoot, 'not a dir');
    let captured: Error | null = null;
    const res = ensureDefaultPipeline(fakeRoot, (e) => {
      captured = e;
    });
    expect(res.created).toBe(false);
    expect(captured).not.toBeNull();
  });
});
