import { describe, expect, it } from 'vitest';
import {
  planEpoch,
  planKnowledge,
  stubKnowledgeRequest,
  stubPlan,
  type PlannerInvoker,
} from './planner.js';
import { DevPlanSchema } from './plan-schema.js';
import { DEV_METHODOLOGIES } from './methodology-registry.js';
import { KnowledgeRequestSchema } from './knowledge-schema.js';
import { DYNAMIC_BOUNDARY } from './planner-prompts.js';
import type { DevEpochEvidence, DevEpochRecord } from '../types.js';

interface RecordedCall {
  name: string;
  prompt: string;
  temperature: number;
}

/**
 * An invoker that replays a script and records what it was asked. Everything
 * here is exercised through the real schemas and the real repair round — the
 * only thing stubbed is the network.
 */
function scripted(responses: unknown[]): { invoke: PlannerInvoker; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const invoke: PlannerInvoker = async (_schema, name, prompt, temperature) => {
    calls.push({ name, prompt, temperature });
    if (queue.length === 0) throw new Error(`invoker called ${calls.length}× but only ${responses.length} response(s) were scripted`);
    return queue.shift();
  };
  return { invoke, calls };
}

const GOAL = 'migrar o parser para streaming sem quebrar a API pública';

const baseLlm = { apiKey: 'test-key', modelId: 'test/model' } as const;

function knowledgeOpts(over: Record<string, unknown> = {}) {
  return { goal: GOAL, epoch: 1, history: [] as DevEpochRecord[], ...baseLlm, ...over };
}

function plannerOpts(over: Record<string, unknown> = {}) {
  return {
    goal: GOAL,
    epoch: 1,
    history: [] as DevEpochRecord[],
    maxFronts: 2,
    ...baseLlm,
    ...over,
  };
}

const VALID_REQUEST = {
  restatedGoal: 'trocar o parser por um streaming parser mantendo a API',
  gaps: [
    {
      id: 'parser-entrypoints',
      kind: 'repo',
      question: 'Onde vive o parser atual e quem o chama?',
      why: 'define quais arquivos a frente do parser pode tocar',
      goodAnswer: 'os paths do parser e de cada call site, com as linhas citadas',
    },
    {
      id: 'test-runner',
      kind: 'convention',
      question: 'Qual comando roda a suíte de testes deste projeto?',
      why: 'o juiz da frente precisa de um comando que exista',
      goodAnswer: 'o comando exato, e o arquivo de config que o define',
    },
  ],
  planningNotes: 'a API pública é o contrato; nada nela pode mudar',
};

const VALID_PLAN = {
  epochGoal: 'trocar o núcleo do parser',
  doneWhen: 'a suíte passa e a API pública não mudou',
  goalComplete: false,
  fronts: [
    {
      id: 'parser-core',
      title: 'Núcleo do parser',
      rationale: 'os arquivos do parser são uma unidade de propriedade',
      dependsOnFronts: [],
      reconPrompt: 'mapeie os arquivos do parser',
      workPrompt: 'implemente o streaming mantendo a assinatura pública',
      verifyCondition: 'a suíte de testes passa',
      maxTasks: 3,
    },
  ],
};

