import { describe, expect, it } from 'vitest';
import { computeWave, hasDagEdges } from '../../orchestrator/wave-scheduler.js';
import { PipelineSchema, validateTopology } from '../pipeline-io.js';
import { isCheckStep, isWorkStep, type Pipeline, type WorkStep } from '../types.js';
import { devSessionPaths } from './dev-protocol.js';
import { KNOWLEDGE_DIGEST_MAX_CHARS } from './knowledge-blackboard.js';
import {
  KNOWLEDGE_STEP_NAMES,
  compileKnowledgePipeline,
  type CompileKnowledgeOptions,
} from './knowledge-to-pipeline.js';
import { type KnowledgeGap } from './knowledge-schema.js';

const paths = devSessionPaths('sess-1');

function gap(id: string, over: Partial<KnowledgeGap> = {}): KnowledgeGap {
  return {
    id,
    kind: 'repo',
    question: `what about ${id}?`,
    why: `because ${id}`,
    goodAnswer: `paths proving ${id}`,
    ...over,
  };
}

function compile(
  gaps: KnowledgeGap[],
  over: Partial<CompileKnowledgeOptions> = {},
): ReturnType<typeof compileKnowledgePipeline> {
  return compileKnowledgePipeline({
    gaps,
    epoch: 1,
    goal: 'the human goal',
    paths,
    ...over,
  });
}

/** Every step of this pipeline is a work step — there is no judge here. */
function stepNamed(pipeline: Pipeline, name: string): WorkStep {
  const step = pipeline.steps.find((s) => s.name === name);
  expect(step).toBeDefined();
  expect(isWorkStep(step!)).toBe(true);
  return step as WorkStep;
}

