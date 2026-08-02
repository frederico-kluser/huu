/**
 * Pipeline / step types.
 *
 * Re-exported from the `lib/types` barrel so existing callers that import
 * `../lib/types.js` keep type-checking. New code may import directly from
 * `../lib/types/pipeline.js`.
 */

/**
 * How a step decomposes into agent tasks.
 *
 * - `project`  — exactly one whole-project task. The Files selection is locked
 *                to "whole project" and the editor cannot change it.
 * - `per-file` — one task per selected file. Files MUST be picked; the editor
 *                disallows the whole-project shortcut.
 * - `flexible` — user picks at edit time (whole-project or N files). This is
 *                the legacy behavior. `undefined` is treated as `flexible`.
 * - `memory`   — one task per file listed in a huu-memory-v1 JSON written by
 *                an EARLIER step (`filesFrom`, read from the integration
 *                worktree when the cursor reaches this step). The pipeline —
 *                not the user — decides the file set at run time. A missing
 *                memory file resolves to zero tasks (the stage completes
 *                empty, loudly); a corrupt one fails the run.
 */
export type StepScope = 'project' | 'per-file' | 'flexible' | 'memory';

/**
 * Width cap for `memory`-scope fan-outs when the step doesn't set
 * `maxFiles`. Node-execution accounting counts step VISITS (not per-file
 * tasks), so the real bound here is cost/pool width, not the node cap.
 */
export const DEFAULT_MEMORY_MAX_FILES = 40;

/**
 * Soft length cap for a per-file `hint` in a huu-memory-v1 file. An LLM
 * producer that writes a longer hint is NOT punished: the resolver TRUNCATES
 * the hint to this length and emits a warning. A cosmetic, optional field
 * must never be able to abort a run — hence a clamp, not a schema rejection.
 */
export const DEFAULT_MEMORY_HINT_MAX_CHARS = 600;

// --- Per-task review (the generator → critic loop) ---
//
// A `CheckStep` judges a STAGE, in the integration worktree, AFTER the agent
// branches merged. `WorkStep.review` judges ONE TASK, in the worker's own
// worktree, BEFORE its branch is eligible for the merge — the only window
// where the agent's session is still alive and its worktree still exists
// (`finalizeAgent` disposes the agent and then REMOVES the worktree, so
// anything that wants to send work back to the same agent must run before it).
//
// Why this is a schema field and not a private detail of `spawnAndRun`: a
// merge gate whose criterion is a prompt has to be declarable, validatable,
// testable in isolation and reusable by any pipeline. Hiding it inside the
// orchestrator would make it none of those.

/**
 * How much a finding blocks. Convergence is MECHANICAL and reads only this
 * field: the loop repeats while any finding's severity is listed in
 * {@link ReviewSpec.blockOn}. The critic's own `verdict` string is logged and
 * displayed but never decides — a talkative model that writes "approved" over
 * a blocker is still sent back, and one that writes "changes-requested" over
 * three nits is not. Same fixed-enum mechanical-judge discipline the check
 * evaluator already uses, and the only formulation a fluent model can't talk
 * its way around.
 */
export type ReviewSeverity = 'blocker' | 'major' | 'minor' | 'nit';

/**
 * The three lenses a critic is asked for: does the diff match the project's
 * code style, does it follow the project's design patterns, is the code
 * correct. The enum is closed on purpose — an open-ended reviewer inventing
 * its own axes is how a correct implementation gets rejected.
 */
export type ReviewCategory = 'style' | 'pattern' | 'correctness';

export interface ReviewFinding {
  id: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  /**
   * Repo-relative path. A finding with no `file` (or an unknown
   * severity/category) is DROPPED at parse time with a warning: an
   * unlocatable claim can't be acted on, so it must never gate a merge.
   */
  file: string;
  line?: number;
  /** One line. */
  summary: string;
  /**
   * The citation or the named convention that proves the finding. Kept short
   * (≤ ~15 lines by prompt contract) — the recommended critic model caps at
   * 16k output tokens, and a verbose reviewer truncates mid-verdict.
   */
  evidence: string;
  /** What to change. */
  fix: string;
  /**
   * Mechanical proof, when it exists: the command the critic actually RAN and
   * that failed. It does NOT decide blocking — that is severity, a choice made
   * deliberately — but it is recorded, surfaced and counted in
   * {@link AgentStatus.reviewStats}, because proved-vs-unproved blocking is
   * the only number that lets this project revisit that choice later with its
   * OWN data instead of literature measured on another kind of workload.
   */
  proof?: { command: string; exitCode: number; excerpt: string };
}

