import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PipelineSchema, exportPipeline, importPipeline, parsePipelineFromJson } from './pipeline-io.js';
import type { CheckStep, Pipeline, ReviewSpec, WorkStep } from './types.js';
import {
  DEFAULT_REVIEW_BLOCK_ON,
  DEFAULT_REVIEW_MAX_FINDINGS,
  DEFAULT_REVIEW_MAX_ROUNDS,
  DEFAULT_REVIEW_TIMEOUT_MS,
} from './types.js';

// The schema half of the per-task generator → critic loop (`WorkStep.review`).
// Two things are pinned here, and the second matters more than the first:
//   1. the bounds — a review spec that could never converge, or that asks a
//      critic for more findings than it can emit, must not parse;
//   2. COMPATIBILITY — `review` is an additive field on a schema every existing
//      pipeline file already validates against, so a v2 pipeline that doesn't
//      use it has to round-trip byte-for-byte unchanged.

const tmp = mkdtempSync(join(tmpdir(), 'huu-review-schema-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const FULL_SPEC: ReviewSpec = {
  prompt: 'Audit the diff against the code style, the design patterns and correctness.',
  maxRounds: 2,
  blockOn: ['blocker', 'major'],
  modelId: 'moonshotai/kimi-k2.6',
  timeoutMs: 600_000,
  maxFindings: 10,
  verifyCommands: ['npm run typecheck', 'npm test'],
  findingsDir: '.huu/dev/s1/epoch-1/review',
  onBlocked: 'hold',
};

/** A one-work-step pipeline carrying `review` — the smallest valid host. */
function withReview(review: unknown): unknown {
  return {
    name: 'reviewed',
    steps: [{ type: 'work', name: 'Implement', prompt: 'do $file', files: [], review }],
  };
}

describe('ReviewSpec schema', () => {
  it('accepts a fully populated spec and keeps every field', () => {
    const parsed = PipelineSchema.parse(withReview(FULL_SPEC)) as Pipeline;
    expect((parsed.steps[0] as WorkStep).review).toEqual(FULL_SPEC);
  });

  it('accepts a spec that only sets `prompt` — every other field has a default', () => {
    const parsed = PipelineSchema.parse(withReview({ prompt: 'audit it' })) as Pipeline;
    const review = (parsed.steps[0] as WorkStep).review!;
    expect(review).toEqual({ prompt: 'audit it' });
    // The schema deliberately does NOT inject defaults: the DEFAULT_REVIEW_*
    // constants stay the single source, so an absent field means "policy" and
    // not "someone's stale copy of the policy baked into a pipeline file".
    expect(review.maxRounds).toBeUndefined();
    expect(review.blockOn).toBeUndefined();
    expect(review.maxFindings).toBeUndefined();
    expect(review.timeoutMs).toBeUndefined();
    expect([
      DEFAULT_REVIEW_MAX_ROUNDS,
      DEFAULT_REVIEW_MAX_FINDINGS,
      DEFAULT_REVIEW_TIMEOUT_MS,
      DEFAULT_REVIEW_BLOCK_ON,
    ]).toEqual([2, 10, 600_000, ['blocker', 'major']]);
  });

  it('rejects an empty prompt — a critic with no briefing has no criterion', () => {
    expect(() => PipelineSchema.parse(withReview({ prompt: '' }))).toThrow();
  });

  it('rejects maxRounds 0 (round 1 always runs) and 5 (past the cap)', () => {
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, maxRounds: 0 }))).toThrow();
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, maxRounds: 5 }))).toThrow();
    for (const maxRounds of [1, 2, 3, 4]) {
      expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, maxRounds }))).not.toThrow();
    }
  });

  it('rejects a non-integer maxRounds', () => {
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, maxRounds: 1.5 }))).toThrow();
  });

  it('rejects an empty blockOn — nothing would ever hold the merge', () => {
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, blockOn: [] }))).toThrow();
  });

  it('rejects a severity outside the fixed enum', () => {
    expect(() =>
      PipelineSchema.parse(withReview({ ...FULL_SPEC, blockOn: ['blocker', 'critical'] })),
    ).toThrow();
  });

  it('accepts each declared severity on its own', () => {
    for (const severity of ['blocker', 'major', 'minor', 'nit']) {
      expect(() =>
        PipelineSchema.parse(withReview({ ...FULL_SPEC, blockOn: [severity] })),
      ).not.toThrow();
    }
  });

  it('rejects maxFindings 0 and 51, accepts the 1..50 bounds', () => {
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, maxFindings: 0 }))).toThrow();
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, maxFindings: 51 }))).toThrow();
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, maxFindings: 1 }))).not.toThrow();
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, maxFindings: 50 }))).not.toThrow();
  });

  it('rejects a non-positive timeout', () => {
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, timeoutMs: 0 }))).toThrow();
  });

  it('accepts both declared onBlocked values and rejects an unknown one', () => {
    for (const onBlocked of ['waive', 'hold']) {
      expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, onBlocked }))).not.toThrow();
    }
    expect(() => PipelineSchema.parse(withReview({ ...FULL_SPEC, onBlocked: 'block' }))).toThrow();
  });

  it('keeps onBlocked absent when unset — waive stays the default behavior', () => {
    const parsed = PipelineSchema.parse(withReview({ prompt: 'audit it' })) as Pipeline;
    expect((parsed.steps[0] as WorkStep).review!.onBlocked).toBeUndefined();
  });

  it('round-trips a reviewed step through export/import unchanged', () => {
    const original: Pipeline = {
      name: 'reviewed-roundtrip',
      steps: [
        { type: 'work', name: 'Recon', prompt: 'list targets', files: [], scope: 'project' },
        {
          type: 'work',
          name: 'Implement',
          prompt: 'implement $file — $hint',
          files: [],
          scope: 'memory',
          filesFrom: '.huu/dev/tasks.json',
          maxFiles: 8,
          modelId: 'deepseek/deepseek-v4-pro',
          review: FULL_SPEC,
        },
      ],
    };
    const file = join(tmp, 'reviewed.pipeline.json');
    exportPipeline(original, file);
    expect(importPipeline(file)).toEqual(original);
  });
});

