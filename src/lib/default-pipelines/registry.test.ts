import { describe, it, expect } from 'vitest';
import { DEFAULT_PIPELINES } from './registry.js';
import { parsePipelineFromJson } from '../pipeline-io.js';
import type { CheckStep, Pipeline } from '../types.js';

const AUDIT_NAMES = [
  'huu Docs Audit',
  'huu Quality Audit',
  'huu Performance Audit',
  'huu Refactor Plan',
  'huu Security Audit',
];

function checkSteps(p: Pipeline): CheckStep[] {
  return p.steps.filter((s): s is CheckStep => s.type === 'check');
}

describe('default-pipelines registry', () => {
  it('registers 7 defaults with unique names and filenames', () => {
    expect(DEFAULT_PIPELINES).toHaveLength(7);
    const names = new Set(DEFAULT_PIPELINES.map((m) => m.DEFAULT_PIPELINE_NAME));
    const files = new Set(DEFAULT_PIPELINES.map((m) => m.DEFAULT_PIPELINE_FILENAME));
    expect(names.size).toBe(7);
    expect(files.size).toBe(7);
  });

  it('every default round-trips through the pipeline-io schema (incl. topology)', () => {
    for (const mod of DEFAULT_PIPELINES) {
      // parsePipelineFromJson runs the zod schema + validateTopology, so a
      // judge step pointing at a renamed/missing step fails right here.
      const parsed = parsePipelineFromJson(mod.getDefaultPipelineFileContent());
      expect(parsed.name).toBe(mod.DEFAULT_PIPELINE_NAME);
      expect(parsed.steps.length).toBeGreaterThan(0);
    }
  });

  it('only the Test Suite carries _default: true', () => {
    for (const mod of DEFAULT_PIPELINES) {
      const p = mod.getDefaultPipeline();
      if (mod.DEFAULT_PIPELINE_NAME === 'huu Test Suite') {
        expect(p._default).toBe(true);
      } else {
        expect(p._default).not.toBe(true);
      }
    }
  });

  it('each report-only audit gates its report behind exactly one judge check step', () => {
    for (const mod of DEFAULT_PIPELINES) {
      if (!AUDIT_NAMES.includes(mod.DEFAULT_PIPELINE_NAME)) continue;
      const p = mod.getDefaultPipeline();
      const checks = checkSteps(p);
      expect(checks, mod.DEFAULT_PIPELINE_NAME).toHaveLength(1);
      const judge = checks[0]!;
      // The default outcome MUST be the forward path ("approved") — the stub
      // backend and judge failures pick the default, so a backward default
      // would loop every smoke run until maxRuns.
      const def = judge.outcomes.find((o) => o.default);
      expect(def?.label, mod.DEFAULT_PIPELINE_NAME).toBe('approved');
      const rework = judge.outcomes.find((o) => o.label === 'rework');
      expect(rework, mod.DEFAULT_PIPELINE_NAME).toBeDefined();
      expect(judge.maxRuns ?? 99, mod.DEFAULT_PIPELINE_NAME).toBeLessThanOrEqual(3);
    }
  });

  it('audit bootstrap prompts carry the REPORT-ONLY hard rule', () => {
    for (const mod of DEFAULT_PIPELINES) {
      if (!AUDIT_NAMES.includes(mod.DEFAULT_PIPELINE_NAME)) continue;
      const p = mod.getDefaultPipeline();
      const first = p.steps[0]!;
      expect(first.type === 'check' ? '' : first.prompt, mod.DEFAULT_PIPELINE_NAME).toContain(
        'REPORT-ONLY',
      );
    }
  });

  it('every pipeline keeps the safety caps (maxRetries ≤ 3, maxNodeExecutions ≤ 50)', () => {
    for (const mod of DEFAULT_PIPELINES) {
      const p = mod.getDefaultPipeline();
      expect(p.maxRetries ?? 1, mod.DEFAULT_PIPELINE_NAME).toBeLessThanOrEqual(3);
      expect(p.maxNodeExecutions ?? 50, mod.DEFAULT_PIPELINE_NAME).toBeLessThanOrEqual(50);
    }
  });
});
