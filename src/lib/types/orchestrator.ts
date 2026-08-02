/**
 * Orchestrator / agent runtime types.
 *
 * Re-exported from the `lib/types` barrel so existing callers that import
 * `../lib/types.js` keep type-checking. New code may import directly from
 * `../lib/types/orchestrator.js`.
 */

import type { ReviewFinding } from './pipeline.js';

// --- Agent Task & Status ---

export interface AgentTask {
  agentId: number;
  files: string[];
  branchName: string;
  worktreePath: string;
  stageIndex: number;
  stageName: string;
  /**
   * `memory` scope only: the hint the producing step attached to this
   * task's file in the huu-memory-v1 entry. Substituted into the step
   * prompt via the `$hint` token (empty string when absent).
   */
  hint?: string;
  /**
   * Repo-relative paths this task may WRITE, as its own spec declares them
   * under `## Files this task OWNS` (parsed by `parseOwnedPaths`). Resolved by
   * `prepareStageTasks` out of the INTEGRATION worktree, which is the only
   * place the spec exists before the agent's own worktree is created.
   *
   * Why it is not simply {@link AgentTask.files}: for a `memory`-scope task
   * `files` is `[<the spec path>]` — the CONTAINER of the assignment, not its
   * targets. A header that renders `files` as the write scope tells the agent
   * to edit its own briefing and to touch nothing else, which is the exact
   * opposite of the contract. Absent ⇒ the header falls back to `files`,
   * unchanged, so every non-memory pipeline reads as it always did.
   */
  ownedPaths?: string[];
  /**
   * The step's DECLARED writable surface (`WorkStep.writes`), forwarded so the
   * agent is actually told about it.
   *
   * It was declarable and validated (`validateTopology` fails two concurrent
   * steps with intersecting globs) and then checked post-hoc against what the
   * agent wrote — but never SHOWN to the agent, which is the one use that could
   * have prevented the violation instead of recording it.
   */
  writes?: string[];
  /**
   * REPORT-ONLY role: the agent audits, judges or reports and must not change
   * code. Set by the reserved critic/judge tasks and by any `WorkStep` that
   * declares `readOnly`. Two effects, both at the harness layer rather than in
   * prose: the system header states the constraint instead of inviting edits,
   * and the backend hands the session a tool allowlist with no `edit`/`write`.
   */
  readOnly?: boolean;
}

export type AgentLifecyclePhase =
  | 'pending'
  | 'worktree_creating'
  | 'worktree_ready'
  | 'session_starting'
  | 'streaming'
  | 'tool_running'
  /**
   * The per-task critic is auditing this agent's diff (see
   * {@link ReviewSpec}). The agent itself is idle but its worktree, branch and
   * session are all alive and must stay that way — the card is deliberately
   * NOT preemptible while in this phase.
   */
  | 'reviewing'
  /**
   * The agent is fixing the blocking findings the critic just returned — the
   * same session, the same worktree, one more turn. Between `reviewing` and
   * `fixing` the card can bounce several times before it converges or the
   * round cap waives what's left.
   */
  | 'fixing'
  | 'finalizing'
  | 'validating'
  | 'committing'
  | 'pushing'
  | 'cleaning_up'
  | 'done'
  | 'no_changes'
  | 'error'
  /**
   * Fase 2.3: the memory guard PAUSED this agent (preserved its worktree +
   * session, freed its RAM) instead of killing it. A parked, non-active state
   * (the task waits in the queue and resumes when headroom returns). Rendered
   * in the kanban's TODO column (it is literally re-queued) as an amber
   * `PAUSED` card with a `⏸N` badge.
   */
  | 'paused'
  /**
   * @deprecated No longer produced — guard-killed agents reset to 'pending'
   * (see AgentStatus.requeues). Kept so old manifests still parse.
   */
  | 'killed_by_autoscaler';

export type PushStatus = 'pending' | 'pushing' | 'pushed' | 'skipped' | 'failed';