/**
 * Acceptance gate run BEFORE an agent spawns. A shell command executed in the
 * agent's worktree (or integration worktree, if {@link cwd} is `'integration'`).
 * When the exit code does not match {@link expectExit} (default 0), the agent
 * is NOT spawned and the task fails immediately — this is a hard pre-condition,
 * not a soft check.
 */
export interface AcceptSpec {
  command: string;
  expectExit?: number;
  cwd?: 'worktree' | 'integration';
}

/**
 * Per-task review contract attached to a {@link WorkStep}. Only `prompt` is
 * required — every other field falls back to the DEFAULT_REVIEW_* constants,
 * so a step that sets nothing else still gets the whole policy.
 *
 * Absent `review`, a work step behaves exactly as it always has: the field is
 * additive and the no-review path stays byte-identical.
 */
export interface ReviewSpec {
  /**
   * The critic's briefing. Authored by the PIPELINE, never by a planner — the
   * same boundary that keeps dev mode's planner from emitting step graphs.
   */
  prompt: string;
  /**
   * Cap on review rounds; round 1 always runs. Hitting the cap with blocking
   * findings still open WAIVES them (the work merges, the findings are
   * recorded) — failing the card instead would exclude it from the stage
   * merge and throw away everything the agent did. Defaults to
   * {@link DEFAULT_REVIEW_MAX_ROUNDS}.
   */
  maxRounds?: number;
  /**
   * Severities that hold the merge. Defaults to
   * {@link DEFAULT_REVIEW_BLOCK_ON}. Deliberately a severity list and not a
   * proof requirement: start here, then re-decide from `reviewStats`.
   */
  blockOn?: ReviewSeverity[];
  /**
   * Critic model. Cross-family from the worker on purpose — a model reviewing
   * its own family's output is the design's most fragile assumption, so the
   * dev-mode preset points this at a different vendor than the worker.
   * Falls back to `AppConfig.modelId` when undefined, like every other
   * `modelId` in this file.
   */
  modelId?: string;
  /** Per-round wall clock for the critic. Defaults to {@link DEFAULT_REVIEW_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Hard cap on findings per round, severity-descending. Defaults to
   * {@link DEFAULT_REVIEW_MAX_FINDINGS}. Two jobs: it fits the critic's output
   * ceiling, and it removes the incentive to manufacture volume.
   */
  maxFindings?: number;
  /**
   * Commands the critic MUST run — and paste the output of — BEFORE writing a
   * single finding. This is the project's real gate (`npm run typecheck &&
   * npm test`, or whatever was detected). Running first and opining second is
   * what keeps the loop anchored to something executable instead of to an
   * unverified opinion.
   */
  verifyCommands?: string[];
  /**
   * Where per-task finding shards are written (one file per task, never a
   * shared file) — the same anti-conflict sharding the dev-mode findings
   * protocol already uses.
   */
  findingsDir?: string;
  /**
   * What happens when the round cap is reached with blocking findings still
   * open. Default `'waive'` — today's behavior: the findings are recorded and
   * the branch merges anyway (failing the card would throw the work away).
   * `'hold'` — the card is parked as a RETRIABLE failure carrying the open
   * findings, so the run's interactive-retry hold (`awaiting_retry` +
   * `retryTask`) surfaces it for a human: retry re-runs the task (reviewed
   * again), abandoning applies the `'waive'` semantics to the preserved
   * branch. Runs without an interactive channel wired
   * (`OrchestratorOptions.interactiveRetry` unset — headless, `run-many`,
   * smoke tests) ALWAYS fall back to `'waive'`, so this field can never
   * deadlock a headless run.
   */
  onBlocked?: 'waive' | 'hold';
}

/** Review rounds when {@link ReviewSpec.maxRounds} is unset. Round 1 always runs. */
export const DEFAULT_REVIEW_MAX_ROUNDS = 2;

/** Severities that hold a merge when {@link ReviewSpec.blockOn} is unset. */
export const DEFAULT_REVIEW_BLOCK_ON: ReviewSeverity[] = ['blocker', 'major'];

/** Per-round critic wall clock when {@link ReviewSpec.timeoutMs} is unset. */
export const DEFAULT_REVIEW_TIMEOUT_MS = 10 * 60_000;

/** Findings per round when {@link ReviewSpec.maxFindings} is unset. */
export const DEFAULT_REVIEW_MAX_FINDINGS = 10;

/**
 * Work step — agents that actually modify the worktree.
 *
 * `type` is optional only for back-compat with pipelines saved before v0.4
 * (huu-pipeline-v1). The schema layer injects `type='work'` on parse for
 * any step missing it, but new code should always set it explicitly.
 *
 * `next` overrides the default "next index in the array" advancement.
 * It must reference another step's `name`. When omitted, the orchestrator
 * falls through to `steps[currentIndex + 1]` (or terminates if at the end).
 */