describe('compileKnowledgePipeline', () => {
  it('emits the answer step and the consolidation step, and nothing else that thinks', () => {
    const { pipeline, gapIds, warnings } = compile([gap('alpha'), gap('beta')]);

    expect(gapIds).toEqual(['alpha', 'beta']);
    expect(warnings).toEqual([]);
    expect(pipeline.steps.map((s) => s.name)).toEqual([
      // K0 exists only because `validateTopology` forbids a memory-scope step
      // at index 0; it does the persistence check, which is the one job this
      // run genuinely needs done before any agent writes under `.huu/dev/`.
      KNOWLEDGE_STEP_NAMES.prepare,
      KNOWLEDGE_STEP_NAMES.answer,
      KNOWLEDGE_STEP_NAMES.consolidate,
    ]);
    // No judge: a rework loop here would re-run the whole fan-out to fix one
    // file that `readKnowledgeDigest` can rebuild deterministically.
    expect(pipeline.steps.filter(isCheckStep)).toHaveLength(0);
    expect(pipeline.maxNodeExecutions).toBe(4);
  });

  it('fans K1 out over the driver-written index, one agent per gap', () => {
    const gaps = [gap('alpha'), gap('beta'), gap('gamma')];
    const { pipeline } = compile(gaps, { epoch: 4 });
    const k1 = stepNamed(pipeline, KNOWLEDGE_STEP_NAMES.answer);
    expect(k1.scope).toBe('memory');
    expect(k1.filesFrom).toBe(paths.knowledgeIndex(4));
    expect(k1.maxFiles).toBe(gaps.length);
    expect(k1.files).toEqual([]);
    // No producer step: huu wrote the index in TypeScript and committed it.
    expect(pipeline.steps.some((s) => isWorkStep(s) && s.produces !== undefined)).toBe(false);
    expect(k1.prompt).toContain('$file');
    expect(k1.prompt).toContain('$hint');
  });

  it('joins the consolidation onto the fan-out', () => {
    const { pipeline } = compile([gap('alpha')]);
    const k2 = stepNamed(pipeline, KNOWLEDGE_STEP_NAMES.consolidate);
    expect(k2.dependsOn).toEqual([KNOWLEDGE_STEP_NAMES.answer]);
    expect(k2.scope).toBe('project');
    expect(k2.files).toEqual([]);
  });

  it('passes the real schema and topology check', () => {
    const { pipeline } = compile([gap('alpha'), gap('beta')]);
    const parsed = PipelineSchema.safeParse(pipeline);
    expect(parsed.success).toBe(true);
    expect(validateTopology(pipeline)).toEqual([]);
  });

  it('runs as three sequential waves under the real scheduler', () => {
    const { pipeline } = compile([gap('alpha'), gap('beta')]);
    const steps = pipeline.steps;
    expect(hasDagEdges(steps)).toBe(true);

    const pending = new Set(steps.map((s) => s.name));
    const first = computeWave(steps, new Set(), pending);
    expect(first.map((s) => s.name)).toEqual([KNOWLEDGE_STEP_NAMES.prepare]);

    pending.delete(KNOWLEDGE_STEP_NAMES.prepare);
    const second = computeWave(steps, new Set([KNOWLEDGE_STEP_NAMES.prepare]), pending);
    expect(second.map((s) => s.name)).toEqual([KNOWLEDGE_STEP_NAMES.answer]);

    pending.delete(KNOWLEDGE_STEP_NAMES.answer);
    const third = computeWave(
      steps,
      new Set([KNOWLEDGE_STEP_NAMES.prepare, KNOWLEDGE_STEP_NAMES.answer]),
      pending,
    );
    expect(third.map((s) => s.name)).toEqual([KNOWLEDGE_STEP_NAMES.consolidate]);
  });

  it('stamps the subagent model on every step, and omits the field without one', () => {
    const stamped = compile([gap('alpha')], { subagentModelId: 'deepseek/deepseek-v4-pro' }).pipeline;
    for (const step of stamped.steps) {
      expect(isWorkStep(step) && step.modelId).toBe('deepseek/deepseek-v4-pro');
    }

    const plain = compile([gap('alpha')]).pipeline;
    for (const step of plain.steps) {
      expect(isWorkStep(step) && 'modelId' in step).toBe(false);
    }
  });

  it('forwards the card timeouts only when they were given', () => {
    const { pipeline } = compile([gap('alpha')], {
      cardTimeoutMs: 111,
      singleFileCardTimeoutMs: 222,
    });
    expect(pipeline.cardTimeoutMs).toBe(111);
    expect(pipeline.singleFileCardTimeoutMs).toBe(222);
    expect('cardTimeoutMs' in compile([gap('alpha')]).pipeline).toBe(false);
  });

  it('refuses to compile an empty knowledge epoch', () => {
    // "No gaps" means the orchestrator already knows enough — the DRIVER skips
    // Phase A. Compiling it would spend a whole run to learn nothing.
    expect(() => compile([])).toThrow(/no knowledge gaps/);
  });

  it('drops a duplicate or unusable gap and narrows the fan-out to match', () => {
    const { pipeline, gapIds, warnings } = compile([gap('alpha'), gap('alpha'), gap('Bad Id')]);
    expect(gapIds).toEqual(['alpha']);
    expect(warnings).toHaveLength(2);
    expect(stepNamed(pipeline, KNOWLEDGE_STEP_NAMES.answer).maxFiles).toBe(1);
  });

  it('refuses when nothing survives the repair', () => {
    expect(() => compile([gap('Bad Id')])).toThrow(/no usable knowledge gaps/);
  });

  it('carries the persistence check into K0', () => {
    const k0 = stepNamed(compile([gap('alpha')]).pipeline, KNOWLEDGE_STEP_NAMES.prepare);
    expect(k0.prompt).toContain('PERSISTENCE CHECK');
    expect(k0.prompt).toContain('.huu/dev');
    expect(k0.prompt).toContain('git check-ignore');
  });

  it('gives K1 the brief contract and the anti-filler rule', () => {
    const k1 = stepNamed(compile([gap('alpha')]).pipeline, KNOWLEDGE_STEP_NAMES.answer);
    expect(k1.prompt).toContain('huu-devbrief-v1');
    expect(k1.prompt).toContain('"unknowns"');
    expect(k1.prompt).toContain('`unknowns` is REQUIRED');
    expect(k1.prompt).toContain('an honest gap beats an invented fact');
    expect(k1.prompt).toContain('the human goal');
    expect(k1.prompt).toContain(paths.briefsDir(1));
    expect(k1.prompt).toContain('Change NO source code');
  });

  it('tells K2 the budget, the fixed section shape and every gap it must cover', () => {
    const { pipeline } = compile([gap('alpha'), gap('beta', { kind: 'external' })], { epoch: 2 });
    const k2 = stepNamed(pipeline, KNOWLEDGE_STEP_NAMES.consolidate);
    expect(k2.prompt).toContain(paths.knowledgeDigest(2));
    expect(k2.prompt).toContain(paths.briefsDir(2));
    expect(k2.prompt).toContain(String(KNOWLEDGE_DIGEST_MAX_CHARS));
    for (const field of ['**Resposta:**', '**Confiança:**', '**Fatos:**', '**Em aberto:**']) {
      expect(k2.prompt).toContain(field);
    }
    // The gap list is what lets K2 notice a shard that never arrived.
    expect(k2.prompt).toContain('`alpha` — what about alpha?');
    expect(k2.prompt).toContain('`beta` — what about beta?');
    expect(k2.prompt).toContain('sem resposta');
  });

  it('gives K2 the four dream operations over the shards', () => {
    const k2 = stepNamed(
      compile([gap('alpha'), gap('beta')]).pipeline,
      KNOWLEDGE_STEP_NAMES.consolidate,
    );
    // The AutoDream-style reflective pass: dedupe near-duplicates, resolve
    // contradictions with a marked supersession, prune what the planner cannot
    // act on, and flag facts that drifted from reality.
    for (const op of ['1. DEDUPE', '2. CONTRADICTIONS', '3. PRUNE', '4. DRIFT']) {
      expect(k2.prompt).toContain(op);
    }
    expect(k2.prompt).toContain('(supersedes:');
    expect(k2.prompt).toContain('(drifted)');
    // A contradiction is never silently dropped: the `conflito:` fallback
    // stays for the case where the shards themselves offer no winner.
    expect(k2.prompt).toContain('conflito:');
  });

  it('names the epoch it was compiled for', () => {
    const { pipeline } = compile([gap('alpha')], { epoch: 7 });
    expect(pipeline.name).toContain('7');
    expect(pipeline.description).toContain(paths.knowledgeDigest(7));
  });

  it('injects the knowledge summary only when the project has one', () => {
    const withSummary = compile([gap('alpha')], { knowledgeSummary: '19 skills under .agents' })
      .pipeline;
    expect(stepNamed(withSummary, KNOWLEDGE_STEP_NAMES.answer).prompt).toContain(
      '19 skills under .agents',
    );
    expect(stepNamed(compile([gap('alpha')]).pipeline, KNOWLEDGE_STEP_NAMES.answer).prompt).not.toContain(
      'PROJECT KNOWLEDGE',
    );
  });
});