describe('review is structurally a WORK-step field', () => {
  const CHECK_WITH_REVIEW = {
    name: 'gated',
    steps: [
      { type: 'work', name: 'Implement', prompt: 'do it', files: [] },
      {
        type: 'check',
        name: 'Gate',
        condition: 'is it green?',
        maxRuns: 2,
        outcomes: [{ label: 'approved', nextStepName: 'Seal', default: true }],
        review: { prompt: 'audit the diff' },
      },
      { type: 'work', name: 'Seal', prompt: 'stamp it', files: [] },
    ],
  };

  it('a `review` on a CheckStep never survives the parse', () => {
    // CheckStepSchema deliberately gained nothing, so the key is dropped
    // rather than carried: a check step already IS a judge, runs AFTER the
    // merge in the integration worktree, and has neither a worker worktree to
    // audit nor an agent to send findings back to. The field can therefore
    // never reach the orchestrator through a check step.
    const parsed = PipelineSchema.parse(CHECK_WITH_REVIEW) as Pipeline;
    const gate = parsed.steps[1] as CheckStep;
    expect(gate.type).toBe('check');
    expect('review' in gate).toBe(false);
  });

  it('is dropped on the file round-trip too, not just on the in-memory parse', () => {
    const file = join(tmp, 'gated.pipeline.json');
    exportPipeline(PipelineSchema.parse(CHECK_WITH_REVIEW) as Pipeline, file);
    const restored = importPipeline(file);
    expect(restored.steps.some((s) => 'review' in s)).toBe(false);
  });

  it('is a compile error to declare on a CheckStep', () => {
    const gate: CheckStep = {
      type: 'check',
      name: 'Gate',
      condition: 'is it green?',
      outcomes: [{ label: 'approved', nextStepName: 'Gate', default: true }],
      // @ts-expect-error `review` belongs to WorkStep — CheckStep has no such field.
      review: { prompt: 'audit the diff' },
    };
    expect(gate.name).toBe('Gate');
  });
});

describe('compatibility — a v2 pipeline without review is untouched', () => {
  // The proof that `review` is additive. This fixture exercises every v2
  // feature a real pipeline uses (scopes, memory fan-out, produces, dependsOn
  // waves, per-step models, a judge with a forward default, the safety caps)
  // and must come back byte-identical after a full export → import cycle.
  const V2: Pipeline = {
    name: 'huu Compat Audit',
    description: 'A v2 pipeline that predates the review field.',
    cardTimeoutMs: 600_000,
    singleFileCardTimeoutMs: 300_000,
    maxRetries: 1,
    maxNodeExecutions: 50,
    integrationModelId: 'deepseek/deepseek-v4-pro',
    portAllocation: { basePort: 55100, windowSize: 10, enabled: true },
    steps: [
      {
        type: 'work',
        name: 'Recon',
        prompt: 'write the target list',
        files: [],
        scope: 'project',
        produces: '.huu/audits/targets.json',
      },
      {
        type: 'work',
        name: 'Scan',
        prompt: 'scan $file — $hint',
        files: [],
        scope: 'memory',
        filesFrom: '.huu/audits/targets.json',
        maxFiles: 20,
        dependsOn: ['Recon'],
        modelId: 'deepseek/deepseek-v4-pro',
      },
      {
        type: 'work',
        name: 'Consolidate',
        prompt: 'merge the shards',
        files: [],
        scope: 'project',
        dependsOn: ['Scan'],
      },
      {
        type: 'check',
        name: 'Validate report',
        condition: 'are all sections present? ($runs)',
        maxRuns: 2,
        modelId: 'deepseek/deepseek-v4-pro',
        outcomes: [
          { label: 'approved', nextStepName: 'Finalize report', default: true },
          { label: 'rework', nextStepName: 'Consolidate' },
        ],
      },
      { type: 'work', name: 'Finalize report', prompt: 'stamp it', files: [] },
    ],
  };

  it('round-trips through export/import with nothing added or dropped', () => {
    const file = join(tmp, 'v2-no-review.pipeline.json');
    exportPipeline(V2, file);
    const restored = importPipeline(file);
    expect(restored).toEqual(V2);
    expect(restored.steps.some((s) => 'review' in s)).toBe(false);
  });

  it('round-trips through the pasted-JSON path identically', () => {
    const restored = parsePipelineFromJson(JSON.stringify({ _format: 'huu-pipeline-v2', pipeline: V2 }));
    expect(restored).toEqual(V2);
  });

  it('a bare v1 pipeline (no `type`, no review) still parses unchanged', () => {
    const v1: Pipeline = {
      name: 'legacy',
      steps: [{ name: 'Step 1', prompt: 'refactor $file', files: ['src/a.ts'] }],
    };
    expect(parsePipelineFromJson(JSON.stringify(v1))).toEqual(v1);
  });
});