export interface AgentStatus {
  agentId: number;
  state: 'idle' | 'streaming' | 'tool_running' | 'done' | 'error';
  phase: AgentLifecyclePhase;
  currentFile: string | null;
  logs: string[];
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  filesModified: string[];
  branchName?: string;
  worktreePath?: string;
  commitSha?: string;
  pushStatus: PushStatus;
  error?: string;
  errorKind?: 'timeout' | 'failed';
  attempt?: number;
  stageIndex: number;
  stageName: string;
  startedAt?: number;
  finishedAt?: number;
  createdAt?: number;
  /**
   * Times the memory guard killed this agent's task and requeued it back to
   * the TODO column. Work restarts from zero on the next spawn.
   */
  requeues?: number;
  /**
   * Times the USER manually retried this task from an `error` card (via
   * `Orchestrator.retryTask`, available while the run is `awaiting_retry`).
   * Distinct from `requeues` (automatic memory-guard kills) and `attempt`
   * (the in-stage auto-retry counter). Accumulates across retries.
   */
  manualRetries?: number;
  /**
   * Fase 2.3: times the memory guard PAUSED this agent's task (checkpoint +
   * resume) rather than killing it. Distinct from `requeues` (kills, work
   * discarded): a pause preserves the worktree + transcript, so the resumed
   * attempt continues instead of restarting. Accumulates across pauses; drives
   * the kanban `⏸N` badge.
   */
  pauses?: number;
  /** Epoch ms of the most recent pause (set by pauseAgent; cleared on resume). */
  pausedAt?: number;
  /**
   * Merge truth for the kanban's "done means MERGED" contract — a tri-state:
   *   undefined — legacy manifest / not yet finalized → renders as plain DONE
   *               (backward compat: old runs never wrote the flag);
   *   false     — the agent finished and committed, but its branch has NOT
   *               been merged into the integration worktree yet → renders as
   *               a blue READY card in the DOING column;
   *   true      — the branch landed in the integration worktree → green DONE.
   * Only new code ever writes `false` (finalizeAgent) — never derive UI off
   * `merged !== true`, that would break legacy rendering.
   */
  merged?: boolean;
  /** Epoch ms when this agent's branch merged into the integration worktree. */
  mergedAt?: number;
  /**
   * Stage integration failed (or the run ended) with this agent's branch left
   * unmerged (`branchesPending`) — the commit exists on the agent branch but
   * never landed. Renders as an amber UNMERGED card in the DONE column so
   * orphaned work stops looking green.
   */
  mergeFailed?: boolean;
  /**
   * Per-action occurrence counts, keyed by a short action name
   * (`stream`, `tool`, `file`, `log`, `usage`, `done`, `error`). Bumped once
   * per AgentEvent in `handleAgentEvent`; drives the kanban "actions" label.
   * Accumulates across guard requeues like tokens/logs (never reset).
   */
  actionCounts?: Record<string, number>;
  /** Most recent action name (last key bumped in {@link actionCounts}). */
  lastAction?: string;
  /**
   * The commit this agent's worktree was created from (the stage base ref).
   * Captured per agent at worktree creation instead of read from the live
   * stage cursor, so the critic's `git diff <baseRef>..HEAD` — and the
   * "did this branch actually produce anything" check in finalize — stay
   * correct regardless of where the wave scheduler has moved on to.
   */
  baseRef?: string;
  /** Critic rounds this task went through. 0/undefined = review never ran. */
  reviewRounds?: number;
  /** Every finding the critic produced, across all rounds (blocking or not). */
  reviewFindings?: ReviewFinding[];
  /**
   * The round cap was reached with blocking findings still open, so they were
   * WAIVED and the branch merged anyway. Loud in the UI and carried into the
   * epoch evidence — never silent.
   */
  reviewWaived?: boolean;
  /**
   * The review loop hit the round cap with blocking findings open and the
   * step's `ReviewSpec.onBlocked` is `'hold'`: the card was parked as a
   * RETRIABLE failure (state `error`) so the run's end-of-walk
   * `awaiting_retry` hold surfaces it for a human. The reviewed branch is
   * preserved under a `-held` suffix; a user retry re-runs the task fresh,
   * and abandoning the hold merges the preserved branch with the findings
   * waived (`reviewWaived`). Only ever set when
   * `OrchestratorOptions.interactiveRetry` is on — otherwise the loop waives.
   */
  reviewHeld?: boolean;
  /** Proved-vs-unproved blocking counters — see {@link ReviewStats}. */
  reviewStats?: ReviewStats;
  /**
   * Files this agent committed that its task spec did NOT declare as owned.
   * Pure instrumentation for the open question this architecture rests on —
   * "is partitioning by prompt enough, or does it need mechanism?" — which
   * nobody appears to have published a number for. Recorded, surfaced in the
   * epoch evidence, and enforced by nothing.
   */
  writeSetViolations?: string[];
  /**
   * How many times this card's context has been COMPACTED by the backend.
   *
   * The first one triggers a re-statement of the write scope into the same
   * session (compaction is documented to lose exactly the turn-one
   * instructions); the third stops the card, because a context that refills as
   * fast as it is compacted is not progressing. Absent until the first event —
   * a card that never compacted carries no field, so nothing changes for the
   * runs and manifests that never see one.
   */
  compactions?: number;
  /**
   * @deprecated No longer produced — the memory guard now resets the card to
   * `pending` (see `requeues`). Kept so old manifests/run-logs still parse.
   */
  killedByAutoScaler?: boolean;
}