describe('compileKnowledgePipeline — chainOfVerification', () => {
  const gaps = [gap('parser-entrypoints'), gap('test-runner')];

  it('emits the three-step graph, byte-identical, when the option is off', () => {
    const plain = compile(gaps);
    for (const methodology of [undefined, {}, { chainOfVerification: false }, { tdd: true }]) {
      const other = compile(gaps, methodology ? { methodology } : {});
      expect(JSON.stringify(other.pipeline), JSON.stringify(methodology)).toBe(
        JSON.stringify(plain.pipeline),
      );
    }
  });

  it('inserts the verification step between answering and consolidating', () => {
    const { pipeline } = compile(gaps, { methodology: { chainOfVerification: true } });
    expect(pipeline.steps.map((s) => s.name)).toEqual([
      'K0. Preparar o quadro',
      'K1. Responder lacunas',
      'K1.5. Verificar as afirmações',
      'K2. Consolidar briefings',
    ]);
    expect(pipeline.steps[3]!.dependsOn).toEqual(['K1.5. Verificar as afirmações']);
    expect(PipelineSchema.safeParse(pipeline).success).toBe(true);
    expect(validateTopology(pipeline)).toEqual([]);
  });

  // One verifier per brief, blind to the others — the same fan-out shape K1
  // uses, over the same index huu committed before the run started.
  it('fans out over the same committed index as the answering step', () => {
    const { pipeline } = compile(gaps, { methodology: { chainOfVerification: true } });
    const answer = pipeline.steps[1]!;
    const verify = pipeline.steps[2]!;
    expect(isWorkStep(verify) && verify.scope).toBe('memory');
    expect(isWorkStep(verify) && verify.filesFrom).toBe(isWorkStep(answer) && answer.filesFrom);
    expect(isWorkStep(verify) && verify.maxFiles).toBe(gaps.length);
  });

  // Phase A has no CheckStep by design: every path out of it is forward. This
  // step must DEMOTE, never fail, or it breaks that invariant.
  it('demotes rather than fails, and never adds a claim of its own', () => {
    const { pipeline } = compile(gaps, { methodology: { chainOfVerification: true } });
    expect(pipeline.steps.filter((s) => s.type === 'check')).toHaveLength(0);
    const prompt = (isWorkStep(pipeline.steps[2]!) && pipeline.steps[2]!.prompt) as string;
    expect(prompt).toMatch(/You DEMOTE, you never delete and you never fail/);
    expect(prompt).toMatch(/You do NOT add facts/);
    // The brief is the thing under test — answering from it defeats the pass.
    expect(prompt).toMatch(/Do NOT answer it from the brief/);
    // Three verdicts, and abstention is legitimate.
    for (const verdict of ['VERIFIED', 'WRONG', 'UNVERIFIABLE']) {
      expect(prompt, verdict).toContain(verdict);
    }
  });
});
