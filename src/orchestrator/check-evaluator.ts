import type { AppConfig, CheckStep } from '../lib/types.js';
import type { AgentFactory, AgentEvent } from './types.js';
import { substituteRuns } from '../lib/pipeline-io.js';
import { log as dlog } from '../lib/debug-logger.js';

const CHECK_AGENT_ID = 9998;

export interface CheckEvaluationContext {
  step: CheckStep;
  /** 1-based iteration counter — substituted into the condition as `$runs`. */
  runs: number;
  repoRoot: string;
  integrationWorktreePath: string;
  integrationBranch: string;
  runId: string;
  config: AppConfig;
  factory: AgentFactory;
  /** Forwarded so the orchestrator can render judge logs. */
  onEvent: (agentId: number, event: AgentEvent) => void;
}

export interface CheckEvaluationResult {
  /** The chosen outcome's label. */
  label: string;
  /** The next step to visit (already resolved against `step.outcomes`). */
  nextStepName: string;
  /** True when the verdict came from the LLM; false when we fell back to default. */
  fromJudge: boolean;
  /** Free-text reason from the judge, if any. */
  reason?: string;
  /** Condition string after `$runs` substitution. */
  resolvedCondition: string;
}

/**
 * Spawns an LLM judge in the integration worktree and asks it to pick one of
 * the declared outcome labels for `step`. The judge has full shell access (via
 * the underlying agent SDK) — it may run tests, read files, grep coverage
 * reports, anything to reach a verdict.
 *
 * The judge MUST emit a final JSON block matching:
 *   { "label": "<one of step.outcomes[].label>", "reason": "..." }
 *
 * When parsing fails or the label doesn't match, we fall back to the outcome
 * marked `default: true`. If somehow no default exists (schema validation
 * should have prevented this), we throw.
 *
 * The worktree is NEVER rewound — looping back to an earlier step just
 * re-runs that step on top of the current integration HEAD.
 */
export async function evaluateCheckStep(
  ctx: CheckEvaluationContext,
): Promise<CheckEvaluationResult> {
  const resolvedCondition = substituteRuns(ctx.step.condition, ctx.runs);
  const fallback = ctx.step.outcomes.find((o) => o.default) ?? ctx.step.outcomes[0]!;

  const fakeTask = {
    agentId: CHECK_AGENT_ID,
    files: [],
    branchName: ctx.integrationBranch,
    worktreePath: ctx.integrationWorktreePath,
    stageIndex: -1,
    stageName: `check:${ctx.step.name}`,
  };

  const collectedText: string[] = [];
  let judgeError: string | null = null;
  const onEvent = (event: AgentEvent): void => {
    ctx.onEvent(CHECK_AGENT_ID, event);
    if (event.type === 'log') {
      collectedText.push(event.message);
    } else if (event.type === 'error') {
      judgeError = event.message;
    }
  };

  const stepConfig = ctx.step.modelId
    ? { ...ctx.config, modelId: ctx.step.modelId }
    : ctx.config;

  const systemPrompt = buildCheckSystemPrompt(ctx.step, ctx.integrationBranch, ctx.integrationWorktreePath);
  const userPrompt = buildCheckUserPrompt(ctx.step, resolvedCondition, ctx.runs);

  let agent: Awaited<ReturnType<AgentFactory>> | null = null;
  try {
    dlog('orch', 'check_eval_start', {
      stepName: ctx.step.name,
      runs: ctx.runs,
      labels: ctx.step.outcomes.map((o) => o.label),
    });
    agent = await ctx.factory(fakeTask, stepConfig, systemPrompt, ctx.integrationWorktreePath, onEvent);
    await agent.prompt(`${systemPrompt}\n\n---\n\n${userPrompt}`);
  } catch (err) {
    judgeError = err instanceof Error ? err.message : String(err);
  } finally {
    if (agent) {
      try {
        await agent.dispose();
      } catch {
        /* best-effort */
      }
    }
  }

  const verdict = judgeError ? null : extractVerdict(collectedText.join('\n'));
  if (verdict) {
    const matched = ctx.step.outcomes.find((o) => o.label === verdict.label);
    if (matched) {
      dlog('orch', 'check_eval_done', {
        stepName: ctx.step.name,
        label: matched.label,
        nextStepName: matched.nextStepName,
        fromJudge: true,
      });
      return {
        label: matched.label,
        nextStepName: matched.nextStepName,
        fromJudge: true,
        reason: verdict.reason,
        resolvedCondition,
      };
    }
  }

  dlog('orch', 'check_eval_fallback', {
    stepName: ctx.step.name,
    judgeError,
    fallbackLabel: fallback.label,
  });
  return {
    label: fallback.label,
    nextStepName: fallback.nextStepName,
    fromJudge: false,
    reason: judgeError ?? 'judge produced no parseable verdict; using default outcome',
    resolvedCondition,
  };
}

