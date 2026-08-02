import type { AppConfig, CheckStep } from '../lib/types.js';
import type { AgentFactory, AgentEvent } from './types.js';
import { substituteRuns } from '../lib/pipeline-io.js';
import { log as dlog } from '../lib/debug-logger.js';
import type { KeyPoolHandle } from '../lib/api-key-pool.js';
import { classifyProviderError } from '../lib/provider-error.js';

const CHECK_AGENT_ID = 9998;

export interface CheckEvaluationContext {
  step: CheckStep;
  /** 1-based iteration counter — substituted into the condition as `$runs`. */
  runs: number;
  repoRoot: string;
  integrationWorktreePath: string;
  integrationBranch: string;
  /**
   * Commit the run started from (repo HEAD at preflight). Surfaced to the
   * judge so a condition can diff `git diff --name-only <baseCommit>..HEAD`
   * to see exactly what THIS run changed — the stage merges are already
   * committed by the time the judge runs, so a bare `git status` is clean.
   * Optional (older callers / test fixtures may omit it).
   */
  baseCommit?: string;
  runId: string;
  config: AppConfig;
  factory: AgentFactory;
  /**
   * Fired 'spawn' right before the judge agent is created and 'exit' after it
   * is disposed — symmetric even when the factory throws. Lets the
   * orchestrator count the reserved judge (9998) in the global RAM budget
   * while it lives; a heavyweight LLM agent must not be invisible to
   * admission/concurrency math.
   */
  onReservedLifecycle?: (ev: 'spawn' | 'exit', agentId: number) => void;
  /** Forwarded so the orchestrator can render judge logs. */
  onEvent: (agentId: number, event: AgentEvent) => void;
  /**
   * Multi-key pool for the run. When present the judge takes its key from
   * `current()` and gets exactly ONE rotation retry (see
   * {@link evaluateCheckStep}). Absent ⇒ `config.apiKey` is used and the whole
   * path is byte-identical to before this option existed.
   */
  keyPool?: KeyPoolHandle;
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
 * KEY ROTATION — exactly ONE retry. The judge has no retry loop of its own,
 * and every check's default outcome points FORWARD, so a judge that takes a
 * 429 approves in silence. That is the worst failure mode in the system: it
 * turns a transient provider blip into a step the pipeline believes was
 * validated. With `ctx.keyPool` set, a classifiable provider failure that
 * ROTATES the pool to a different usable key buys one more attempt — no more,
 * because a judge is not worth an unbounded retry budget and the default
 * outcome is still there as the backstop.
 *
 * The worktree is NEVER rewound — looping back to an earlier step just
 * re-runs that step on top of the current integration HEAD.
 */
export async function evaluateCheckStep(
  ctx: CheckEvaluationContext,
): Promise<CheckEvaluationResult> {
  // Substitute `$runs` (visit counter) AND `$baseCommit` (run base) so a
  // condition can inline a real diff base — e.g. `git diff --name-only
  // $baseCommit..HEAD`. Without this the literal `$baseCommit` reaches the
  // judge's shell as an UNSET variable and expands to nothing, turning the
  // diff into `..HEAD` (= `HEAD..HEAD`, empty) which would pass a freeze
  // guard vacuously. baseCommit is always set once a run reaches a check
  // (preflight aborts the run if HEAD can't be resolved).
  const resolvedCondition = substituteRuns(ctx.step.condition, ctx.runs).replaceAll(
    '$baseCommit',
    ctx.baseCommit ?? '',
  );
  const fallback = ctx.step.outcomes.find((o) => o.default) ?? ctx.step.outcomes[0]!;

  const fakeTask = {
    agentId: CHECK_AGENT_ID,
    files: [],
    branchName: ctx.integrationBranch,
    worktreePath: ctx.integrationWorktreePath,
    stageIndex: -1,
    stageName: `check:${ctx.step.name}`,
    // A judge gathers evidence and routes a step. It stands in the INTEGRATION
    // worktree, where an accidental edit would ride into the landing merge as
    // if an agent had authored it — so the tools that could do that are simply
    // withheld. `bash` stays: running the project's own build/test commands is
    // the whole point of a judge that "gathers EVIDENCE before answering".
    readOnly: true,
  };

  let collectedText: string[] = [];
  let judgeError: string | null = null;
  const onEvent = (event: AgentEvent): void => {
    ctx.onEvent(CHECK_AGENT_ID, event);
    if (event.type === 'log') {
      collectedText.push(event.message);
    } else if (event.type === 'stream' && event.channel === 'assistant') {
      // The judge emits its `{ "label", "reason" }` verdict in its ASSISTANT
      // ANSWER, which the pi backend surfaces as streamed `stream`/assistant
      // deltas — NOT as `log` events. Without capturing them here the verdict is
      // never seen and EVERY CheckStep silently falls back to its default
      // outcome. This stayed hidden because the stub backend (and the tests)
      // emit the verdict as a `log`; only the real pi backend streams it.
      collectedText.push(event.delta);
    } else if (event.type === 'error') {
      judgeError = event.message;
    }
  };

  const baseConfig = ctx.step.modelId
    ? { ...ctx.config, modelId: ctx.step.modelId }
    : ctx.config;

  const systemPrompt = buildCheckSystemPrompt(
    ctx.step,
    ctx.integrationBranch,
    ctx.integrationWorktreePath,
    ctx.baseCommit,
  );
  const userPrompt = buildCheckUserPrompt(ctx.step, resolvedCondition, ctx.runs);

  dlog('orch', 'check_eval_start', {
    stepName: ctx.step.name,
    runs: ctx.runs,
    labels: ctx.step.outcomes.map((o) => o.label),
  });

  // At most two passes, and the second only ever happens when the pool
  // actually rotated to a different usable key.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const attemptKey = ctx.keyPool?.current();
    const stepConfig = attemptKey ? { ...baseConfig, apiKey: attemptKey } : baseConfig;
    judgeError = null;
    collectedText = [];

    let agent: Awaited<ReturnType<AgentFactory>> | null = null;
    let announced = false;
    try {
      // Announce BEFORE the factory: the RAM the spawn is about to allocate must
      // already be charged. The local flag keeps spawn/exit symmetric even when
      // the factory itself throws.
      ctx.onReservedLifecycle?.('spawn', CHECK_AGENT_ID);
      announced = true;
      agent = await ctx.factory(fakeTask, stepConfig, systemPrompt, ctx.integrationWorktreePath, onEvent);
      await agent.prompt(`${systemPrompt}\n\n---\n\n${userPrompt}`);
      // SECOND verdict source (Bug B): the streamed deltas above are lossy —
      // pi 0.73.x surfaces the judge's answer as incremental `message_update`
      // deltas and real runs have shown them arriving incomplete or not at
      // all, so every check silently fell back to `approved (default)`. Once
      // the agent is DONE we read its FULL transcript — whatever it actually
      // produced — and feed it to the same parser. extractVerdict scans
      // back-to-front, so the transcript's final JSON wins over any partial
      // stream capture (and a duplicate is harmless). getTranscript must
      // never throw: on failure we keep exactly today's event-based capture.
      try {
        const transcript = await agent.getTranscript?.();
        if (transcript) {
          collectedText.push('\n<session-transcript>\n');
          collectedText.push(transcript);
          collectedText.push('\n</session-transcript>');
        }
      } catch {
        /* event-based capture remains */
      }
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
      if (announced) ctx.onReservedLifecycle?.('exit', CHECK_AGENT_ID);
    }

    if (!judgeError || attempt === 2 || !ctx.keyPool || !attemptKey) break;
    // `auth` is deliberately NOT reported from here: burning a key is
    // permanent and `classifyProviderError` is a string heuristic, so the burn
    // is double-gated behind a live probe — which lives on the worker path
    // (`Orchestrator.reportKeyFailure`). A judge gets a rotation only for the
    // self-healing kinds. In practice the workers of the same run have already
    // burned a truly-dead key, so `current()` here is the rotated one anyway.
    const kind = classifyProviderError(judgeError);
    if (kind !== 'rate_limit' && kind !== 'quota') break;
    if (!ctx.keyPool.report(kind, attemptKey)) break;
    dlog('orch', 'check_eval_key_rotated', { stepName: ctx.step.name, kind });
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

function buildCheckSystemPrompt(
  step: CheckStep,
  branch: string,
  worktree: string,
  baseCommit?: string,
): string {
  const baseLine = baseCommit
    ? `\n- Run base commit (repo HEAD before this run): \`${baseCommit}\`. The stage merges are already committed, so a bare \`git status\` is clean — to see exactly what THIS run changed, diff against the base: \`git diff --name-only ${baseCommit}..HEAD\` (or \`git diff --stat ${baseCommit}..HEAD\`).`
    : '';
  return `# Judge Agent — ${step.name}

## Your Role
You are a decision agent in a multi-step pipeline. Your ONLY job is to evaluate
the condition below and pick exactly one outcome label from the allowed list.

You may use the shell freely (run tests, read files, inspect coverage reports,
git logs, anything) to gather the evidence you need.

## Git Context
- Integration branch: \`${branch}\`
- Worktree: \`${worktree}\`${baseLine}
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
