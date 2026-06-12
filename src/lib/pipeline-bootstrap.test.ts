import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureDefaultPipeline,
  ensureAllDefaultPipelines,
} from './pipeline-bootstrap.js';
import { DEFAULT_PIPELINE_FILENAME } from './default-pipelines/huu-test-suite.js';
import { DEFAULT_PIPELINES } from './default-pipelines/registry.js';
import { importPipeline } from './pipeline-io.js';
import { isWorkStep } from './types.js';

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

    // Per-file is the user-selected step at index 2.
    const perFile = pipeline.steps[2];
    expect(isWorkStep(perFile)).toBe(true);
    if (isWorkStep(perFile)) {
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

describe('ensureAllDefaultPipelines', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'huu-bootstrap-all-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('materializes every registered default in the catalog', () => {
    const res = ensureAllDefaultPipelines(tmp);
    expect(res.results).toHaveLength(DEFAULT_PIPELINES.length);
    for (const entry of res.results) {
      expect(entry.created).toBe(true);
      expect(existsSync(entry.filePath)).toBe(true);
    }
  });

  it('every materialized pipeline parses as a valid topology', () => {
    const res = ensureAllDefaultPipelines(tmp);
    for (const entry of res.results) {
      const pipeline = importPipeline(entry.filePath);
      expect(pipeline.name).toBe(entry.name);
      expect(pipeline.steps.length).toBeGreaterThan(0);
      // Topology integrity: every check step has exactly one default outcome,
      // every named reference resolves. (importPipeline runs validateTopology
      // via the Zod schema; if any of those fail, importPipeline throws.)
    }
  });

  it('only huu-test-suite carries the _default flag', () => {
    const res = ensureAllDefaultPipelines(tmp);
    let defaultCount = 0;
    for (const entry of res.results) {
      const pipeline = importPipeline(entry.filePath);
      if (pipeline._default) {
        defaultCount += 1;
        expect(pipeline.name).toBe('huu Test Suite');
      }
    }
    expect(defaultCount).toBe(1);
  });

  it('is idempotent across the whole catalog', () => {
    ensureAllDefaultPipelines(tmp);
    const second = ensureAllDefaultPipelines(tmp);
    for (const entry of second.results) {
      expect(entry.created).toBe(false);
    }
  });

  it('a single file write failure does not stop the others', () => {
    // Pre-create one default's file with bogus content; the bootstrap should
    // skip it (idempotent) and write the other 5 normally.
    const dir = join(tmp, 'pipelines');
    mkdirSync(dir);
    const blocked = DEFAULT_PIPELINES[0]!;
    writeFileSync(join(dir, blocked.DEFAULT_PIPELINE_FILENAME), '{}', 'utf8');

    const res = ensureAllDefaultPipelines(tmp);
    const createdNames = res.results.filter((r) => r.created).map((r) => r.name);
    expect(createdNames).not.toContain(blocked.DEFAULT_PIPELINE_NAME);
    expect(createdNames.length).toBe(DEFAULT_PIPELINES.length - 1);
  });

  it('every bundled JSON re-parses to the same pipeline shape as its TS generator', () => {
    const res = ensureAllDefaultPipelines(tmp);
    for (const entry of res.results) {
      const onDisk = JSON.parse(readFileSync(entry.filePath, 'utf8'));
      const fromTS = JSON.parse(
        DEFAULT_PIPELINES.find((m) => m.DEFAULT_PIPELINE_NAME === entry.name)!
          .getDefaultPipelineFileContent(),
      );
      // exportedAt drifts each invocation; compare everything else byte-for-byte.
      delete onDisk.exportedAt;
      delete fromTS.exportedAt;
      expect(onDisk, entry.name).toEqual(fromTS);
    }
  });

  it('every CheckStep in the bundled catalog has exactly one default outcome', () => {
    for (const mod of DEFAULT_PIPELINES) {
      const p = mod.getDefaultPipeline();
      for (const step of p.steps) {
        if (step.type === 'check') {
          const defaults = step.outcomes.filter((o) => o.default === true);
          expect(
            defaults,
            `${mod.DEFAULT_PIPELINE_NAME} / ${step.name}: each CheckStep must have exactly one default outcome`,
          ).toHaveLength(1);
        }
      }
    }
  });

  it('no single-task step references the $file token', () => {
    for (const mod of DEFAULT_PIPELINES) {
      const p = mod.getDefaultPipeline();
      for (const step of p.steps) {
        if (step.type === 'check') continue;
        // per-file and memory steps fan out one agent per file — $file (and
        // $hint, for memory) are exactly how those prompts are parameterized.
        if (step.scope === 'per-file' || step.scope === 'memory') continue;
        expect(
          step.prompt.includes('$file'),
          `${mod.DEFAULT_PIPELINE_NAME} / ${step.name}: single-task step must not contain $file`,
        ).toBe(false);
      }
    }
  });

  it('huu Knowledge System: both check loops terminate on their forward default', () => {
    const mod = DEFAULT_PIPELINES.find(
      (m) => m.DEFAULT_PIPELINE_NAME === 'huu Knowledge System',
    )!;
    const p = mod.getDefaultPipeline();
    const checks = p.steps.filter((s) => s.type === 'check');
    expect(checks).toHaveLength(2);
    const [materialized, gate] = checks;
    if (materialized?.type !== 'check' || gate?.type !== 'check') throw new Error('unreachable');

    // Skill-materialization loop: `done` must be the default so judge
    // failures / --stub move FORWARD instead of bouncing back to the
    // dossier fan-out until maxRuns.
    expect(materialized.maxRuns).toBe(4);
    const done = materialized.outcomes.find((o) => o.label === 'done')!;
    expect(done.default).toBe(true);
    expect(done.nextStepName).toBe('7. Wire the routing surface');
    expect(materialized.outcomes.find((o) => o.label === 'continue')!.nextStepName).toBe(
      '5. Materialize skill from dossier',
    );

    // Routing-quality gate: `approved` default → seal; `rework` → sharpen.
    expect(gate.maxRuns).toBe(3);
    const approved = gate.outcomes.find((o) => o.label === 'approved')!;
    expect(approved.default).toBe(true);
    expect(approved.nextStepName).toBe('11. Finalize: seal + curation handoff');
    expect(gate.outcomes.find((o) => o.label === 'rework')!.nextStepName).toBe(
      '10. Sharpen failing descriptions',
    );

    const names = p.steps.map((s) => s.name);
    for (const check of checks) {
      if (check.type !== 'check') continue;
      for (const o of check.outcomes) expect(names).toContain(o.nextStepName);
    }
  });
});