export interface WorkStep {
  type?: 'work';
  name: string;
  prompt: string;
  /** Files targeted by this step (relative to repo root). Empty = whole-project (single free run). */
  files: string[];
  /** Optional per-step model override. Falls back to AppConfig.modelId when undefined. */
  modelId?: string;
  /** See StepScope. Undefined = `flexible` (back-compat with v0.3.x pipelines). */
  scope?: StepScope;
  /**
   * `memory` scope only: repo-relative path of the huu-memory-v1 JSON an
   * earlier step writes (e.g. `.huu/knowledge/study-list.json`). Read from
   * the integration worktree at stage start, so check-loop rewrites are
   * picked up. Required when scope === 'memory'; invalid otherwise.
   */
  filesFrom?: string;
  /**
   * `memory` scope only: cap on how many listed files become tasks
   * (priority desc, then list order; excess is dropped with a warning).
   * Defaults to {@link DEFAULT_MEMORY_MAX_FILES}.
   */
  maxFiles?: number;
  /**
   * Path of the huu-memory-v1 file this step PROMISES to write for a later
   * `memory`-scope step. When set, huu appends a deterministic MEMORY
   * CONTRACT block (exact path + format + cap + hint rule) to this step's
   * prompt at run time — the pipeline author never writes that boilerplate.
   * Optional: a producer prompt may also write the file manually.
   */
  produces?: string;
  /**
   * Globs declaring the filesystem surface this step's agents are ALLOWED
   * to write. Checked at TWO moments:
   * (a) STATIC — two steps in the same wave whose write-sets intersect
   *     FAIL validation (guaranteed disjoint before the run starts);
   * (b) RUNTIME — before the stage merge, the orchestrator builds a
   *     `Map<path, agentId[]>` from each agent's `filesModified` and
   *     flags every path with ≥2 writers. The violation is logged and
   *     recorded in {@link AgentStatus.writeSetViolations}; it does NOT
   *     block the merge (purely instrumentation today, like the existing
   *     per-agent `parseOwnedPaths` metric).
   */
  writes?: string[];
  /**
   * REPORT-ONLY step. The agent audits, judges or reports; it must not change
   * code. Enforced at the HARNESS layer, not in prose: the backend hands the
   * session a tool allowlist with no `edit` and no `write`, and the system
   * header states the constraint instead of inviting edits.
   *
   * Undefined ⇒ today's behavior exactly (the full coding tool set). Use it on
   * steps whose prompt already says "report, never fix" — an audit that writes
   * its findings to a file needs `write` and must NOT set this.
   */
  readOnly?: boolean;
  /** Override the next step. Must match another step's `name`. Undefined = next in array. */
  next?: string;
  /**
   * DAG edges (GitHub-Actions `needs` style). Steps whose dependencies are
   * all done run together in deterministic WAVES (one shared pool, merges
   * in array order). Undefined = depends on the previous step in the array
   * (full v2 back-compat); `[]` = root. May only reference EARLIER steps;
   * loops stay exclusive to `next`/check outcomes (activation edges). The
   * presence of ANY dependsOn switches the run into wave mode.
   */
  dependsOn?: string[];
  /**
   * Per-task generator → critic loop. When set, each of this step's tasks is
   * audited in its OWN worktree before its branch is eligible for the stage
   * merge; blocking findings go back to the SAME agent to fix. Undefined =
   * today's behavior, unchanged. See {@link ReviewSpec}.
   */
  review?: ReviewSpec;
  /**
   * Acceptance gate run BEFORE an agent spawns. Undefined = no gate (today's
   * behavior, unchanged). See {@link AcceptSpec}.
   */
  accept?: AcceptSpec;
}

/**
 * Check step — pure LLM-evaluated decision node. Does NOT modify the worktree
 * (no commits, no agent branches). Spawns a judge agent in the integration
 * worktree, gives it shell access, and expects it to produce a JSON verdict
 * matching one of the declared `outcomes`.
 *
 * `condition` is natural language; the judge LLM may run any commands needed
 * to evaluate it. The token `$runs` is substituted with the current iteration
 * counter (1-based) before sending — lets the user write conditions like
 * "if coverage < 60% AND $runs < 3".
 *
 * Exactly one outcome must have `default: true`; that outcome is used when
 * the judge returns an unknown label or fails to parse.
 */
