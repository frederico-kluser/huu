// The dev-mode orchestrator: TWO schema-enforced LLM calls per epoch.
//
//   1. `planKnowledge` — the blind orchestrator declares WHAT IT NEEDS TO KNOW.
//      No repo digest, no file access, no tools: just the human's goal, what
//      previous epochs did, and the project's knowledge surface. It returns
//      questions, which huu materializes as real spec files and answers with a
//      parallel fan-out of agents that DO have a shell.
//   2. `planEpoch` — the same orchestrator plans the epoch against `briefPack`,
//      the consolidated answer to those questions. That briefing is the ONLY
//      thing about the repository it ever reads.
//
// The redesign in one sentence: the leader DELEGATES retrieval, it does not
// skip it. The old shape handed the planner a mechanically truncated digest of
// the repo (200 files, no relevance signal) and hoped; this one lets it ask.
//
// Both calls go through `invokeWithRepair`, which is the other half of the
// change. A `ZodError` used to cost the whole session — the driver turns a
// planner throw into `planner-failed` — for a model that got 90% of a plan
// right and mislabeled one field. Now the first failure buys one guided repair
// with the verbatim issues, and only a second failure aborts.
//
// Mirrors the seam `assistant-architect.ts` established — `buildChatClient`
// + `withStructuredOutput`, an injectable `invoker` for tests, temperature 0.4
// for the judgement call and 0.2 for the repair, and a deterministic stub path
// so `--stub` stays a real end-to-end smoke run with no network and no key.
//
// The planner NEVER decides whether its plan is runnable: `compileEpochPipeline`
// does that mechanically. Everything this module guarantees is that the value
// it returns matches its schema.

import { HumanMessage } from '@langchain/core/messages';
import type { z } from 'zod';
import { buildChatClient, type LlmClientContext } from '../llm-client-factory.js';
import { DEV_MAX_FRONTS, type DevPlan } from '../types.js';
import { DevPlanSchema } from './plan-schema.js';
import { KnowledgeRequestSchema, type KnowledgeRequest } from './knowledge-schema.js';
import { invokeWithRepair, type StructuredInvoker } from './structured-invoke.js';
import {
  buildKnowledgePrompt,
  buildPlannerPrompt,
  buildRepairPrompt,
  stubPlanFronts,
  type KnowledgePromptInput,
  type PlannerPromptInput,
} from './planner-prompts.js';

/**
 * One structured LLM call, UNPARSED.
 *
 * Deliberately returns `unknown` rather than the schema's type: the repair
 * round needs the value the schema REJECTED, so validation happens after the
 * call (in `invokeWithRepair`), not inside the invoker. An invoker that parses
 * internally has already thrown away the only evidence the repair prompt has
 * to work with.
 */
export type PlannerInvoker = StructuredInvoker;

/** Everything both stages need to reach a model. */
interface LlmAccess {
  apiKey: string;
  modelId: string;
  llmContext?: LlmClientContext;
  /** Test seam: replaces the real (network) invoker. */
  invoker?: PlannerInvoker;
}

export interface PlanKnowledgeOptions extends KnowledgePromptInput, LlmAccess {}

export interface PlanEpochOptions extends PlannerPromptInput, LlmAccess {
  /**
   * @deprecated Accepted and IGNORED. The planner no longer reads a repo
   * digest — `briefPack` replaced it, and the digest is exactly the
   * unfiltered, relevance-free input the two-stage protocol exists to remove.
   * The field stays declared purely so the existing driver call site keeps
   * compiling while it is migrated; it is never read, and nothing it contains
   * can reach a prompt.
   */
  projectDigest?: string;
}

/** Planning is a judgement call, not a lookup — a little spread helps. */
const PLANNER_TEMPERATURE = 0.4;

/**
 * The repair call runs colder than the first one. It is not being asked to
 * think again — it is being asked to satisfy a list of mechanical constraints
 * it already has in front of it, and resampling the judgement is how a repair
 * turns into a second, differently-wrong answer. Same value
 * `assistant-architect.ts` uses for its guided fix.
 */
const REPAIR_TEMPERATURE = 0.2;

function shouldStub(opts: LlmAccess): boolean {
  return (
    !opts.invoker &&
    (process.env.HUU_LANGCHAIN_STUB === '1' ||
      opts.apiKey.trim() === 'stub' ||
      opts.llmContext?.backend === 'stub')
  );
}

/**
 * The real invoker: one structured-output call, returned unparsed.
 * `withStructuredOutput` already constrains the provider; whether the result
 * actually satisfies the schema is decided by the caller.
 */
function buildInvoker(opts: LlmAccess): PlannerInvoker {
  if (opts.invoker) return opts.invoker;
  const ctx: LlmClientContext = opts.llmContext ?? { backend: 'jcode', deepseekApiKey: opts.apiKey };
  return async (schema, name, prompt, temperature) => {
    const chat = buildChatClient(ctx, { modelId: opts.modelId, temperature });
    const structured = chat.withStructuredOutput(schema as z.ZodTypeAny, {
      name,
      method: 'functionCalling',
    });
    return structured.invoke([new HumanMessage(prompt)]);
  };
}

/**
 * Wrap an invoker so the FIRST call keeps its temperature and every later one
 * (i.e. the repair) runs at {@link REPAIR_TEMPERATURE}.
 *
 * `invokeWithRepair` passes one temperature to both calls by design — it knows
 * nothing about sampling policy. Deciding it here keeps that module pure and
 * keeps the policy next to the two prompts it applies to. One wrapper per
 * stage, so the counter can never leak between them.
 */