/**
 * Blocking findings that triggered a fix round, split by whether the critic
 * backed them with an executed command ({@link ReviewFinding.proof}) or not.
 *
 * This exists to answer one question with this project's own data: is blocking
 * by severity alone buying real fixes, or paying for rework on unproved
 * opinions? If `unprovedBlocking` dominates, switching to proof-gated blocking
 * is a one-line change to `blockOn`.
 */
export interface ReviewStats {
  /** Blocking findings that carried a `proof` and triggered a fix round. */
  provedBlocking: number;
  /** Blocking findings with NO mechanical proof that triggered a fix round. */
  unprovedBlocking: number;
}

// --- Run & Git (manifest types co-located with their main consumer) ---

/** Ordered trace entry for one node visit during execution. */
export interface ExecutionTraceEntry {
  /** 1-based visit order. */
  visitIndex: number;
  stepName: string;
  stepType: 'work' | 'check';
  /** 1-based per-step iteration counter at the time of visit (= `$runs`). */
  runs: number;
  startedAt: number;
  finishedAt?: number;
  /** For check steps: the chosen outcome label. */
  outcomeLabel?: string;
  /** For check steps: the resolved next step name. */
  nextStepName?: string;
  /** Integration HEAD after this node finished (work steps only). */
  commitAfter?: string;
  /** For check steps: the natural-language condition with $runs substituted. */
  resolvedCondition?: string;
}

export type RunStatus = 'preflight' | 'running' | 'integrating' | 'done' | 'error';

export interface AgentManifestEntry {
  agentId: number;
  branchName: string;
  worktreePath: string;
  files: string[];
  status: AgentLifecyclePhase;
  commitSha?: string;
  pushStatus: PushStatus;
  cleanupDone: boolean;
  noChanges: boolean;
  error?: string;
  errorKind?: 'timeout' | 'failed';
  attempt?: number;
  stageIndex?: number;
  stageName?: string;
  /** Mirror of {@link AgentStatus.merged} — post-run manifests stay truthful. */
  merged?: boolean;
  /** Mirror of {@link AgentStatus.mergeFailed}. */
  mergeFailed?: boolean;
}

export interface RunManifest {
  runId: string;
  baseBranch: string;
  baseCommit: string;
  integrationBranch: string;
  integrationWorktreePath: string;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  /**
   * ACTIONABLE failure summary (first fatal error wins): what broke + what
   * to do next. Surfaced by the summary screen, the headless final JSON and
   * the web result frame. Undefined on success.
   */
  errorReason?: string;
  agentEntries: AgentManifestEntry[];
  stageBaseCommits?: string[];
  totalStages?: number;
  /**
   * Ordered trace of nodes visited during execution. Replaces the
   * implicit "stage N of totalStages" model when the pipeline contains
   * loops or skips. Always populated (even for linear pipelines) so the
   * dashboard / run-log have a single source of truth.
   */
  executionTrace?: ExecutionTraceEntry[];
  /** Per-stage-visit merge history (mirrors `OrchestratorState.stageIntegrations`). */
  stageIntegrations?: StageIntegration[];
  /** Per-check-visit judge history (mirrors `OrchestratorState.checkRuns`). */
  checkRuns?: CheckRun[];
}