export interface CheckStep {
  type: 'check';
  name: string;
  condition: string;
  /** Generated at setup-time by `assistant-check-feasibility`; advisory. */
  instructionDraft?: string;
  outcomes: CheckOutcome[];
  /** Hard cap on visits per run. Defaults to {@link DEFAULT_CHECK_MAX_RUNS}. */
  maxRuns?: number;
  /** Optional per-step model override for the judge. */
  modelId?: string;
  /** See WorkStep.dependsOn — checks join branches too (judged AFTER all deps merged). */
  dependsOn?: string[];
}

export interface CheckOutcome {
  label: string;
  nextStepName: string;
  default?: boolean;
}

/**
 * Discriminated union of pipeline node types. Any code that iterates
 * `Pipeline.steps` must narrow on `step.type` (treating an absent `type`
 * as `'work'` for back-compat).
 */
export type PipelineStep = WorkStep | CheckStep;

/**
 * Legacy alias retained so external callers (and the >100 internal call
 * sites that pre-date the union) keep type-checking. New code should use
 * `WorkStep` or `PipelineStep`.
 */
export type PromptStep = WorkStep;

export function isCheckStep(step: PipelineStep): step is CheckStep {
  return step.type === 'check';
}

export function isWorkStep(step: PipelineStep): step is WorkStep {
  return step.type === undefined || step.type === 'work';
}

export const DEFAULT_CHECK_MAX_RUNS = 5;
/**
 * Hard cap on total node executions per run. Even if the user forgets
 * `$runs` in conditions and `maxRuns` per check step, this prevents a
 * runaway loop from melting the worktree base.
 */
export const DEFAULT_MAX_NODE_EXECUTIONS = 50;

export interface Pipeline {
  name: string;
  /**
   * One-line, human-facing summary of what this pipeline does and the
   * methodology behind it. Surfaced at launch — under the name in the TUI
   * welcome list and on the web pipeline cards — so the user knows what
   * they're about to run before picking it. Optional for back-compat with
   * pipeline files written before this field existed.
   */
  description?: string;
  steps: PipelineStep[];
  /**
   * Marker for the bundled default test pipeline (see
   * `src/lib/default-pipelines/huu-test-suite.ts`). When true, the Welcome
   * screen surfaces this pipeline as the prominent "▶ default" entry.
   * Purely advisory — the orchestrator ignores it.
   */
  _default?: boolean;
  /**
   * Per-card timeout (ms) for whole-project cards (files.length === 0) and
   * multi-file cards. Default 600_000 = 10min.
   * NOTE: this is applied PER CARD, not to the pipeline as a whole. There is
   * no timeout for the entire pipeline run.
   */
  cardTimeoutMs?: number;
  /**
   * Per-card timeout (ms) for single-file cards (files.length === 1).
   * Default 300_000 = 5min. Same per-card semantics as `cardTimeoutMs`.
   */
  singleFileCardTimeoutMs?: number;
  /** Number of retries on timeout/failure before final fail. Default 1. */
  maxRetries?: number;
  /**
   * Hard cap on total node executions in one run (work + check). Default
   * {@link DEFAULT_MAX_NODE_EXECUTIONS}. Last-resort safety net for
   * pathological loop graphs; per-check `maxRuns` is the primary control.
   */
  maxNodeExecutions?: number;
  /**
   * Per-agent port allocation. Each agent worktree gets a contiguous window of
   * TCP ports so parallel runs of `npm run dev`, dev servers, ad-hoc DBs, etc.
   * never collide on bind(). Disabled-by-default would be silent action at a
   * distance — leaving it on by default and letting users opt out.
   */
  portAllocation?: PortAllocationConfig;
  /**
   * Optional model override for the merge/integration agent (the conflict
   * resolver that runs in the integration worktree between stages). Same
   * spirit as `WorkStep.modelId`: falls back to `AppConfig.modelId` when
   * undefined.
   */
  integrationModelId?: string;
  /**
   * Optional shell command executed in the integration worktree after every
   * successful agent-branch merge. Exit code != 0 ⇒ the merge commit is
   * rolled back with `git reset --hard HEAD~1` and the branch is marked
   * `mergeFailed`. The ONE huu-issued merge commit that may legitimately be
   * rewound — it was never pushed, and the agent's own branch stays intact.
   */
  mergeGate?: string;
}

export interface PortAllocationConfig {
  /** First port in the allocation range. Default 55100. */
  basePort?: number;
  /** Ports per agent. Min/default 10 (http, db, ws + 7 extras). */
  windowSize?: number;
  /** Set false to skip env-file generation entirely. Default true. */
  enabled?: boolean;
}

export const DEFAULT_CARD_TIMEOUT_MS = 600_000;
export const DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_RETRIES = 1;