function coolOnRepair(invoke: PlannerInvoker): PlannerInvoker {
  let calls = 0;
  return (schema, name, prompt, temperature) =>
    invoke(schema, name, prompt, calls++ === 0 ? temperature : REPAIR_TEMPERATURE);
}

/**
 * The no-LLM knowledge request: ZERO gaps.
 *
 * An empty `gaps` array is a legal, meaningful answer — "I already know
 * enough" — and the driver responds to it by skipping the knowledge run
 * entirely. That is exactly the right stub behavior: `--stub` exists to prove
 * the graph compiles, the waves schedule and the merges land, and it keeps a
 * stub epoch at ONE run, as it has always been. A stub cannot answer a
 * question anyway (the stub backend writes no files), so materializing gaps
 * would only buy an empty fan-out.
 */
export function stubKnowledgeRequest(goal: string): KnowledgeRequest {
  return {
    restatedGoal: goal.replace(/\s+/g, ' ').trim().slice(0, 600) || 'stub goal',
    gaps: [],
    planningNotes: 'Stub backend: no knowledge was requested and none was gathered.',
  };
}

/**
 * The no-LLM plan. ONE front, deliberately: a stub run exists to prove the
 * graph compiles, the waves schedule and the merges land — not to exercise
 * fan-out width.
 */
export function stubPlan(goal: string, epoch: number): DevPlan {
  const { epochGoal, doneWhen } = stubPlanFronts(goal);
  return {
    epochGoal,
    doneWhen,
    goalComplete: false,
    fronts: [
      {
        id: 'stub-front',
        title: 'Stub front',
        rationale: 'Deterministic single front used by the stub backend.',
        dependsOnFronts: [],
        reconPrompt: `Stub epoch ${epoch}: list at most one task spec describing the goal.`,
        workPrompt: 'Stub: read your spec and record what you would have changed.',
        verifyCondition: 'The epoch blackboard exists under `.huu/dev/`.',
        maxTasks: 1,
      },
    ],
  };
}

/**
 * STAGE ONE — ask for knowledge.
 *
 * Returns a value that already satisfies `KnowledgeRequestSchema`. Turning
 * questions into gap spec files, a memory index and a fan-out is huu's job, in
 * TypeScript — this call cannot describe a graph, a path or a step, because
 * the schema it is bound to carries none of those fields.
 *
 * @throws when the model cannot produce a schema-valid request even after one
 * guided repair; the message carries BOTH issue lists.
 */
export async function planKnowledge(opts: PlanKnowledgeOptions): Promise<KnowledgeRequest> {
  if (shouldStub(opts)) return stubKnowledgeRequest(opts.goal);

  const invoke = coolOnRepair(buildInvoker(opts));
  const prompt = buildKnowledgePrompt({
    goal: opts.goal,
    epoch: opts.epoch,
    knowledgeSummary: opts.knowledgeSummary,
    history: opts.history,
    previousEvidence: opts.previousEvidence,
    maxGaps: opts.maxGaps,
  });

  const { value } = await invokeWithRepair({
    invoke,
    schema: KnowledgeRequestSchema,
    name: 'DevKnowledgeRequest',
    prompt,
    temperature: PLANNER_TEMPERATURE,
    fixPrompt: (rejectedJson, issues) =>
      buildRepairPrompt({ what: 'knowledge request', rejectedJson, issues }),
  });

  return {
    restatedGoal: value.restatedGoal,
    gaps: value.gaps,
    ...(value.planningNotes !== undefined ? { planningNotes: value.planningNotes } : {}),
  };
}

/**
 * STAGE TWO — plan one epoch, against the briefings stage one bought.
 *
 * Returns a value that already satisfies `DevPlanSchema`; structural repair of
 * the plan (front ordering, caps, duplicate ids) is `compileEpochPipeline`'s
 * job.
 *
 * @throws when the model cannot produce a schema-valid plan even after one
 * guided repair — the driver turns that into a clean session abort rather than
 * running an invented epoch.
 */
export async function planEpoch(opts: PlanEpochOptions): Promise<DevPlan> {
  if (shouldStub(opts)) return stubPlan(opts.goal, opts.epoch);

  const invoke = coolOnRepair(buildInvoker(opts));
  const prompt = buildPlannerPrompt({
    goal: opts.goal,
    epoch: opts.epoch,
    briefPack: opts.briefPack,
    accumulatedPack: opts.accumulatedPack,
    knowledgeSummary: opts.knowledgeSummary,
    history: opts.history,
    previousEvidence: opts.previousEvidence,
    previousReport: opts.previousReport,
    planningNotes: opts.planningNotes,
    methodology: opts.methodology,
    maxFronts: Math.min(opts.maxFronts, DEV_MAX_FRONTS),
  });

  const { value: draft } = await invokeWithRepair({
    invoke,
    schema: DevPlanSchema,
    name: 'DevEpochPlan',
    prompt,
    temperature: PLANNER_TEMPERATURE,
    fixPrompt: (rejectedJson, issues) => buildRepairPrompt({ what: 'plan', rejectedJson, issues }),
  });

  return {
    epochGoal: draft.epochGoal,
    doneWhen: draft.doneWhen,
    goalComplete: draft.goalComplete,
    fronts: draft.fronts.map((f) => ({
      id: f.id,
      title: f.title,
      rationale: f.rationale,
      dependsOnFronts: f.dependsOnFronts,
      reconPrompt: f.reconPrompt,
      workPrompt: f.workPrompt,
      verifyCondition: f.verifyCondition,
      maxTasks: f.maxTasks,
    })),
  };
}