describe('planKnowledge', () => {
  it('returns the gaps the blind orchestrator asked for', async () => {
    const { invoke, calls } = scripted([VALID_REQUEST]);
    const request = await planKnowledge(knowledgeOpts({ invoker: invoke }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('DevKnowledgeRequest');
    expect(calls[0]!.temperature).toBe(0.4);
    expect(request.gaps.map((g) => g.id)).toEqual(['parser-entrypoints', 'test-runner']);
    expect(request.gaps[0]!.kind).toBe('repo');
    expect(request.restatedGoal).toContain('streaming parser');
    expect(KnowledgeRequestSchema.safeParse(request).success).toBe(true);
  });

  // An empty list is a COMPLETE answer ("I already know enough"), not a failure.
  it('accepts an empty gap list without retrying', async () => {
    const { invoke, calls } = scripted([{ restatedGoal: 'já sei o bastante', gaps: [] }]);
    const request = await planKnowledge(knowledgeOpts({ invoker: invoke }));
    expect(request.gaps).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('is BLIND: the prompt carries the goal and no repository content', async () => {
    const { invoke, calls } = scripted([VALID_REQUEST]);
    await planKnowledge(
      knowledgeOpts({ invoker: invoke, knowledgeSummary: '19 skills under .agents/skills/' }),
    );

    const prompt = calls[0]!.prompt;
    expect(prompt).toContain(GOAL);
    expect(prompt).toContain('19 skills under .agents/skills/');
    // Stage one runs BEFORE anything was read for it — there is no briefing
    // section, and no way for repo text to be in scope at all.
    expect(prompt).not.toContain('=== BRIEFINGS');
    expect(prompt).toContain('You have NOT read this repository');
    // The framing that keeps this defensible: delegation, not omission.
    expect(prompt).toMatch(/DELEGATE retrieval, you do not skip it/);
  });

  // The bounds only existed in Zod, which no provider enforces — which is how a
  // kebab-case id violation used to cost the whole session at parse time.
  it('states the schema bounds in prose', async () => {
    const { invoke, calls } = scripted([VALID_REQUEST]);
    await planKnowledge(knowledgeOpts({ invoker: invoke, maxGaps: 5 }));
    const prompt = calls[0]!.prompt;
    expect(prompt).toContain('kebab-case, 3 to 40 characters');
    expect(prompt).toContain('at most 5 entries');
    expect(prompt).toContain('at most 400 characters');
    expect(prompt).toContain('`repo`, `convention`, `external`');
  });

  it('repairs a schema violation in exactly one extra round', async () => {
    const broken = {
      restatedGoal: 'ok',
      gaps: [{ ...VALID_REQUEST.gaps[0]!, id: 'Bad_ID' }],
    };
    const { invoke, calls } = scripted([broken, VALID_REQUEST]);
    const request = await planKnowledge(knowledgeOpts({ invoker: invoke }));

    expect(calls).toHaveLength(2);
    expect(request.gaps).toHaveLength(2);
    // The repair prompt must carry the REJECTED value plus the verbatim issues
    // — that is the whole reason the invoker returns `unknown`.
    expect(calls[1]!.prompt).toContain('Bad_ID');
    expect(calls[1]!.prompt).toContain('gaps.0.id');
    expect(calls[1]!.prompt).toContain('kebab-case');
    // Colder on the repair: it is satisfying constraints, not re-deciding.
    expect(calls[1]!.temperature).toBe(0.2);
  });
});

describe('planEpoch', () => {
  it('plans from the briefings and validates against the real schema', async () => {
    const { invoke, calls } = scripted([VALID_PLAN]);
    const plan = await planEpoch(plannerOpts({ invoker: invoke, briefPack: 'o runner é vitest' }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('DevEpochPlan');
    expect(calls[0]!.temperature).toBe(0.4);
    expect(plan.fronts.map((f) => f.id)).toEqual(['parser-core']);
    expect(DevPlanSchema.safeParse(plan).success).toBe(true);
  });

  // THE regression this redesign exists for: the planner used to receive a
  // mechanically truncated dump of the repo. It now receives only what agents
  // reported back, and `projectDigest` is accepted-and-ignored so the driver
  // keeps compiling while it is migrated.
  it('never puts repository file content in the prompt', async () => {
    const DIGEST = 'DIGEST-MARKER export function parse(src: string) { /* 200 files */ }';
    const { invoke, calls } = scripted([VALID_PLAN]);
    await planEpoch(
      plannerOpts({
        invoker: invoke,
        projectDigest: DIGEST,
        briefPack: 'BRIEF-MARKER: o parser vive em src/parser/, chamado por src/cli.ts',
      }),
    );

    const prompt = calls[0]!.prompt;
    expect(prompt).not.toContain('DIGEST-MARKER');
    expect(prompt).not.toContain('=== THE REPOSITORY ===');
    expect(prompt).toContain('BRIEF-MARKER');
    expect(prompt).toContain('=== BRIEFINGS');
    expect(prompt).toContain(GOAL);
  });

  // No briefings means no knowledge — say so instead of letting the model fill
  // the silence with a plausible-looking structure.
  it('says out loud when no briefing arrived', async () => {
    const { invoke, calls } = scripted([VALID_PLAN]);
    await planEpoch(plannerOpts({ invoker: invoke }));
    const prompt = calls[0]!.prompt;
    expect(prompt).toContain('no knowledge request was answered');
    expect(prompt).toContain('plan ONE front');
  });

  it('states the schema bounds in prose', async () => {
    const { invoke, calls } = scripted([VALID_PLAN]);
    await planEpoch(plannerOpts({ invoker: invoke, briefPack: 'x' }));
    const prompt = calls[0]!.prompt;
    expect(prompt).toContain('kebab-case, 3 to 40 characters');
    expect(prompt).toContain('an integer from 1 to 40');
    expect(prompt).toContain('at most 6000 characters');
    expect(prompt).toContain('at most 2 front(s)');
  });

  it('repairs a schema violation in exactly one extra round', async () => {
    const broken = {
      ...VALID_PLAN,
      fronts: [{ ...VALID_PLAN.fronts[0]!, id: 'Parser Core', maxTasks: 99 }],
    };
    const { invoke, calls } = scripted([broken, VALID_PLAN]);
    const plan = await planEpoch(plannerOpts({ invoker: invoke, briefPack: 'x' }));

    expect(calls).toHaveLength(2);
    expect(plan.fronts[0]!.id).toBe('parser-core');
    expect(calls[1]!.prompt).toContain('Parser Core');
    expect(calls[1]!.prompt).toContain('fronts.0.id');
    expect(calls[1]!.temperature).toBe(0.2);
  });

  // The knowledge schema promises planningNotes come back at planning time —
  // this is where that promise lands in the prompt.
  it('renders the planningNotes the knowledge request left for planning time', async () => {
    const { invoke, calls } = scripted([VALID_PLAN]);
    await planEpoch(
      plannerOpts({
        invoker: invoke,
        briefPack: 'x',
        planningNotes: 'a API pública é o contrato; nada nela pode mudar',
      }),
    );

    const prompt = calls[0]!.prompt;
    expect(prompt).toContain('YOUR NOTES TO YOURSELF');
    expect(prompt).toContain('a API pública é o contrato; nada nela pode mudar');
  });

  // A request that carried no notes must compile the SAME prompt as before the
  // field existed — the section is absent, not empty.
  it('stays byte-identical when no planningNotes were left', async () => {
    const without = scripted([VALID_PLAN]);
    await planEpoch(plannerOpts({ invoker: without.invoke, briefPack: 'x' }));
    const baseline = without.calls[0]!.prompt;
    expect(baseline).not.toContain('YOUR NOTES TO YOURSELF');

    const explicitUndefined = scripted([VALID_PLAN]);
    await planEpoch(plannerOpts({ invoker: explicitUndefined.invoke, briefPack: 'x', planningNotes: undefined }));
    expect(explicitUndefined.calls[0]!.prompt).toBe(baseline);

    const blank = scripted([VALID_PLAN]);
    await planEpoch(plannerOpts({ invoker: blank.invoke, briefPack: 'x', planningNotes: '   ' }));
    expect(blank.calls[0]!.prompt).toBe(baseline);
  });

  // The methodologies the human underwrote reach the planner as CONTENT
  // constraints — the compiler owns the structure they become.
  it('renders the active methodologies as content constraints on the plan', async () => {
    const { invoke, calls } = scripted([VALID_PLAN]);
    await planEpoch(
      plannerOpts({
        invoker: invoke,
        briefPack: 'x',
        methodology: { tdd: true, planReview: true },
      }),
    );

    const prompt = calls[0]!.prompt;
    expect(prompt).toContain('METODOLOGIAS ATIVAS (mandatadas pelo humano)');
    expect(prompt).toContain('TESTS COME FIRST');
    expect(prompt).toContain('AUDITED before the fan-out');
    // Only the enabled options are listed.
    expect(prompt).not.toContain('`lintGate`');
    expect(prompt).not.toContain('`standards`');
  });

  it('renders every registered methodology when all are on', async () => {
    const { invoke, calls } = scripted([VALID_PLAN]);
    await planEpoch(
      plannerOpts({
        invoker: invoke,
        briefPack: 'x',
        methodology: Object.fromEntries(DEV_METHODOLOGIES.map((d) => [d.key, true])),
      }),
    );

    const prompt = calls[0]!.prompt;
    // Registry-driven: an option added without a planner bullet fails HERE,
    // rather than silently reaching the planner as an unexplained constraint.
    for (const def of DEV_METHODOLOGIES) {
      expect(prompt, def.key).toContain(`\`${def.key}\``);
      expect(prompt, def.key).toContain(def.plannerBullet);
    }
    expect(prompt).toContain('merge gate');
    expect(prompt).toContain('DECLARED conventions');
  });

  // Same contract as planningNotes: a session with nothing underwritten must
  // compile the SAME prompt as before the field existed.
  it('stays byte-identical when no methodology is set', async () => {
    const without = scripted([VALID_PLAN]);
    await planEpoch(plannerOpts({ invoker: without.invoke, briefPack: 'x' }));
    const baseline = without.calls[0]!.prompt;
    expect(baseline).not.toContain('METODOLOGIAS ATIVAS');

    const explicitUndefined = scripted([VALID_PLAN]);
    await planEpoch(plannerOpts({ invoker: explicitUndefined.invoke, briefPack: 'x', methodology: undefined }));
    expect(explicitUndefined.calls[0]!.prompt).toBe(baseline);

    const allOff = scripted([VALID_PLAN]);
    await planEpoch(
      plannerOpts({
        invoker: allOff.invoke,
        briefPack: 'x',
        methodology: Object.fromEntries(DEV_METHODOLOGIES.map((d) => [d.key, false])),
      }),
    );
    expect(allOff.calls[0]!.prompt).toBe(baseline);
  });

  // Two failures abort — but the message has to name what the model never
  // understood, which is why BOTH issue lists travel with it.
  it('throws with both issue lists when the repair also fails', async () => {
    const brokenId = { ...VALID_PLAN, fronts: [{ ...VALID_PLAN.fronts[0]!, id: 'Parser Core' }] };
    const brokenGoal = { ...VALID_PLAN, epochGoal: '' };
    const { invoke, calls } = scripted([brokenId, brokenGoal]);

    await expect(planEpoch(plannerOpts({ invoker: invoke, briefPack: 'x' }))).rejects.toThrow(
      /failed validation twice/,
    );
    expect(calls).toHaveLength(2);

    let message = '';
    try {
      await planEpoch(plannerOpts({ invoker: scripted([brokenId, brokenGoal]).invoke, briefPack: 'x' }));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('fronts.0.id'); // first attempt
    expect(message).toContain('epochGoal'); // after the guided repair
  });
});

describe('the epoch history and evidence both stages receive', () => {
  const history: DevEpochRecord[] = [
    {
      epoch: 1,
      runId: 'r1',
      epochGoal: 'primeira fatia',
      frontIds: ['parser-core'],
      status: 'done',
      startedAt: '2026-07-01T00:00:00.000Z',
      finishedAt: '2026-07-01T01:00:00.000Z',
    },
  ];

  const evidence: DevEpochEvidence = {
    epoch: 1,
    diffStat: ' src/parser/index.ts | 40 ++++',
    filesChanged: ['src/parser/index.ts'],
    verdicts: [
      { stepName: '1c. parser — verificar', label: 'approved', fromJudge: false, reason: 'cap' },
    ],
    waived: [
      {
        agentId: 3,
        stageName: '1b. parser — implementar',
        findings: [
          {
            id: 'R1',
            severity: 'major',
            category: 'correctness',
            file: 'src/parser/index.ts',
            summary: 'o buffer não é drenado no fim do stream',
            evidence: 'linha 40',
            fix: 'drenar antes de fechar',
          },
        ],
      },
    ],
    taskOutcomes: { done: 2, noChanges: 0, failed: 1, unmerged: 0 },
    landing: { landed: true, commit: 'abc123' },
  };

  it('gives the knowledge stage the measured outcome, not a self-report', async () => {
    const { invoke, calls } = scripted([VALID_REQUEST]);
    await planKnowledge(
      knowledgeOpts({ invoker: invoke, epoch: 2, history, previousEvidence: evidence }),
    );

    const prompt = calls[0]!.prompt;
    expect(prompt).toContain('Epoch 1 (done): primeira fatia');
    expect(prompt).toContain('2 done, 0 produced nothing, 1 failed');
    // The single highest-signal row: work that merged while a critic objected.
    expect(prompt).toContain('Merged WITH the reviewer still objecting');
    expect(prompt).toContain('o buffer não é drenado no fim do stream');
    // A verdict the judge never produced is named as such — the forward
    // default fires on failure, so "approved" there means "never verified".
    expect(prompt).toContain('NO judge answer');
    // From epoch 2 on, huu asks the delivered-vs-promised question itself.
    expect(prompt).toContain('Do NOT re-ask that');
  });

  it('gives the planner the same evidence alongside the report', async () => {
    const { invoke, calls } = scripted([VALID_PLAN]);
    await planEpoch(
      plannerOpts({
        invoker: invoke,
        epoch: 2,
        history,
        previousEvidence: evidence,
        previousReport: '## Pendências\n- nada',
        briefPack: 'x',
      }),
    );
    const prompt = calls[0]!.prompt;
    expect(prompt).toContain('WHAT EPOCH 1 ACTUALLY DID');
    expect(prompt).toContain('## Pendências');
    expect(prompt).toContain('merged as abc123');
  });
});

describe('the stub path (no key, no network)', () => {
  it('asks for no knowledge at all', async () => {
    const request = await planKnowledge(knowledgeOpts({ apiKey: 'stub' }));
    expect(request.gaps).toEqual([]);
    expect(request.restatedGoal).toContain('migrar o parser');
    expect(KnowledgeRequestSchema.safeParse(request).success).toBe(true);
    // The pure helper agrees with the routed call.
    expect(stubKnowledgeRequest(GOAL).gaps).toEqual([]);
  });

  it('still returns the deterministic single-front plan', async () => {
    const plan = await planEpoch(plannerOpts({ apiKey: 'stub' }));
    expect(plan).toEqual(stubPlan(GOAL, 1));
    expect(plan.fronts.map((f) => f.id)).toEqual(['stub-front']);
    expect(plan.goalComplete).toBe(false);
    expect(DevPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('routes to the stub for the stub BACKEND too, for both stages', async () => {
    const llmContext = { backend: 'stub' as const };
    expect((await planKnowledge(knowledgeOpts({ llmContext }))).gaps).toEqual([]);
    expect((await planEpoch(plannerOpts({ llmContext }))).fronts).toHaveLength(1);
  });

  // An injected invoker always wins: that is what keeps every other test in
  // this file (and the driver's) exercising the real path.
  it('prefers an injected invoker over the stub', async () => {
    const { invoke, calls } = scripted([VALID_PLAN]);
    const plan = await planEpoch(plannerOpts({ apiKey: 'stub', invoker: invoke }));
    expect(calls).toHaveLength(1);
    expect(plan.fronts[0]!.id).toBe('parser-core');
  });
});

describe('the cache boundary (stable prefix above, epoch context below)', () => {
  const laterHistory: DevEpochRecord[] = [
    {
      epoch: 1,
      runId: 'r1',
      epochGoal: 'fatia já entregue',
      frontIds: ['parser-core'],
      status: 'done',
      startedAt: '2026-07-01T00:00:00.000Z',
      finishedAt: '2026-07-01T01:00:00.000Z',
    },
  ];

  const laterEvidence: DevEpochEvidence = {
    epoch: 1,
    diffStat: '',
    filesChanged: ['src/parser/index.ts'],
    verdicts: [],
    waived: [],
    taskOutcomes: { done: 1, noChanges: 0, failed: 0, unmerged: 0 },
    landing: { landed: true, commit: 'def456' },
  };

  // The whole point of the reorder: digest, history, evidence, notes and
  // methodology may change freely without touching a single byte before the
  // boundary — that shared prefix is what provider prompt caches keep.
  it('planner prompts that differ only in epoch context share the prefix up to the boundary', async () => {
    const a = scripted([VALID_PLAN]);
    await planEpoch(plannerOpts({ invoker: a.invoke, briefPack: 'DIGEST-A: parser em src/parser' }));

    const b = scripted([VALID_PLAN]);
    await planEpoch(
      plannerOpts({
        invoker: b.invoke,
        history: laterHistory,
        previousEvidence: laterEvidence,
        previousReport: '## Pendências\n- outra coisa',
        briefPack: 'DIGEST-B: nada parecido com o A',
        knowledgeSummary: '3 skills under .agents/skills/',
        planningNotes: 'notas diferentes',
        methodology: { tdd: true },
      }),
    );

    const promptA = a.calls[0]!.prompt;
    const promptB = b.calls[0]!.prompt;
    expect(promptA).toContain(DYNAMIC_BOUNDARY);
    expect(promptB).toContain(DYNAMIC_BOUNDARY);
    expect(promptA.slice(0, promptA.indexOf(DYNAMIC_BOUNDARY))).toBe(
      promptB.slice(0, promptB.indexOf(DYNAMIC_BOUNDARY)),
    );
  });

  it('renders every dynamic planner section after the boundary, every stable one before', async () => {
    const { invoke, calls } = scripted([VALID_PLAN]);
    await planEpoch(
      plannerOpts({
        invoker: invoke,
        history: laterHistory,
        previousEvidence: laterEvidence,
        previousReport: '## Pendências\n- nada',
        knowledgeSummary: '19 skills under .agents/skills/',
        planningNotes: 'anotações',
        methodology: { tdd: true, lintGate: true, standards: true, planReview: true },
        briefPack: 'digest',
      }),
    );

    const prompt = calls[0]!.prompt;
    const boundary = prompt.indexOf(DYNAMIC_BOUNDARY);
    expect(boundary).toBeGreaterThan(-1);
    for (const marker of [
      '=== HISTORY',
      '=== WHAT EPOCH 1 ACTUALLY DID',
      '=== PREVIOUS EPOCH REPORT ===',
      '=== PROJECT KNOWLEDGE ===',
      '=== YOUR NOTES TO YOURSELF',
      '=== METODOLOGIAS ATIVAS',
      '=== BRIEFINGS',
    ]) {
      expect(prompt.indexOf(marker)).toBeGreaterThan(boundary);
    }
    for (const marker of [
      '=== THE GOAL',
      '=== WHAT A FRONT IS ===',
      '=== THE RULE THAT DECIDES IF THIS WORKS ===',
      '=== WRITING THE THREE PROMPTS ===',
      '=== DO NOT ===',
      '=== YOUR OUTPUT',
    ]) {
      expect(prompt.indexOf(marker)).toBeGreaterThan(-1);
      expect(prompt.indexOf(marker)).toBeLessThan(boundary);
    }
  });

  it('gives the knowledge request the same split', async () => {
    const a = scripted([VALID_REQUEST]);
    await planKnowledge(knowledgeOpts({ invoker: a.invoke }));

    const b = scripted([VALID_REQUEST]);
    await planKnowledge(
      knowledgeOpts({
        invoker: b.invoke,
        history: laterHistory,
        previousEvidence: laterEvidence,
        knowledgeSummary: '19 skills under .agents/skills/',
      }),
    );

    const promptA = a.calls[0]!.prompt;
    const promptB = b.calls[0]!.prompt;
    expect(promptA).toContain(DYNAMIC_BOUNDARY);
    expect(promptA.slice(0, promptA.indexOf(DYNAMIC_BOUNDARY))).toBe(
      promptB.slice(0, promptB.indexOf(DYNAMIC_BOUNDARY)),
    );

    const boundary = promptB.indexOf(DYNAMIC_BOUNDARY);
    for (const marker of ['=== HISTORY', '=== WHAT EPOCH 1 ACTUALLY DID', '=== PROJECT KNOWLEDGE ===']) {
      expect(promptB.indexOf(marker)).toBeGreaterThan(boundary);
    }
    for (const marker of [
      '=== THE GOAL',
      '=== WHAT HAPPENS TO YOUR QUESTIONS ===',
      '=== THE THREE LANES',
      '=== HOW TO ASK WELL ===',
      '=== YOUR OUTPUT',
    ]) {
      expect(promptB.indexOf(marker)).toBeGreaterThan(-1);
      expect(promptB.indexOf(marker)).toBeLessThan(boundary);
    }
  });
});
