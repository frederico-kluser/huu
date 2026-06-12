import { describe, it, expect } from 'vitest';
import { runArchitect, type ArchitectInvoker, type ArchitectPhase } from './assistant-architect.js';
import type { BlueprintStep } from './assistant-schema.js';

const GOOD_BLUEPRINT: BlueprintStep[] = [
  { name: 'setup', type: 'work', summary: 'prepare', scope: 'project', dependsOn: [] },
  { name: 'scan', type: 'work', summary: 'find targets', scope: 'project', dependsOn: ['setup'], produces: '.huu/memory/t.json' },
  { name: 'fix each', type: 'work', summary: 'act per file', scope: 'memory', filesFrom: '.huu/memory/t.json', dependsOn: ['scan'] },
];

/** Same steps, but `setup` depends FORWARD on `scan` — rejected by topology. */
const BROKEN_BLUEPRINT: BlueprintStep[] = [
  { ...GOOD_BLUEPRINT[0]!, dependsOn: ['scan'] },
  GOOD_BLUEPRINT[1]!,
  GOOD_BLUEPRINT[2]!,
];

function makeInvoker(opts: { breakBlueprint?: boolean; failFixToo?: boolean } = {}): {
  invoker: ArchitectInvoker;
  calls: { name: string; prompt: string }[];
} {
  const calls: { name: string; prompt: string }[] = [];
  const invoker: ArchitectInvoker = async (schema, name, prompt, _temperature) => {
    calls.push({ name, prompt });
    if (name === 'PipelineSketch') {
      const lens = /Your design lens: (\S+)/.exec(prompt)?.[1] ?? 'unknown';
      return schema.parse({ lens, rationale: 'r', name: `sketch-${lens}`, steps: GOOD_BLUEPRINT });
    }
    if (name === 'PipelineSelection') {
      return schema.parse({
        winner: 1,
        reasoning: 'rubric comparison',
        grafts: [{ fromCandidate: 2, what: 'kept the memory pair' }],
        name: 'fused',
        steps: opts.breakBlueprint ? BROKEN_BLUEPRINT : GOOD_BLUEPRINT,
      });
    }
    if (name === 'StepPrompt') {
      const stepName = /"name":"([^"]+)"/.exec(prompt)?.[1] ?? 'step';
      return schema.parse({ prompt: `FINAL PROMPT for ${stepName}` });
    }
    if (name === 'FixedPipeline') {
      expect(prompt).toContain('Validation errors');
      return schema.parse({
        name: 'fused',
        steps: opts.failFixToo ? BROKEN_BLUEPRINT : GOOD_BLUEPRINT,
      });
    }
    throw new Error(`unexpected schema ${name}`);
  };
  return { invoker, calls };
}

const BASE = {
  apiKey: 'real-key',
  modelId: 'test/model',
  intent: 'audit performance and fix only the slow files',
  transcript: 'user: go',
};

describe('runArchitect', () => {
  it('sketches 3 lenses in parallel, selects, expands per work step and validates', async () => {
    const { invoker, calls } = makeInvoker();
    const phases: ArchitectPhase[] = [];
    const result = await runArchitect({
      ...BASE,
      invoker,
      onPhase: (p) => phases.push(p),
    });

    const sketchCalls = calls.filter((c) => c.name === 'PipelineSketch');
    expect(sketchCalls).toHaveLength(3);
    // Each sketch ran under a DIFFERENT lens (diversity, not resampling).
    const lenses = sketchCalls.map((c) => /Your design lens: (\S+)/.exec(c.prompt)?.[1]);
    expect(new Set(lenses).size).toBe(3);

    expect(calls.filter((c) => c.name === 'PipelineSelection')).toHaveLength(1);
    // One prompt expansion per WORK step of the fused blueprint.
    expect(calls.filter((c) => c.name === 'StepPrompt')).toHaveLength(3);

    expect(result.pipeline.name).toBe('fused');
    expect(result.pipeline.steps.map((s) => s.name)).toEqual(['setup', 'scan', 'fix each']);
    const fixStep = result.pipeline.steps[2]!;
    expect(fixStep.type === 'check' ? '' : fixStep.prompt).toBe('FINAL PROMPT for fix each');
    expect(result.meta.retried).toBe(false);
    expect(result.meta.grafts).toHaveLength(1);
    expect(phases[0]).toBe('sketching');
    expect(phases).toContain('selecting');
    expect(phases).toContain('expanding');
    expect(phases[phases.length - 1]).toBe('verifying');
  });

  it('feeds the interviewer baseline to the selector as candidate 0', async () => {
    const { invoker, calls } = makeInvoker();
    await runArchitect({
      ...BASE,
      invoker,
      baseline: {
        name: 'baseline-draft',
        steps: [{ name: 'one shot', prompt: 'do it', scope: 'project' }],
      },
    });
    const selector = calls.find((c) => c.name === 'PipelineSelection')!;
    expect(selector.prompt).toContain('interviewer-baseline');
    expect(selector.prompt).toContain('one shot');
    // Sketch prompts received the baseline to diverge from.
    const sketch = calls.find((c) => c.name === 'PipelineSketch')!;
    expect(sketch.prompt).toContain('Interviewer baseline');
  });

  it('repairs an invalid blueprint with ONE mechanically-guided fix', async () => {
    const { invoker, calls } = makeInvoker({ breakBlueprint: true });
    const result = await runArchitect({ ...BASE, invoker });
    expect(calls.filter((c) => c.name === 'FixedPipeline')).toHaveLength(1);
    expect(result.meta.retried).toBe(true);
    // Expanded prompts survived the fix (carried over by name).
    const scan = result.pipeline.steps.find((s) => s.name === 'scan')!;
    expect(scan.type === 'check' ? '' : scan.prompt).toBe('FINAL PROMPT for scan');
  });

  it('throws with the verbatim errors when the single fix also fails', async () => {
    const { invoker } = makeInvoker({ breakBlueprint: true, failFixToo: true });
    await expect(runArchitect({ ...BASE, invoker })).rejects.toThrow(/after one guided fix/);
  });

  it('stub mode returns a valid memory-pair pipeline without any invoker', async () => {
    const phases: ArchitectPhase[] = [];
    const result = await runArchitect({
      ...BASE,
      apiKey: 'stub',
      onPhase: (p) => phases.push(p),
    });
    expect(result.pipeline.steps).toHaveLength(2);
    const consumer = result.pipeline.steps[1]!;
    expect(consumer.type === 'check' ? undefined : consumer.scope).toBe('memory');
    expect(phases).toEqual(['sketching', 'selecting', 'expanding', 'verifying']);
  });
});