function buildCheckSystemPrompt(step: CheckStep, branch: string, worktree: string): string {
  return `# Judge Agent — ${step.name}

## Your Role
You are a decision agent in a multi-step pipeline. Your ONLY job is to evaluate
the condition below and pick exactly one outcome label from the allowed list.

You may use the shell freely (run tests, read files, inspect coverage reports,
git logs, anything) to gather the evidence you need.

## Git Context
- Integration branch: \`${branch}\`
- Worktree: \`${worktree}\`
- DO NOT modify code, commit, or push. The orchestrator handles git operations.
- DO NOT run \`git push\` under any circumstances.

## Output Contract
After your investigation, your FINAL message MUST contain a single JSON
code block on its own — no prose around it inside the block — with this exact
shape:

\`\`\`json
{ "label": "<one-of-allowed-labels>", "reason": "<short explanation>" }
\`\`\`

If you cannot reach a confident verdict, choose the outcome the pipeline
declares as default and explain why in \`reason\`.`;
}

function buildCheckUserPrompt(step: CheckStep, resolvedCondition: string, runs: number): string {
  const lines: string[] = [];
  lines.push('<condition>');
  lines.push(resolvedCondition);
  lines.push('</condition>');
  lines.push('');
  lines.push(`<runs>${runs}</runs>`);
  lines.push('');
  lines.push('<allowed-labels>');
  for (const o of step.outcomes) {
    const flags = o.default ? ' (default)' : '';
    lines.push(`- ${o.label}${flags}`);
  }
  lines.push('</allowed-labels>');
  if (step.instructionDraft) {
    lines.push('');
    lines.push('<setup-time-hint>');
    lines.push(step.instructionDraft);
    lines.push('</setup-time-hint>');
  }
  lines.push('');
  lines.push('<output>');
  lines.push('Investigate, then emit the final JSON block as specified.');
  lines.push('</output>');
  return lines.join('\n');
}

interface ParsedVerdict {
  label: string;
  reason?: string;
}

/**
 * Pull the LAST `{...}` JSON object from a text blob and try to parse it as
 * `{label, reason}`. We scan back-to-front because the agent typically
 * narrates first and emits the verdict at the end.
 *
 * Tolerates the JSON being inside a fenced code block (```json ... ```) or
 * inline in prose.
 */
export function extractVerdict(text: string): ParsedVerdict | null {
  if (!text) return null;
  const candidates: string[] = [];

  const fenceRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(text)) !== null) {
    candidates.push(m[1]!.trim());
  }

  // Also scan for raw {...} blocks containing "label". This catches the
  // case where the judge skipped the fence.
  const braceMatches = text.match(/\{[^{}]*"label"[^{}]*\}/g) ?? [];
  for (const b of braceMatches) candidates.push(b);

  for (let i = candidates.length - 1; i >= 0; i--) {
    const raw = candidates[i]!;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.label === 'string') {
        return {
          label: parsed.label,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        };
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}