// --- Orchestrator state ---

export interface AutoScaleStatus {
  /** True while the scaler drives the concurrency target (mode === 'auto'). */
  enabled: boolean;
  /**
   * 'auto' adapts concurrency to real memory headroom; 'manual' keeps the
   * user-pinned concurrency but the memory guard (kill newest at the destroy
   * threshold, requeue to TODO) stays active. 'greedy' floods one agent per
   * queued task and lets the same guard be the sole backstop (shown as MAX).
   */
  mode: 'auto' | 'manual' | 'greedy';
  state: 'NORMAL' | 'SCALING_UP' | 'BACKING_OFF' | 'COOLDOWN' | 'DESTROYING';
  cooldownRemainingMs: number;
  cpuPercent: number;
  ramPercent: number;
  /** EMA-observed per-agent memory footprint, in MiB (pessimistic seed 1536). */
  observedAgentMemoryMb: number;
  /** Memory still claimable before the limit, in MiB (cgroup/MemAvailable-aware). */
  ramAvailableMb: number;
  /** Agents killed by the memory guard so far in this run. */
  guardKillCount: number;
  /**
   * Closed-loop PSI controller (Fase 2.2): the current PSI-driven concurrency
   * limit, and the controller setpoint (target `some avg10` %). Absent when the
   * scaler predates the controller (e.g. the simulation engine).
   */
  controlledLimit?: number;
  targetPsi?: number;
  /**
   * Host-availability clamp telemetry: the smoothed host MemAvailable in MiB
   * (null when /proc/meminfo is unreadable — macOS) and whether the HOST side
   * is currently the binding admission limit (huu yielding to other host
   * processes the container cgroup cannot see). Absent on scalers that predate
   * the clamp (simulation engine, old manifests).
   */
  hostAvailableMb?: number | null;
  hostClampActive?: boolean;
}

export interface OrchestratorState {
  /**
   * `awaiting_retry` is a HELD-OPEN terminal-ish state: the step walk finished
   * but left one or more task cards in `error`, and an interactive front-end
   * (web / single-run TUI) asked the run to stay open so the user can retry
   * individual failed tasks (see `Orchestrator.retryTask` / `finish`). The
   * integration worktree is still alive in this state. Headless drivers never
   * enter it — the run resolves straight to `done`/`error`.
   */
  status: 'idle' | 'starting' | 'running' | 'integrating' | 'awaiting_retry' | 'done' | 'error';
  runId: string;
  agents: AgentStatus[];
  logs: LogEntry[];
  totalCost: number;
  completedTasks: number;
  totalTasks: number;
  integrationStatus: IntegrationStatus;
  /** Per-stage-visit merge history — drives the kanban merge cards. */
  stageIntegrations: StageIntegration[];
  /** Per-check-visit judge history — drives the kanban judge cards. */
  checkRuns: CheckRun[];
  startedAt: number;
  elapsedMs: number;
  concurrency: number;
  currentStage: number;
  /** Wave counter — present only when the pipeline runs in DAG (dependsOn) mode. */
  wave?: number;
  totalStages: number;
  pendingTaskCount: number;
  activeAgentCount: number;
  /**
   * Live RESERVED agents — the CheckStep judge (9998) and the integration
   * conflict resolver (9999). Real heavyweight LLM agents counted in the
   * global RAM budget, but never listed in `agents` as pool cards. Optional:
   * legacy manifests omit it.
   */
  reservedAgentCount?: number;
  /**
   * Files claimed as OWNED by more than one task spec, detected BEFORE the
   * fan-out that would collide over them (`collideDeclaredOwnership`).
   *
   * Declared-vs-declared, so it is knowable while it still means something —
   * unlike `AgentStatus.writeSetViolations`, which is actual-vs-declared and
   * only exists once the writes already happened. Reported, never blocked:
   * a driver folds it into its own evidence (dev mode hands it to the next
   * planner). Omitted when there are none.
   */
  declaredWriteCollisions?: Array<{ path: string; specs: string[] }>;
  autoScale?: AutoScaleStatus;
}

