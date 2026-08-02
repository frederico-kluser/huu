// The contract the dev-mode planner LLM must satisfy.
//
// Deliberately NOT the pipeline schema: the planner reasons about FRONTS
// (parallel workstreams) and what each front must discover, do and prove —
// not about step arrays, `dependsOn` edges or memory-file paths. Compiling a
// plan into a runnable `Pipeline` is `plan-to-pipeline.ts`'s job, and keeping
// that translation mechanical is what stops a weak planner from emitting an
// invalid graph.
//
// Keep this file pure (no fs / no env) — it is imported by the CLI, the web
// server and the compiler alike.

import { z } from 'zod';
import { DEV_DEFAULT_MAX_TASKS, DEV_MAX_FRONTS } from '../types.js';

/** Front ids name blackboard directories, so they must be path-safe. */
export const FRONT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const DevFrontSchema = z.object({
  id: z
    .string()
    .regex(FRONT_ID_PATTERN, 'front id must be kebab-case (3-40 chars, a-z0-9-)'),
  title: z.string().min(1).max(60),
  rationale: z.string().min(1).max(400),
  /** Ids of other fronts in THIS epoch that must land first. Usually empty. */
  dependsOnFronts: z.array(z.string()).max(DEV_MAX_FRONTS).default([]),
  reconPrompt: z.string().min(1).max(4000),
  workPrompt: z.string().min(1).max(6000),
  verifyCondition: z.string().min(1).max(1200),
  maxTasks: z.number().int().min(1).max(40).default(DEV_DEFAULT_MAX_TASKS),
});

export const DevPlanSchema = z.object({
  epochGoal: z.string().min(1).max(400),
  doneWhen: z.string().min(1).max(600),
  /**
   * The planner's escape hatch: when the goal is already satisfied it says so
   * and emits zero fronts, instead of inventing filler work. The driver stops
   * the session on this verdict.
   */
  goalComplete: z.boolean().default(false),
  fronts: z.array(DevFrontSchema).max(DEV_MAX_FRONTS).default([]),
});

export type DevPlanDraft = z.infer<typeof DevPlanSchema>;
