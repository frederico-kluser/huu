// One guided repair round around a structured-output LLM call.
//
// Today a `ZodError` costs the whole dev session: `planner.ts` ends its invoker
// with `schema.parse(result)`, and the driver turns the throw into
// `planner-failed`. That is the wrong trade for a model that got 90% of a plan
// right and mislabeled one field — and `assistant-architect.ts:248-274` already
// established the fix in this repo: when mechanical validation fails, hand the
// model back its OWN rejected output plus the exact errors, and ask once more.
// This module is that round, extracted so the planner and the knowledge request
// share one implementation instead of two drifting copies.
//
// ONE extra call, deliberately. A second repair mostly buys a more expensive
// wrong answer: if the model could not satisfy the schema with the errors in
// front of it, the problem is the request, not the sampling. So the second
// failure THROWS — carrying BOTH issue lists, because a `planner-failed` that
// only reports the last attempt hides which field the model never understood.
//
// Note the invoker's return type: `unknown`, NOT `T`. The repair prompt needs
// the value the schema REJECTED, so validation has to happen HERE, after the
// call — an invoker that parses internally has already thrown the evidence away.
//
// Keep this file pure (no fs / no env / no network) — the caller owns the LLM.

import type { z } from 'zod';

/** One structured LLM call, unparsed. Same argument order as `PlannerInvoker`. */
export type StructuredInvoker = (
  schema: unknown,
  name: string,
  prompt: string,
  temperature: number,
) => Promise<unknown>;

export interface RepairResult<T> {
  value: T;
  /** True when the first response failed validation and the second one passed. */
  repaired: boolean;
  /** The FIRST attempt's issues, kept when `repaired` — what the model got wrong. */
  issues?: string;
}

export interface InvokeWithRepairOptions<T> {
  invoke: StructuredInvoker;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Structured-output tool name. The repair call reuses it: same question, more information. */
  name: string;
  prompt: string;
  temperature: number;
  /** Builds the repair prompt from the rejected value and the formatted issues. */
  fixPrompt: (rawJson: string, issues: string) => string;
}

/**
 * `path.to.field: message; other: message` — the same rendering
 * `plan-to-pipeline.ts` uses for a compiled pipeline that fails `PipelineSchema`.
 * One format everywhere means a log line reads the same wherever it came from.
 */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

/**
 * Render the rejected value for the repair prompt. Never throws: a model that
 * returned `undefined`, or an object the SDK made circular, is exactly the case
 * this round exists to recover from — losing it to a `TypeError` inside the
 * recovery path would be the worst possible failure mode.
 */
function safeJson(value: unknown): string {
  try {
    // JSON.stringify(undefined) is undefined, not a string.
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Invoke, validate, and on failure repair exactly once.
 *
 * Errors raised by `invoke` itself (network, provider, abort) propagate
 * untouched — those belong to the caller's retry/rotation domain, not to schema
 * repair, and a transport failure carries no rejected value to reason about.
 *
 * @throws when the response fails validation twice; the message carries both
 * issue lists so the failure is diagnosable from a log alone.
 */
export async function invokeWithRepair<T>(args: InvokeWithRepairOptions<T>): Promise<RepairResult<T>> {
  const first = await args.invoke(args.schema, args.name, args.prompt, args.temperature);
  const parsed = args.schema.safeParse(first);
  if (parsed.success) return { value: parsed.data, repaired: false };

  const issues = formatZodIssues(parsed.error);
  const second = await args.invoke(
    args.schema,
    args.name,
    args.fixPrompt(safeJson(first), issues),
    args.temperature,
  );
  const repairedParse = args.schema.safeParse(second);
  if (repairedParse.success) return { value: repairedParse.data, repaired: true, issues };

  throw new Error(
    `${args.name}: structured output failed validation twice — ` +
      `first attempt: ${issues} — ` +
      `after one guided repair: ${formatZodIssues(repairedParse.error)}`,
  );
}