export interface IntegrationStatus {
  phase: 'pending' | 'merging' | 'conflict_resolving' | 'done' | 'error';
  branchesMerged: string[];
  branchesPending: string[];
  conflicts: IntegrationConflict[];
  finalCommitSha?: string;
}

export interface IntegrationConflict {
  file: string;
  branches: string[];
  resolved: boolean;
}

export type StageIntegrationPhase =
  | 'pending'
  | 'merging'
  | 'conflict_resolving'
  | 'done'
  | 'error'
  | 'skipped';

/**
 * Per-stage-visit merge record. One entry is created for every WorkStep
 * visit (loops create fresh entries) so the dashboards can render the merge
 * as a kanban card flowing TODO → DOING → DONE instead of the UI appearing
 * frozen while `OrchestratorState.status === 'integrating'`. Unlike
 * `IntegrationStatus` (which is cumulative across the whole run), entries
 * here are scoped to a single stage merge.
 */
export interface StageIntegration {
  /** visitIndex of the WorkStep visit this merge follows — unique even with loops. */
  visitIndex: number;
  /** Index of the work step in `pipeline.steps` (for editor/model lookups). */
  stepIndex: number;
  stageName: string;
  /** 1-based per-step iteration counter at this visit (= `$runs`). */
  runs: number;
  phase: StageIntegrationPhase;
  /** Effective integration model: `pipeline.integrationModelId ?? config.modelId`. */
  modelId: string;
  /** True once the LLM conflict resolver was actually spawned. */
  resolverUsed: boolean;
  branchesMerged: string[];
  branchesPending: string[];
  conflicts: IntegrationConflict[];
  lastLog?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type CheckRunPhase = 'judging' | 'done' | 'error';

/**
 * Per-CheckStep-visit judge record. One entry is created for every check
 * visit (loops create fresh entries) so the dashboards can render the judge
 * as a kanban card — DOING while it deliberates, DONE with the chosen
 * outcome label — instead of the check being visible only in the logs.
 */
export interface CheckRun {
  /** visitIndex of the CheckStep visit — unique even with loops. */
  visitIndex: number;
  /** Index of the check step in `pipeline.steps`. */
  stepIndex: number;
  stepName: string;
  /** 1-based per-step iteration counter at this visit (= `$runs`). */
  runs: number;
  maxRuns?: number;
  phase: CheckRunPhase;
  /** Effective judge model: `step.modelId ?? config.modelId`. */
  modelId: string;
  /** Condition after `$runs` substitution (as the judge saw it). */
  condition: string;
  outcomeLabel?: string;
  nextStepName?: string;
  /** True when the verdict came from the LLM; false = default outcome (judge failed / maxRuns). */
  fromJudge?: boolean;
  /** Free-text reason from the judge, if any. */
  reason?: string;
  lastLog?: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface LogEntry {
  timestamp: number;
  agentId: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  phase?: AgentLifecyclePhase;
  message: string;
  modelId?: string;
  context?: Record<string, unknown>;
  /** Run id (manifest.runId). Lets log aggregation pivot across runs. */
  runId?: string;
  /** 1-based stage number when known, undefined for orchestrator-level events. */
  stageIndex?: number;
  /** Stage name from the pipeline definition. */
  stageName?: string;
  /** Logical source of the entry — which subsystem produced it. */
  kind?: 'orchestrator' | 'integrator' | 'worker' | 'system';
}

export interface OrchestratorResult {
  runId: string;
  agents: AgentStatus[];
  logs: LogEntry[];
  totalCost: number;
  filesModified: string[];
  conflicts: ConflictInfo[];
  duration: number;
  manifest: RunManifest;
  integration: IntegrationStatus;
}

export interface ConflictInfo {
  file: string;
  agents: number[];
}
