import type {
  AgentStatus,
  AgentTask,
  AppConfig,
  CheckStep,
  ExecutionTraceEntry,
  IntegrationStatus,
  LogEntry,
  OrchestratorResult,
  OrchestratorState,
  Pipeline,
  PipelineStep,
  PreflightResult,
  PromptStep,
  RunManifest,
  StageIntegration,
  CheckRun,
  AgentManifestEntry,
  AgentLifecyclePhase,
  WorkStep,
  ReviewFinding,
  ReviewSpec,
  ReviewStats,
} from '../lib/types.js';
import {
  DEFAULT_CARD_TIMEOUT_MS,
  DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_NODE_EXECUTIONS,
  DEFAULT_REVIEW_MAX_ROUNDS,
  DEFAULT_REVIEW_TIMEOUT_MS,
  isCheckStep,
  isWorkStep,
} from '../lib/types.js';
import { runPreflight } from '../git/preflight.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { agentBranchName, agentWorktreePath } from '../git/branch-namer.js';
import { mergeAgentBranches } from '../git/integration-merge.js';
import { decomposeTasks } from './task-decomposer.js';
import { resolveMemoryFiles, MemoryFileError } from './memory-files.js';
import { memoryContract, memoryCapForPath } from '../lib/memory-contract.js';
import { hasDagEdges, computeWave, descendantsOf } from './wave-scheduler.js';
import { validateTopology } from '../lib/pipeline-io.js';
import { TimeoutError, withTimeout } from '../lib/with-timeout.js';
import type {
  AgentEvent,
  AgentFactory,
  AgentOutputChunk,
  AgentOutputSubscriber,
  SpawnedAgent,
} from './types.js';
import { StreamLineBuffer } from './stream-line-buffer.js';
import { THINKING_LOG_PREFIX } from './types.js';
import { generateRunId } from '../lib/run-id.js';
import { RunLogger, RUN_LOG_DIR } from '../lib/run-logger.js';
import { runStageIntegrationWithResolver } from './integration-agent.js';
import { evaluateCheckStep } from './check-evaluator.js';
import { runAcceptGate } from './accept-gate.js';
import {
  MAX_CARD_COMPACTIONS,
  checkWriteSetViolations,
  collideDeclaredOwnership,
  compactionReminder,
  formatDeclaredCollisions,
  type DeclaredOwnershipCollision,
} from './write-sets.js';
import {
  buildFixMessage,
  parseOwnedPaths,
  reviewAgentId,
  runReviewRound,
  writeSetViolations,
} from './review-agent.js';
import { availableTaskSlots } from './task-slots.js';
import { PortAllocator } from './port-allocator.js';
import {
  AGENT_BIN_DIR,
  AGENT_ENV_FILE,
  writeAgentBinShim,
  writeAgentEnvFile,
} from './agent-env.js';
import { ensureNativeShim, type NativeShim } from './native-shim.js';
import { AutoScaler, MATURE_AGE_MS } from './auto-scaler.js';
import { PressureLadder } from './pressure-ladder.js';
import type { GlobalScheduler, RunDriverHandle } from './global-scheduler.js';
import { getSystemMetrics } from '../lib/resource-monitor.js';
import { resolveRamPercent } from '../lib/budget.js';
import { noKernelCeilingWarning } from '../lib/ram-doctor.js';
import {
  DEFAULT_PAUSE_BACKOFF_CAP_MS,
  parsePauseBackoffBaseMs,
  pauseBackoffRemainingMs,
} from './pause-backoff.js';
import { resolveRamTuning } from '../lib/ram-tuning.js';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute } from 'node:path';
import { log, scopedDebugLog } from '../lib/debug-logger.js';
import { attachProcessLogSink } from '../lib/process-log-bridge.js';
import type { KeyPoolHandle } from '../lib/api-key-pool.js';
import { classifyProviderError } from '../lib/provider-error.js';
import type { OrchCtx } from './context.js';
import { destroyAgent as gp_destroyAgent, pauseAgent as gp_pauseAgent, executeTaskPool as gp_executeTaskPool, spawnAndRun as gp_spawnAndRun, getDemand as gp_getDemand, activeAgentAges as gp_activeAgentAges, abandonReview as gp_abandonReview, spawnStats as gp_spawnStats, trackReservedAgent as gp_trackReservedAgent, announceAgentExit as gp_announceAgentExit, consumePreemptMarker as gp_consumePreemptMarker } from './guard-pause.js';
import { runReviewLoop as rl_runReviewLoop, handleReviewEvent as rl_handleReviewEvent, persistReviewFindings as rl_persistReviewFindings } from './review-loop.js';
import { runDagWaves as wd_runDagWaves } from './wave-driver.js';
import { commitAgentWork as fn_commitAgentWork, branchAhead as fn_branchAhead, branchChangedFiles as fn_branchChangedFiles, recordWriteSetViolations as fn_recordWriteSetViolations, finalizeAgent as fn_finalizeAgent } from './finalize.js';

function ensureGitignored(repoRoot: string, line: string): void {
  const gitignorePath = join(repoRoot, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, line + '\n', 'utf8');
    return;
  }
  const existing = readFileSync(gitignorePath, 'utf8');
  const normalizedLines = existing.split(/\r?\n/).map((l) => l.trim());
  if (normalizedLines.includes(line.trim())) return;
  // `dir/*` covers `dir/` for our purposes — pipelines that need to commit
  // a subtree (e.g. `.huu/knowledge/`) rewrite `.huu/` to `.huu/*` plus a
  // `!.huu/<subtree>/` negation. Re-appending `.huu/` here would kill the
  // negation (git can't re-include below an excluded directory).
  if (line.trim().endsWith('/') && normalizedLines.includes(`${line.trim()}*`)) return;
  const sep = existing.endsWith('\n') ? '' : '\n';
  appendFileSync(gitignorePath, sep + line + '\n', 'utf8');
}

/**
 * Agent worktrees check out the COMMITTED .gitignore, so the host-side
 * `ensureGitignored` additions never reach them. In repos that haven't
 * committed the huu entries, every parallel agent commits its own
 * `.env.huu`/`.huu-bin` (different ports → different content) and the
 * stage merge hits a guaranteed add/add conflict. `info/exclude` lives in
 * the COMMON git dir and applies to every worktree without touching the
 * user's tracked files — the right home for these runtime-only paths.
 */
function ensureWorktreeExcluded(repoRoot: string, lines: string[]): void {
  try {
    const rel = execFileSync(
      'git',
      ['-C', repoRoot, 'rev-parse', '--git-path', 'info/exclude'],
      { encoding: 'utf8' },
    ).trim();
    const excludePath = isAbsolute(rel) ? rel : join(repoRoot, rel);
    mkdirSync(dirname(excludePath), { recursive: true });
    const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
    const missing = lines.filter((l) => !have.has(l));
    if (missing.length === 0) return;
    const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    writeFileSync(excludePath, existing + sep + missing.join('\n') + '\n', 'utf8');
  } catch {
    // Best effort — a failure here only degrades to the old behavior.
  }
}

export type OrchestratorSubscriber = (state: OrchestratorState) => void;

const DEFAULT_CONCURRENCY = 10;
const MAX_INSTANCES = 20;
/**
 * Offset for the synthetic `visitIndex` of a USER-retry merge card. Real stage
 * visitIndexes are bounded by `maxNodeExecutions` (≤ 50), so starting retry
 * merges at 1e6 guarantees they never collide with stage-walk merge cards.
 */
const RETRY_MERGE_VISIT_BASE = 1_000_000;
const AUTO_SCALE_MAX_INSTANCES = 200;
const MIN_INSTANCES = 1;
import { POLL_INTERVAL_MS, PRESSURE_POLL_INTERVAL_MS, computeCardTimeoutMs, unionPaths } from './orch-consts.js';

export interface OrchestratorOptions {
  initialConcurrency?: number;
  /**
   * If true, the run continues past a stage that produced unresolved merge
   * conflicts; the conflicted branches are left for manual resolution. If
   * false (default), the run aborts.
   */
  continueOnConflict?: boolean;
  /**
   * Optional AgentFactory used to spawn the integration agent that resolves
   * merge conflicts via LLM. When omitted, the orchestrator falls back to the
   * deterministic `mergeAgentBranches` and treats any conflict as failure.
   *
   * Pass the same factory used for regular agents (typically `realAgentFactory`).
   * Stub agents cannot resolve conflicts — pass `undefined` to disable.
   */
  conflictResolverFactory?: AgentFactory;
  /**
   * Memory-aware dynamic concurrency. Default TRUE: the orchestrator
   * adapts the worker pool size to real memory headroom. Pass false to
   * pin concurrency at `initialConcurrency` — the memory guard (kill the
   * newest agent at the destroy threshold and requeue its task) stays
   * active in both modes.
   */
  autoScale?: boolean;
  /**
   * RAM budget as a percent of total memory — the admission ceiling for this
   * run's AutoScaler. Machine-global dial; in multi-run the GlobalScheduler owns
   * the budget instead (this run's AutoScaler is dormant). Omitted → the
   * `HUU_RAM_PERCENT`/default fallback in `src/lib/budget.ts`.
   *
   * FRONT-ENDS must pass `effectiveRamPercent()` (`src/lib/web-settings.ts`) so
   * the PERSISTED dial is honored; resolving the store down here instead would
   * make every run's budget depend on ambient home-dir state, which is not
   * something a test (or a caller with an explicit value) can control.
   */
  budgetPercent?: number;
  /**
   * When set, this run is SUBORDINATE to a GlobalScheduler (multi-run
   * scheduling): the scheduler owns the concurrency target (`grantFor`) and the
   * cross-run memory-guard kill (lowest-priority newest first), and this run's
   * own AutoScaler stays dormant (display-only). Omit for the normal single-run
   * path — every code path below then behaves exactly as before.
   */
  scheduler?: GlobalScheduler;
  /**
   * Multi-run only: this run's AUTHORITATIVE priority among the runs sharing the
   * scheduler (lower = higher priority). Set from the caller's list order (web
   * queue index / TUI selection index / run-many spec index) so the first
   * project in the list is always served first, regardless of the racy order in
   * which concurrently-started runs reach `scheduler.register()`. Omit → the
   * scheduler falls back to registration order.
   */
  priority?: number;
  /**
   * Externally-assigned run id. When set, start() uses it instead of generating
   * one — letting a multi-run manager key its Map<runId, …> and return the id
   * to the browser BEFORE start() resolves (so concurrent runs never collide on
   * an empty-string key). Omit for the normal self-assigned path.
   */
  runId?: string;
  /**
   * Interactive front-ends (web, single-run TUI) set this true so that when
   * the step walk ends with one or more task cards still in `error`, the run
   * is HELD OPEN in `status: 'awaiting_retry'` instead of tearing down — the
   * integration worktree stays alive so the user can {@link Orchestrator.retryTask}
   * individual failed tasks (a timed-out card can be retried with a longer
   * timeout) and then {@link Orchestrator.finish} the run. Omit (default false)
   * for headless drivers (run-many, smoke, simulation): start() then resolves
   * immediately on the existing path, byte-identical to before.
   */
  interactiveRetry?: boolean;
  /**
   * Optional tee for every activity-log entry this run appends (the same
   * stream the TUI LogArea / web run-log console render). The web run
   * manager uses it to mirror run activity to the serve terminal's stdout.
   * Called AFTER the entry is stored; a throwing sink is swallowed — an
   * external logger must never take the run down.
   */
  onLog?: (entry: LogEntry) => void;
  /**
   * Multi-key pool for this run (see `src/lib/api-key-pool.ts`). When present,
   * EVERY attempt reads its key from `current()` — the granularity the retry
   * loop makes reachable — and a classifiable provider failure reports the key
   * so the pool sidelines it and rotates.
   *
   * Omit for the single-key path: `AppConfig.apiKey` is used untouched and
   * every line below behaves exactly as it did before this option existed. A
   * handle seeded with a key the pool doesn't own is a SINGLETON by contract
   * (`createKeyPoolHandle`), so passing one is also safe — it just never
   * rotates.
   */
  keyPool?: KeyPoolHandle;
}


function actionName(event: AgentEvent): string {
  if (event.type === 'state_change') {
    return event.state === 'tool_running' ? 'tool' : 'stream';
  }
  if (event.type === 'file_write') return 'file';
  return event.type; // 'log' | 'usage' | 'compaction' | 'done' | 'error'
}

/**
 * Linear pipeline orchestrator. For each step:
 *   decompose into tasks → spawn workers (worker pool, +/- mutable) →
 *   wait for terminal state → finalize (commit + cleanup) → merge stage branches
 *   into integration → next step branches off updated integration HEAD.
 */
export class Orchestrator {
  private status: OrchestratorState['status'] = 'idle';
  private agents: Map<number, AgentStatus> = new Map();
  private activeAgents: Map<number, SpawnedAgent> = new Map();
  private spawningIds: Set<number> = new Set();
  private finalizingIds: Set<number> = new Set();
  /**
   * In-flight finalize promises tracked so start()'s finally block can
   * await them with a bounded timeout — preventing the run from being
   * declared "done" while git worktree removals or commits are still
   * happening, which previously left half-cleaned state on disk when
   * abort() raced with finalize.
   */
  private finalizingPromises: Set<Promise<unknown>> = new Set();
  /**
   * In-flight agent.dispose() promises kicked off by abort(). Same
   * rationale as finalizingPromises — abort() returns void (the UI calls
   * it fire-and-forget), so somebody has to wait for the underlying
   * subprocess teardown before the run resolves.
   */
  private disposingPromises: Set<Promise<unknown>> = new Set();
  private pendingTasks: AgentTask[] = [];
  private logs: LogEntry[] = [];
  private completedTasks = 0;
  private totalTasksAcrossStages = 0;
  private currentStage = 0;
  /** Wave counter — 0 in legacy (linear) mode, >0 while running DAG waves. */
  private currentWave = 0;
  private totalStages: number;
  private instanceCount: number;
  private continueOnConflict: boolean;
  private conflictResolverFactory?: AgentFactory;
  private startedAt = 0;
  private subscribers: Set<OrchestratorSubscriber> = new Set();
  /** Firehose consumers for raw, line-coalesced agent output (see subscribeAgentOutput). */
  private agentOutputSubscribers: Set<AgentOutputSubscriber> = new Set();
  /**
   * Per-agent, per-channel line coalescers for streamed deltas. Keyed by
   * agentId; created lazily on the first `stream` event and dropped when the
   * agent reaches a terminal state (so a requeued agentId starts clean).
   */
  private streamBuffers: Map<number, { assistant: StreamLineBuffer; thinking: StreamLineBuffer }> =
    new Map();
  private worktreeManager: WorktreeManager | null = null;
  private preflight: PreflightResult | null = null;
  private manifest: RunManifest | null = null;
  private runLogger: RunLogger | null = null;
  private integrationStatus: IntegrationStatus = {
    phase: 'pending',
    branchesMerged: [],
    branchesPending: [],
    conflicts: [],
  };
  private stageBaseRef = '';
  private nextAgentId = 1;
  private aborted = false;
  private poolWakeup: (() => void) | null = null;
  private portAllocator: PortAllocator;
  private nativeShim: NativeShim | null = null;
  private autoScaler: AutoScaler;
  /** Graded pressure verdicts for the single-run guard (see PressureLadder). */
  private readonly pressureLadder = new PressureLadder();
  private autoScaleDisabledByUser = false;
  /**
   * Set when this run is subordinate to a GlobalScheduler (multi-run). Null on
   * the normal single-run path, where the per-run AutoScaler drives the pool.
   */
  private scheduler: GlobalScheduler | null = null;
  /** Handle for unregistering from the scheduler in the finally block. */
  private schedulerHandle: RunDriverHandle | null = null;
  /** Authoritative multi-run priority (see OrchestratorOptions.priority). */
  private schedulerPriority?: number;
  /** Externally-assigned run id (multi-run manager); start() prefers it. */
  private externalRunId?: string;
  /**
   * Debug-log sink. Starts unscoped; rebound to `scopedDebugLog(runId)` in
   * start() once the runId exists, so concurrent runs' lines stay filterable by
   * runId in the single process-wide debug file (overlapping agentIds otherwise
   * make multi-run lines ambiguous).
   */
  private dlog: (cat: string, ev: string, data?: Record<string, unknown>) => void = log;
  /**
   * Agent ids whose in-flight attempt was killed by the memory guard.
   * Consumed (checked + deleted) by spawnAndRun's catch so the old
   * attempt's rejection skips retry accounting. A consumable Set — not a
   * status flag — because the pool can respawn the same task before the
   * old prompt() rejection's catch runs; a persistent flag would need to
   * be cleared at exactly the right moment (and a stale flag silently
   * swallowed genuine failures of requeued tasks).
   */
  private killedAgentIds: Set<number> = new Set();
  /**
   * Fase 2.3 pause: agent ids whose in-flight attempt was DISPOSED by
   * {@link pauseAgent} (a memory-guard preemption that PRESERVES the agent's
   * worktree + transcript instead of deleting them). Consumed (checked +
   * deleted) by spawnAndRun's prompt interception so the disposed attempt skips
   * retry/finalize accounting — the exact sibling of {@link killedAgentIds},
   * kept separate so a paused requeue (work preserved, `pauses++`) is never
   * conflated with a kill (work discarded, `requeues++`).
   */
  private pausedAgentIds: Set<number> = new Set();
  /**
   * Fase 2.3 resume: agentId → the checkpoint path of its paused agent session.
   * Read + consumed by spawnAndRun's FIRST attempt to (a) reuse the preserved
   * worktree (skip createAgentWorktree) and (b) reconstruct the session via
   * {@link AgentRuntimeContext.restoreSessionPath} so the resumed agent
   * continues without redoing completed tool calls. A one-shot per pause: a
   * failed resume falls back to a fresh attempt. Resume itself needs no
   * scheduler — the task sits in `pendingTasks` and the normal spawn-gating
   * (`shouldSpawn`: PSI + budget) admits it when headroom returns.
   *
   * DELIBERATELY in-memory only: persisting this map + the paused queue into
   * RunManifest (crash recovery of paused work) is ROADMAP §2.4 (durable
   * queue) — deferred. After a crash the orphaned `.huu-sessions/` dirs are
   * reclaimed by the existing worktree-manager cleanup/prune paths.
   */
  private restoreSessionPaths: Map<number, string> = new Map();
  /**
   * Live RESERVED agents — the CheckStep judge (9998) and the integration
   * conflict resolver (9999) — agentId → spawn time. They never enter
   * `activeAgents` (deliberate: never memory-guard victims), but they are real
   * heavyweight LLM agents, so they must be COUNTED: in {@link getDemand} /
   * {@link spawnStats} (the GlobalScheduler's budget stops under-counting
   * them — the hole that let admission stack new runs on top of invisible
   * judges) and in the pool's busy side (a demand-capped grant that includes
   * the judge must not read as a free task slot — see task-slots.ts). Serial
   * by construction within one run (checks are singleton waves; merges run
   * after the pool drains), so the busy-count term is insurance + spec.
   */
  private reservedAges: Map<number, number> = new Map();
  /**
   * True when the memory guard should PAUSE its victim (Fase 2.3) rather than
   * kill it. On by default; `HUU_NO_PAUSE=1` forces the legacy kill+requeue
   * (byte-identical to pre-2.3). pauseAgent itself still falls back to kill
   * whenever a checkpoint is impossible, so this only flips the DEFAULT
   * disposition, never removes the safety net.
   */
  private readonly pauseInsteadOfKill = process.env.HUU_NO_PAUSE !== '1';
  /**
   * Anti-churn backoff for paused-task resumes (see pause-backoff.ts):
   * `HUU_PAUSE_BACKOFF_MS` sets the first window (default 10 s, `0` disables);
   * the cap never sits below the base.
   */
  private readonly pauseBackoffBaseMs = parsePauseBackoffBaseMs(
    process.env.HUU_PAUSE_BACKOFF_MS,
  );
  private readonly pauseBackoffCapMs = Math.max(
    this.pauseBackoffBaseMs,
    DEFAULT_PAUSE_BACKOFF_CAP_MS,
  );
  /**
   * True when an interactive front-end asked us to hold the run open in
   * `awaiting_retry` after a step walk that left failed cards (see
   * OrchestratorOptions.interactiveRetry). False on every headless path.
   */
  private interactiveRetry = false;
  /**
   * External activity-log tee (OrchestratorOptions.onLog). Undefined on every
   * path that doesn't ask for one — the web run manager sets it to mirror
   * run activity to the serve terminal.
   */
  private onLogSink: ((entry: LogEntry) => void) | undefined;
  /**
   * Resolver of the promise `start()` parks on while `awaiting_retry`. Called
   * by {@link finish} (graceful) or {@link abort} (discard) to let start()
   * proceed to its terminal logic + integration teardown. Null when not held.
   */
  private finishResolve: (() => void) | null = null;
  /**
   * Every task that has passed through `spawnAndRun`, keyed by agentId — the
   * source of truth for reconstructing a task on a USER-triggered retry (the
   * card alone doesn't carry `files[]`/`hint`). Survives the stage that
   * created it, since retries happen after the walk.
   */
  private tasksById: Map<number, AgentTask> = new Map();
  /**
   * Per-agent timeout override (ms) for the NEXT run of that task, set by
   * {@link retryTask} when the user retries a timed-out card with a longer
   * limit. Consumed by spawnAndRun's `computeCardTimeoutMs` and cleared after.
   */
  private retryTimeoutOverrides: Map<number, number> = new Map();
  /**
   * Agent ids with a retry currently in flight — guards against re-entrant
   * retries (only one at a time; pendingTasks is single-slotted per pool).
   */
  private retryingIds: Set<number> = new Set();
  /**
   * Monotonic sequence for the synthetic `visitIndex` of retry merge cards.
   * Offset far above any real step visitIndex (bounded by maxNodeExecutions
   * ≤ 50) so retry merges never collide with stage-walk merge cards.
   */
  private retryMergeSeq = 0;
  /**
   * Per-step iteration counter (`$runs`). Incremented every time the
   * cursor visits a step. Lookup by `step.name`. Used by check
   * evaluation to substitute `$runs` and by the dashboard to render
   * "× N" badges on cards.
   */
  private runsByStep: Map<string, number> = new Map();
  /**
   * Ordered execution trace — one entry per visit. Persisted into the
   * run manifest and surfaced in the dashboard. Loops/skips show up as
   * repeated step names with monotonically increasing visitIndex/runs.
   */
  private executionTrace: ExecutionTraceEntry[] = [];
  /**
   * Detach handle for the process-log bridge (console.* + node warnings).
   * Set in start(), called in the finally block so we never leak the
   * sink across runs — each new run gets a fresh attach and re-drains
   * the same in-memory backlog (intentional: the user sees the same
   * pre-run warnings on every subsequent run within the session).
   */
  private processLogUnsubscribe: (() => void) | null = null;
  /**
   * Per-stage-visit merge history. One entry per WorkStep visit, created
   * in `pending` when the stage's agents start and advanced through
   * merging/conflict_resolving/done so the dashboards can render a merge
   * card instead of freezing during `status === 'integrating'`.
   */
  private stageIntegrations: StageIntegration[] = [];
  /**
   * Per-check-visit judge history. One entry per CheckStep visit, created
   * in `judging` when the evaluator starts and finished with the chosen
   * outcome — so the judge shows up as a kanban card like merges do.
   */
  private checkRuns: CheckRun[] = [];

  /**
   * Every DECLARED file ownership this run has resolved so far, keyed by spec
   * path. Accumulated across steps on purpose: the collisions that actually
   * cost something are the CROSS-STEP ones (two parallel fronts claiming the
   * same file), and a per-step check can only ever see one front.
   */
  private declaredOwnership: Map<string, string[]> = new Map();
  /** Collision paths already logged, so a later step does not re-report them. */
  private reportedCollisions: Set<string> = new Set();
  /**
   * The current declared-ownership collision set, surfaced on
   * {@link OrchestratorState} so a driver (dev mode) can fold it into the
   * epoch's evidence and hand it to the next planner. Instrumentation with a
   * consumer — never a gate.
   */
  private declaredWriteCollisions: DeclaredOwnershipCollision[] = [];

  /**
   * Task agents whose per-task CRITIC is currently reading their worktree
   * (see {@link ReviewSpec}). While an id is in here the agent is NOT
   * preemptible: `destroyAgent` would delete the very worktree the critic is
   * diffing, and `pauseAgent`'s marker would find no consumer because the
   * review loop is awaiting the CRITIC, not `agent.prompt()`.
   *
   * Honored in THREE places — `destroyAgent`/`pauseAgent` themselves (hard
   * no-op, which also covers a scheduler calling in from multi-run), the
   * in-pool guard's victim scan, and `activeAgentAges()` (the cross-run
   * `selectGlobalVictim`). Always added/removed in a `try/finally` so a lock
   * can never leak; the L3 escape valve ({@link abandonReview}) is the release
   * of last resort.
   */
  private reviewLockedIds: Set<number> = new Set();
  /**
   * Per-locked-agent cancel for the in-flight critic round, so
   * {@link abandonReview} can free the reserved slot immediately instead of
   * waiting out `review.timeoutMs`.
   */
  private reviewAborters: Map<number, AbortController> = new Map();
  /** See {@link OrchestratorOptions.keyPool}. Undefined ⇒ the single-key path. */
  private keyPool?: KeyPoolHandle;

  constructor(
    private config: AppConfig,
    private pipeline: Pipeline,
    private cwd: string,
    private agentFactory: AgentFactory,
    options: OrchestratorOptions = {},
  ) {
    this.totalStages = pipeline.steps.filter(isWorkStep).length;
    this.instanceCount = options.initialConcurrency ?? DEFAULT_CONCURRENCY;
    this.continueOnConflict = options.continueOnConflict ?? false;
    this.conflictResolverFactory = options.conflictResolverFactory;
    // Memory-aware concurrency is the default; autoScale: false pins the
    // pool at initialConcurrency but keeps the always-on memory guard.
    const autoMode = options.autoScale !== false;
    this.scheduler = options.scheduler ?? null;
    this.schedulerPriority = options.priority;
    this.externalRunId = options.runId;
    this.interactiveRetry = options.interactiveRetry ?? false;
    this.onLogSink = options.onLog;
    this.keyPool = options.keyPool;
    this.portAllocator = new PortAllocator({
      basePort: pipeline.portAllocation?.basePort,
      windowSize: pipeline.portAllocation?.windowSize,
      enabled: pipeline.portAllocation?.enabled ?? true,
      maxAgents: autoMode ? AUTO_SCALE_MAX_INSTANCES : MAX_INSTANCES,
      // Multi-run: share the scheduler's reservation set so two concurrent runs
      // never hand out the same physical port window.
      sharedReservedPorts: this.scheduler?.sharedReservedPorts,
    });
    this.autoScaler = new AutoScaler({
      resourceMonitor: getSystemMetrics,
      budgetPercent: resolveRamPercent(options.budgetPercent),
      // Evidence-based env knobs (HUU_AGENT_MEM_SEED_MB / _EMA_ALPHA); omitted
      // keys keep the scaler's own pessimistic OOM-safe defaults.
      ...resolveRamTuning(),
    });
    this.autoScaler.setMode(autoMode ? 'auto' : 'manual');
    this.autoScaleDisabledByUser = !autoMode;
  }

  subscribe(handler: OrchestratorSubscriber): () => void {
    this.subscribers.add(handler);
    handler(this.getState());
    return () => this.subscribers.delete(handler);
  }

  /**
   * Subscribe to the raw agent-output firehose: one callback per coalesced
   * line of streamed assistant/thinking text, for EVERY agent. Separate from
   * {@link subscribe} (which pushes throttled state snapshots) because this is
   * append-only and unbounded — a presentation layer mirrors it verbatim (the
   * web server relays it to the browser console). Unlike subscribe(), it does
   * NOT replay history; you only see lines emitted after you subscribe.
   */
  subscribeAgentOutput(handler: AgentOutputSubscriber): () => void {
    this.agentOutputSubscribers.add(handler);
    return () => this.agentOutputSubscribers.delete(handler);
  }

  private emitAgentOutput(chunk: AgentOutputChunk): void {
    for (const sub of this.agentOutputSubscribers) {
      // A misbehaving consumer (e.g. a dead SSE socket) must never break the run.
      try {
        sub(chunk);
      } catch {
        /* best-effort fan-out */
      }
    }
  }

  getState(): OrchestratorState {
    const agents = Array.from(this.agents.values());
    return {
      status: this.status,
      runId: this.manifest?.runId ?? '',
      agents,
      logs: this.logs.slice(-200),
      totalCost: this.currentTotalCost(),
      completedTasks: this.completedTasks,
      totalTasks: this.totalTasksAcrossStages,
      integrationStatus: this.integrationStatus,
      stageIntegrations: [...this.stageIntegrations],
      checkRuns: [...this.checkRuns],
      startedAt: this.startedAt,
      elapsedMs: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      concurrency: this.instanceCount,
      currentStage: this.currentStage,
      ...(this.currentWave > 0 ? { wave: this.currentWave } : {}),
      totalStages: this.totalStages,
      pendingTaskCount: this.pendingTasks.length,
      activeAgentCount: this.activeAgents.size,
      reservedAgentCount: this.reservedAges.size,
      ...(this.declaredWriteCollisions.length > 0
        ? { declaredWriteCollisions: [...this.declaredWriteCollisions] }
        : {}),
      autoScale: this.autoScaler.getStatus(),
    };
  }

  /**
   * Live project cost = Σ per-agent cost. Each agent's `cost` accumulates the
   * authoritative `usage.cost` the backend reports per turn (DeepSeek returns
   * it, in credits = USD, on every completion incl. the final streaming chunk),
   * so the web header AND the headless result's `totalCost` stay correct in
   * real time with no token×price estimate. (Merge/judge agents aren't in
   * `this.agents`, so their LLM cost is not metered into this total yet.)
   */
  private currentTotalCost(): number {
    let sum = 0;
    for (const a of this.agents.values()) sum += a.cost ?? 0;
    return +sum.toFixed(4);
  }

  increaseConcurrency(): void {
    this.setConcurrency(this.instanceCount + 1);
  }

  decreaseConcurrency(): void {
    this.setConcurrency(this.instanceCount - 1);
  }

  setConcurrency(value: number, options?: { bypassCap?: boolean }): void {
    const cap = options?.bypassCap ? AUTO_SCALE_MAX_INSTANCES : MAX_INSTANCES;
    const clamped = Math.max(MIN_INSTANCES, Math.min(cap, value));
    if (clamped === this.instanceCount) return;
    this.instanceCount = clamped;
    this.log({ level: 'info', message: `concurrency set to ${clamped}` });
    this.poolWakeup?.();
    this.emit();
  }

  enableAutoScale(): void {
    if (this.autoScaler.getMode() === 'auto') return;
    this.autoScaler.setMode('auto');
    this.autoScaleDisabledByUser = false;
    this.portAllocator.setMaxAgents(AUTO_SCALE_MAX_INSTANCES);
    this.log({ level: 'info', message: 'auto-scale enabled' });
    this.poolWakeup?.();
    this.emit();
  }

  /**
   * Pin concurrency at the user's choice. The memory guard (kill newest at
   * the destroy threshold, requeue to TODO) stays active — only the
   * automatic concurrency targeting stops.
   */
  disableAutoScale(): void {
    if (this.autoScaler.getMode() === 'manual') return;
    this.autoScaler.setMode('manual');
    this.autoScaleDisabledByUser = true;
    this.portAllocator.setMaxAgents(MAX_INSTANCES);
    if (this.instanceCount > MAX_INSTANCES) {
      this.instanceCount = MAX_INSTANCES;
    }
    this.log({ level: 'info', message: 'auto-scale disabled (concurrency pinned; memory guard stays on)' });
    this.emit();
  }

  /**
   * MAX mode: flood the pool with one agent per queued task (capped at the
   * hard ceiling), letting the memory guard — kill the newest agent at the
   * destroy threshold, requeue its task to TODO — be the sole backstop, so
   * concurrency settles right at the memory limit. Raises the port-allocator
   * cap to match (otherwise real concurrency is silently pinned at the manual
   * port window). Exit via enableAutoScale() (→ auto) or +/- / disableAutoScale()
   * (→ manual). The guard is cooldown-damped, so this never thrashes.
   */
  enableGreedyMode(): void {
    if (this.autoScaler.getMode() === 'greedy') return;
    this.autoScaler.setMode('greedy');
    this.autoScaleDisabledByUser = false;
    this.portAllocator.setMaxAgents(AUTO_SCALE_MAX_INSTANCES);
    this.log({ level: 'info', message: 'MAX mode enabled (flood to memory limit; guard kills newest)' });
    this.poolWakeup?.();
    this.emit();
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    // If parked in `awaiting_retry`, unblock start() so it proceeds to
    // teardown (discarding any remaining failed cards).
    this.finishResolve?.();
    this.dlog('orch', 'abort_requested', {
      activeAgents: this.activeAgents.size,
      pendingTasks: this.pendingTasks.length,
      finalizing: this.finalizingIds.size,
    });
    this.log({ level: 'warn', message: 'abort requested' });
    // Tear down currently-streaming agents so their prompt() resolves
    // immediately. Without this, Q feels frozen for several seconds because
    // executeTaskPool's poll waits for the active agents to finish naturally.
    //
    // Each dispose() promise is tracked so start()'s finally block can
    // await it with a bounded timeout — the previous fire-and-forget
    // (`void agent.dispose()`) let the run resolve while subprocess
    // teardown was still in flight, which leaked file descriptors and
    // occasionally raced with the next run's worktree creation.
    for (const [agentId, agent] of this.activeAgents) {
      const p = (async () => {
        try {
          await agent.dispose();
        } catch (err) {
          this.dlog('orch', 'dispose_failed', {
            agentId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      this.disposingPromises.add(p);
      void p.finally(() => this.disposingPromises.delete(p));
      this.activeAgents.delete(agentId);
      this.portAllocator.release(agentId);
    }
    // Hard reset the allocator so a stuck reservation from a queued/finalizing
    // task doesn't survive into a subsequent run with the same agent ids.
    this.portAllocator.releaseAll();
    this.poolWakeup?.();
  }

  async destroyAgent(agentId: number, reason?: string): Promise<void> {
    return gp_destroyAgent.call(this as unknown as OrchCtx, agentId, reason);
  }

  /**
   * Fase 2.3 — PAUSE the agent instead of killing it (memory-guard victim).
   * Like {@link destroyAgent} it frees the agent's RAM (dispose → GC) and
   * requeues the task, BUT it preserves the agent's worktree + branch + pi
   * session transcript so the next spawn RESUMES from where it left off rather
   * than restarting from zero. Pause is a strict OPTIMIZATION layered on the
   * proven kill+requeue: if a durable checkpoint can't be taken (backend lacks
   * `checkpoint`, nothing written yet, or it throws), this falls back to
   * `destroyAgent` — so the worst case is exactly today's behavior. The caller
   * (the guard) invokes `notifyAgentDestroyed()` afterwards, same as for a kill.
   */
  async pauseAgent(agentId: number, reason?: string): Promise<void> {
    return gp_pauseAgent.call(this as unknown as OrchCtx, agentId, reason);
  }

  // --- Interactive retry surface (held-open `awaiting_retry`) ---

  /** True if any task card is currently in the terminal `error` state. */
  private hasFailedCards(): boolean {
    for (const a of this.agents.values()) {
      if (a.state === 'error') return true;
    }
    return false;
  }

  /**
   * Leave the `awaiting_retry` hold and let the run finalize (done/error) and
   * tear down. No-op when the run isn't being held open. Idempotent.
   */
  finish(): void {
    if (this.status !== 'awaiting_retry') return;
    // A retry in flight is still touching the integration worktree; ignore so
    // start()'s teardown can't race it. The caller can press finish again once
    // the retry settles (status returns to awaiting_retry with no retry busy).
    if (this.retryingIds.size > 0) return;
    this.log({ level: 'info', message: 'run finished by user (awaiting_retry → done)' });
    this.finishResolve?.();
  }

  /**
   * USER-triggered retry of a single FAILED task. Valid ONLY while the run is
   * held open in `awaiting_retry` (so no stage pool is racing on `pendingTasks`).
   * Re-runs the task against the CURRENT integration HEAD in a fresh worktree —
   * reusing the normal pool + per-attempt auto-retry — and, on success, merges
   * its branch into the integration worktree so the recovered work lands. A
   * timed-out card can be retried with a longer `timeoutMs`. Serial: ignores a
   * call while another retry is in flight.
   */
  async retryTask(agentId: number, opts?: { timeoutMs?: number }): Promise<void> {
    if (this.status !== 'awaiting_retry') return;
    if (this.retryingIds.size > 0) return; // one retry at a time
    const status = this.agents.get(agentId);
    if (!status || status.state !== 'error') return;
    const task = this.tasksById.get(agentId);
    if (!task) {
      this.log({
        level: 'warn',
        message: `cannot retry agent ${agentId}: original task not found`,
        agentId,
      });
      return;
    }

    this.retryingIds.add(agentId);
    if (opts?.timeoutMs && opts.timeoutMs > 0) {
      this.retryTimeoutOverrides.set(agentId, opts.timeoutMs);
    }
    try {
      // Leave `awaiting_retry` BEFORE the reset emit — otherwise a subscriber
      // keyed on `awaiting_retry` would observe the error card already cleared
      // (no failures) and prematurely treat the run as done mid-retry.
      this.status = 'running';
      // The prior failure already counted toward completedTasks; un-count it so
      // the re-run's terminal path (finalize or final-fail) re-counts exactly once.
      this.completedTasks = Math.max(0, this.completedTasks - 1);
      this.updateAgentStatus(agentId, {
        state: 'idle',
        phase: 'pending',
        currentFile: task.files.length > 0 ? task.files[0]! : null,
        filesModified: [],
        pushStatus: 'pending',
        commitSha: undefined,
        error: undefined,
        errorKind: undefined,
        // A review-held card is no longer parked once the human chose to
        // retry it — the new attempt re-earns (or re-sets) the marker.
        reviewHeld: undefined,
        attempt: undefined,
        startedAt: undefined,
        finishedAt: undefined,
        merged: undefined,
        mergedAt: undefined,
        mergeFailed: undefined,
        manualRetries: (status.manualRetries ?? 0) + 1,
      });
      const overrideNote = opts?.timeoutMs
        ? ` (timeout ${Math.round(opts.timeoutMs / 1000)}s)`
        : '';
      this.log({
        level: 'info',
        message: `user retrying agent ${agentId}${overrideNote}`,
        agentId,
      });
      this.emit();

      // Single-task pool: reuses spawnAndRun (fresh worktree off the current
      // integration HEAD = this.stageBaseRef) and the per-attempt auto-retry.
      await this.executeTaskPool([task]);

      const after = this.agents.get(agentId);
      if (!this.aborted && after && after.state === 'done' && after.commitSha) {
        // Merge just this branch into the live integration worktree.
        await this.mergeRecoveredBranch(task, '(retry)');
      }
    } finally {
      this.retryTimeoutOverrides.delete(agentId);
      this.retryingIds.delete(agentId);
      // Stay held-open unless an abort unparked us in the meantime.
      if (!this.aborted) {
        this.status = 'awaiting_retry';
      }
      this.emit();
    }
  }

  /**
   * Merge ONE recovered task branch into the live integration worktree under a
   * synthetic visit card (`visitIndex = RETRY_MERGE_VISIT_BASE + seq`, which
   * never collides with walk visitIndexes ≤ `maxNodeExecutions`) and advance
   * `stageBaseRef` so recovered branches stack. Shared by {@link retryTask}
   * (the human retried a failed card) and start()'s abandon sweep (the human
   * left a review-held card unretried → its findings are waived and the
   * preserved `-held` branch merges).
   */
  private async mergeRecoveredBranch(task: AgentTask, cardSuffix: string): Promise<void> {
    const visitIndex = RETRY_MERGE_VISIT_BASE + this.retryMergeSeq++;
    this.stageIntegrations.push({
      visitIndex,
      stepIndex: task.stageIndex,
      stageName: `${task.stageName} ${cardSuffix}`,
      runs: 0,
      phase: 'merging',
      modelId: this.pipeline.integrationModelId ?? this.config.modelId,
      resolverUsed: false,
      branchesMerged: [],
      branchesPending: [],
      conflicts: [],
      startedAt: Date.now(),
    });
    this.status = 'integrating';
    this.emit();
    const mergeResult = await this.runStageIntegration([task], visitIndex);
    if (mergeResult.producedCount > 0) {
      // Advance integration HEAD so a subsequent recovery stacks on top.
      try {
        this.stageBaseRef = await this.worktreeManager!
          .getGitClient()
          .getHead(this.manifest!.integrationWorktreePath);
        this.manifest!.stageBaseCommits!.push(this.stageBaseRef);
      } catch (err) {
        this.dlog('orch', 'retry_head_read_failed', {
          agentId: task.agentId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Persist after a recovery merge so the manifest reflects the new state.
    this.flushManifestToDisk();
  }

  // --- GlobalScheduler RunDriver surface (multi-run subordinate mode) ---

  /**
   * Slots this run could use right now: active + spawning + pending, PLUS any
   * live reserved judge/integration agent — a real LLM process that consumes
   * budget exactly like a task agent (see {@link reservedAges}).
   */
  private getDemand(): number {
    return gp_getDemand.call(this as unknown as OrchCtx);
  }

  /**
   * Running TASK agents with their work-start time, for the scheduler's victim
   * selection (newest = least work lost — mirrors the in-pool guard's
   * `startedAt ?? createdAt`). Reserved integration/judge agents never enter
   * `activeAgents`, so they are naturally excluded as kill victims.
   *
   * Review-locked agents are excluded too: offering one to `selectGlobalVictim`
   * would just waste a preemption decision, since `pauseAgent`/`destroyAgent`
   * refuse it anyway.
   */
  private activeAgentAges(): Array<{ agentId: number; startedAt: number }> {
    return gp_activeAgentAges.call(this as unknown as OrchCtx);
  }

  /**
   * L3 ESCAPE VALVE — abandon the newest in-flight REVIEW so the guard regains
   * a victim.
   *
   * Without it, a machine where every live agent happens to be under review is
   * a machine the memory guard cannot relieve at all: every candidate is
   * locked, the scan finds nobody, and the only bound is `review.timeoutMs`
   * times the remaining rounds. So at the emergency level we spend the
   * cheapest thing available — the CRITIC, whose findings are advisory — and
   * keep the worker's actual output. The critic is aborted (freeing its
   * reserved slot), the lock is released (so the same tick's victim scan can
   * now preempt the worker if it must), and the card is marked
   * `reviewWaived` so the waiver is never silent.
   */
  private abandonReview(reason: string): boolean {
    return gp_abandonReview.call(this as unknown as OrchCtx, reason);
  }

  /**
   * Reservation-accounting inputs (see AutoScaler.syncReservations): spawns in
   * flight plus live agents still younger than MATURE_AGE_MS — the RAM both
   * will grow into is not yet visible in `ramUsedBytes`.
   */
  private spawnStats(): { spawning: number; young: number } {
    return gp_spawnStats.call(this as unknown as OrchCtx);
  }

  /**
   * Lifecycle hook for reserved judge/integration agents (see
   * {@link reservedAges}). Fired via `onReservedLifecycle` by
   * check-evaluator / integration-agent — symmetric even on a factory throw
   * (the callers guard with a local flag), so the count can never leak.
   */
  private trackReservedAgent(ev: 'spawn' | 'exit', agentId: number): void {
    gp_trackReservedAgent.call(this as unknown as OrchCtx, ev, agentId);
  }

  /**
   * Announce an agent stop to the GlobalScheduler (multi-run only — without a
   * scheduler this is a no-op and the single-run path stays byte-identical).
   * The push re-grants the freed slot within ~25 ms instead of leaving it to
   * the next 500 ms poll tick; the scheduler never converts these into the
   * guard's destroy-COOLDOWN.
   */
  private announceAgentExit(agentId: number, cause: string): void {
    gp_announceAgentExit.call(this as unknown as OrchCtx, agentId, cause);
  }

  async start(): Promise<OrchestratorResult> {
    if (this.status !== 'idle') throw new Error('Orchestrator already running');
    this.startedAt = Date.now();
    this.status = 'starting';
    this.emit();

    // Drain captured console.* + node warnings into this.logs so the
    // LogArea ("Logs (all)" panel) surfaces them as orchestrator
    // entries (agentId = -1). Detached in the finally block.
    this.processLogUnsubscribe = attachProcessLogSink((entry) => {
      this.log({
        level: entry.level,
        message: `[${entry.source}] ${entry.message}`,
      });
    });

    try {
      this.dlog('orch', 'preflight_start', { cwd: this.cwd });
      const preflightStartedAt = Date.now();
      this.preflight = await runPreflight(this.cwd);
      this.dlog('orch', 'preflight_end', {
        durationMs: Date.now() - preflightStartedAt,
        valid: this.preflight.valid,
        errors: this.preflight.errors,
        warnings: this.preflight.warnings,
      });
      if (!this.preflight.valid) {
        throw new Error(`Preflight failed: ${this.preflight.errors.join('; ')}`);
      }
      const runId = this.externalRunId ?? generateRunId();
      this.dlog = scopedDebugLog(runId);
      this.runLogger = new RunLogger({
        repoRoot: this.preflight.repoRoot,
        runId,
        pipelineName: this.pipeline.name,
        startedAt: this.startedAt,
      });
      for (const w of this.preflight.warnings) {
        this.log({ level: 'warn', message: `preflight: ${w}` });
      }
      ensureGitignored(this.preflight.repoRoot, '.huu-worktrees/');
      ensureGitignored(this.preflight.repoRoot, `${RUN_LOG_DIR}/`);
      ensureGitignored(this.preflight.repoRoot, AGENT_ENV_FILE);
      ensureGitignored(this.preflight.repoRoot, `${AGENT_BIN_DIR}/`);
      ensureGitignored(this.preflight.repoRoot, '.huu-cache/');
      ensureWorktreeExcluded(this.preflight.repoRoot, [AGENT_ENV_FILE, `${AGENT_BIN_DIR}/`]);

      if (this.portAllocator.isEnabled()) {
        this.nativeShim = ensureNativeShim(this.preflight.repoRoot, (msg) => {
          this.log({ level: 'warn', message: `port-shim: ${msg}` });
        });
        if (this.nativeShim) {
          this.log({
            level: 'info',
            message: `port-shim ready (${this.nativeShim.os}); customer code with hardcoded ports will be remapped at bind() boundary`,
          });
        }
      }

      this.worktreeManager = new WorktreeManager(
        this.preflight.repoRoot,
        runId,
        this.preflight.baseCommit,
        // Multi-run: serialize short git plumbing per repo so two runs on the
        // SAME repo never race on worktree-admin names / `.git` locks. No-op
        // (uncontended) for single-run and for runs on different repos.
        this.scheduler !== null,
      );
      this.dlog('orch', 'integration_worktree_create_start');
      const intStartedAt = Date.now();
      const integration = await this.worktreeManager.createIntegrationWorktree();
      this.dlog('orch', 'integration_worktree_create_end', {
        durationMs: Date.now() - intStartedAt,
        path: integration.worktreePath,
        branch: integration.branchName,
      });
      this.log({ level: 'info', message: `integration worktree: ${integration.worktreePath}` });

      this.manifest = {
        runId,
        baseBranch: this.preflight.baseBranch,
        baseCommit: this.preflight.baseCommit,
        integrationBranch: integration.branchName,
        integrationWorktreePath: integration.worktreePath,
        startedAt: this.startedAt,
        status: 'running',
        agentEntries: [],
        stageBaseCommits: [this.preflight.baseCommit],
        totalStages: this.totalStages,
      };
      this.stageBaseRef = this.preflight.baseCommit;

      this.status = 'running';
      this.emit();

      // Pre-decompose ONLY work steps along the linear walk (every step's
      // first visit) so the kanban TODO column has cards visible from the
      // start. CheckSteps consume zero workers; loops/skips at runtime
      // allocate fresh agentIds on each revisit. The kanban renders these
      // pre-allocated cards as the "happy path"; revisited cards appear
      // dynamically with iteration badges.
      const tasksByStepName: Map<string, AgentTask[]> = new Map();
      this.totalTasksAcrossStages = 0;
      for (let stageIdx = 0; stageIdx < this.pipeline.steps.length; stageIdx++) {
        const step = this.pipeline.steps[stageIdx]!;
        if (!isWorkStep(step)) continue;
        // `memory` steps can't pre-decompose: their file list is written by
        // an EARLIER step and only exists in the integration worktree once
        // the cursor gets there. They materialize via the lazy branch below,
        // exactly like loop revisits do. (Exception: a run-config override
        // already injected concrete files — those pre-decompose normally.)
        if (step.scope === 'memory' && step.files.length === 0) continue;
        const stageTasks = decomposeTasks(step.files, this.nextAgentId, stageIdx, step.name);
        this.nextAgentId += stageTasks.length;
        for (const task of stageTasks) {
          task.branchName = agentBranchName(runId, task.agentId);
          task.worktreePath = agentWorktreePath(this.preflight.repoRoot, runId, task.agentId);
          this.agents.set(task.agentId, this.initialAgentStatus(task));
        }
        tasksByStepName.set(step.name, stageTasks);
        this.totalTasksAcrossStages += stageTasks.length;
      }
      this.emit();

      // Multi-run: register as a subordinate driver so the GlobalScheduler
      // grants this run slots and (under RAM pressure) can pick its agents as
      // kill victims. The per-run AutoScaler then stays DORMANT — the scheduler
      // owns the single machine read. Single-run: start the per-run AutoScaler
      // as before (auto = drives the target, manual = the memory guard). The
      // port-allocator cap was set per-mode in the constructor.
      if (this.scheduler) {
        this.schedulerHandle = this.scheduler.register(
          {
            runId,
            getDemand: () => this.getDemand(),
            activeAgentAges: () => this.activeAgentAges(),
            destroyAgent: (id, reason) => this.destroyAgent(id, reason),
            // Fase 2.3: lets the cross-run guard PAUSE (preserve + resume) this
            // run's victim instead of killing it. Falls back to destroyAgent
            // internally when no checkpoint is possible.
            pauseAgent: (id, reason) => this.pauseAgent(id, reason),
            acceptMetrics: (m) => this.autoScaler.acceptMetrics(m),
            spawnStats: () => this.spawnStats(),
            // Reserved judge/merge agents: counted into the global budget
            // (demand + active side); never victims (activeAgentAges stays
            // task-only). Interface AND this literal — keep both in sync.
            reservedLiveCount: () => this.reservedAges.size,
            // Grant-rise nudge: poolWakeup is non-null ONLY while the pool
            // sleeps out its tick, so this is a free no-op otherwise.
            wakeup: () => this.poolWakeup?.(),
          },
          // Authoritative priority from the caller's list order (racy
          // register-call order would otherwise decide it).
          this.schedulerPriority,
        );
      } else {
        this.autoScaler.start();
      }

      // Gap-B loud warning: inside the container but memory figures did NOT
      // come from a cgroup ceiling → software-only containment (the config of
      // the multi-run OOM incident). Once per run, into the activity log.
      const ceilingWarning = noKernelCeilingWarning(
        this.scheduler ? this.scheduler.budgetTelemetry() : this.autoScaler.metrics(),
      );
      if (ceilingWarning) this.log({ level: 'warn', message: ceilingWarning });

      // Validate pipeline topology BEFORE entering the execution mode.
      // The schema-level validateTopology (Zod superRefine) only runs on
      // file import; code-constructed pipelines bypass it entirely.
      const topoErrors = validateTopology(this.pipeline);
      if (topoErrors.length > 0) {
        throw new Error(
          `Pipeline topology is invalid: ${topoErrors.join('; ')}`,
        );
      }

      // --- Graph cursor: walk the steps array, honoring `next` overrides
      // and check-step outcomes. CheckSteps spawn the judge agent and pick
      // the next step from their declared outcomes; WorkSteps run the
      // agent pool and fall through to `step.next` (or the next array
      // index when undefined). Loops and skips both reduce to "set
      // currentStepName to something the array already contains".
      const stepIndexByName = new Map<string, number>();
      this.pipeline.steps.forEach((s, i) => stepIndexByName.set(s.name, i));
      const maxNodeExecutions = this.pipeline.maxNodeExecutions ?? DEFAULT_MAX_NODE_EXECUTIONS;
      let currentStepName: string | null = this.pipeline.steps[0]!.name;
      let visitIndex = 0;

      if (hasDagEdges(this.pipeline.steps)) {
        // DAG mode (any `dependsOn` present): deterministic waves replace
        // the linear cursor entirely; the legacy while below is skipped.
        // Pipelines without dependsOn keep the exact legacy behavior,
        // including `next`-as-skip.
        await this.runDagWaves({
          runId,
          integration,
          tasksByStepName,
          stepIndexByName,
          maxNodeExecutions,
        });
        currentStepName = null;
      }

      while (currentStepName !== null) {
        if (this.aborted) break;
        if (visitIndex >= maxNodeExecutions) {
          this.recordRunError(
            `pipeline exceeded maxNodeExecutions=${maxNodeExecutions} — raise pipeline.maxNodeExecutions, or break the loop: a check whose chosen outcome keeps pointing BACKWARDS re-runs forever (docs/troubleshooting.md#runaway-loop)`,
          );
          break;
        }

        const stepIdx = stepIndexByName.get(currentStepName);
        if (stepIdx === undefined) {
          this.recordRunError(
            `cursor pointed to unknown step "${currentStepName}" — a next/outcome references a missing or renamed step; fix the pipeline JSON (re-importing it surfaces the exact field via topology validation)`,
          );
          break;
        }
        const step = this.pipeline.steps[stepIdx]!;
        visitIndex += 1;
        const runs = (this.runsByStep.get(step.name) ?? 0) + 1;
        this.runsByStep.set(step.name, runs);
        this.currentStage = visitIndex;

        const traceEntry: ExecutionTraceEntry = {
          visitIndex,
          stepName: step.name,
          stepType: isCheckStep(step) ? 'check' : 'work',
          runs,
          startedAt: Date.now(),
        };
        this.executionTrace.push(traceEntry);

        if (isCheckStep(step)) {
          // --- CheckStep: pure evaluator, no worktrees, no merges. ---
          currentStepName = await this.runCheckVisit(
            step,
            stepIdx,
            visitIndex,
            runs,
            integration,
            runId,
            traceEntry,
          );
          this.emit();
          continue;
        }

        // --- WorkStep: standard run-pool + integration merge. ---
        const workStep = step as WorkStep;
        let stageTasks = tasksByStepName.get(workStep.name);
        if (!stageTasks || runs > 1) {
          // Revisit (loop) or first-time decomposition for a non-pre-decomposed
          // step: allocate fresh agent ids so branch names don't collide
          // with the previous iteration's commits.
          const prep = this.prepareStageTasks(workStep, stepIdx, runId);
          if (prep.fatal) break;
          stageTasks = prep.tasks;
        }

        this.log({
          level: 'info',
          message: `=== step ${visitIndex}: ${workStep.name} (run ${runs})`,
        });
        // Merge card for this stage visit — TODO column while the agents run.
        this.stageIntegrations.push({
          visitIndex,
          stepIndex: stepIdx,
          stageName: workStep.name,
          runs,
          phase: 'pending',
          modelId: this.pipeline.integrationModelId ?? this.config.modelId,
          resolverUsed: false,
          branchesMerged: [],
          branchesPending: [],
          conflicts: [],
        });
        this.emit();

        await this.executeTaskPool(stageTasks);

        if (this.aborted) break;

        const mergedOk = await this.mergeStepVisit(workStep, visitIndex, runs, stageTasks, integration, traceEntry);
        if (!mergedOk) break;

        // Resolve next step: explicit `next` override > linear next > end.
        if (workStep.next !== undefined) {
          currentStepName = workStep.next;
        } else if (stepIdx + 1 < this.pipeline.steps.length) {
          currentStepName = this.pipeline.steps[stepIdx + 1]!.name;
        } else {
          currentStepName = null;
        }
      }

      // Interactive front-ends: if the walk completed (no fatal merge error,
      // not aborted) but left task cards in `error`, hold the run open in
      // `awaiting_retry` so the user can retry individual failures against the
      // still-live integration worktree. We park on a promise resolved by
      // finish()/abort(); retries run in between via retryTask(). Headless
      // drivers never set interactiveRetry, so this is skipped and the run
      // resolves immediately, exactly as before.
      if (
        this.interactiveRetry &&
        !this.aborted &&
        (this.status as OrchestratorState['status']) !== 'error' &&
        this.hasFailedCards()
      ) {
        this.status = 'awaiting_retry';
        this.emit();
        await new Promise<void>((resolve) => {
          this.finishResolve = resolve;
        });
        this.finishResolve = null;

        // Abandon = WAIVE for review-held cards. The human left the hold
        // without retrying them, so each preserved `-held` branch merges with
        // its open findings recorded and waived — exactly the semantics the
        // review loop applies at the round cap under onBlocked:'waive' (the
        // work lands, the waiver is never silent). Cards the human DID retry
        // no longer match (state left `error`), so they are untouched here.
        if (!this.aborted) {
          for (const a of [...this.agents.values()]) {
            if (a.state !== 'error' || a.reviewHeld !== true) continue;
            const task = this.tasksById.get(a.agentId);
            if (!task || !a.branchName || !a.commitSha) {
              this.log({
                level: 'warn',
                message: `agent ${a.agentId} review hold abandoned but no preserved branch survives — nothing to waive-merge`,
                agentId: a.agentId,
              });
              continue;
            }
            this.updateAgentStatus(a.agentId, {
              state: 'done',
              phase: 'done',
              error: undefined,
              errorKind: undefined,
              reviewWaived: true,
              // Resolved: the card is waived+merged, no longer parked.
              reviewHeld: undefined,
              merged: false,
            });
            this.log({
              level: 'warn',
              message: `agent ${a.agentId} review hold abandoned — ${a.reviewFindings?.length ?? 0} finding(s) WAIVED; the preserved branch merges`,
              agentId: a.agentId,
            });
            await this.mergeRecoveredBranch(task, '(review waived)');
          }
        }
      }

      // Read through a widened binding: the error assignments now live in
      // recordRunError()/mergeStepVisit(), so flow analysis would otherwise
      // narrow this.status to 'running' here and reject the comparison.
      const statusAfterRun = this.status as OrchestratorState['status'];
      if (statusAfterRun !== 'error' && !this.aborted) {
        this.status = 'done';
      } else if (this.aborted && statusAfterRun !== 'error') {
        this.status = 'done';
      }
      // Sweep merge cards that never reached a terminal phase (abort or
      // mid-stage error): without this they'd sit in TODO/DOING forever.
      this.stageIntegrations = this.stageIntegrations.map((e) =>
        e.phase === 'pending' || e.phase === 'merging' || e.phase === 'conflict_resolving'
          ? { ...e, phase: 'error' as const, error: e.error ?? 'aborted', finishedAt: e.finishedAt ?? Date.now() }
          : e,
      );
      // Same sweep for judge cards stuck mid-deliberation.
      this.checkRuns = this.checkRuns.map((e) =>
        e.phase === 'judging'
          ? { ...e, phase: 'error' as const, error: e.error ?? 'aborted', finishedAt: e.finishedAt ?? Date.now() }
          : e,
      );
      // Orphaned-work sweep: a run that ended in error/abort can leave done
      // cards whose branch never merged (merged === false). Flag them
      // UNMERGED so committed-but-never-integrated work stops looking green.
      // A run ending 'done' is structurally free of merged:false leftovers
      // (the pool drains before each stage merge), and continueOnConflict
      // runs already had their pending branches flagged by
      // runStageIntegration's reconciliation.
      if (this.status !== 'done' || this.aborted) {
        for (const a of this.agents.values()) {
          if (a.state === 'done' && a.merged === false && !a.mergeFailed) {
            this.updateAgentStatus(a.agentId, { mergeFailed: true });
            this.appendManifestEntry(a.agentId);
          }
        }
      }
      if (this.manifest) {
        this.manifest.finishedAt = Date.now();
        this.manifest.status = this.status === 'done' ? 'done' : 'error';
        this.manifest.executionTrace = this.executionTrace;
        this.manifest.stageIntegrations = this.stageIntegrations;
        this.manifest.checkRuns = this.checkRuns;
      }
      this.emit();

      return {
        runId,
        agents: Array.from(this.agents.values()),
        logs: this.logs,
        totalCost: this.currentTotalCost(),
        filesModified: this.collectFilesModified(),
        conflicts: this.integrationStatus.conflicts.map((c) => ({ file: c.file, agents: [] })),
        duration: Date.now() - this.startedAt,
        manifest: this.manifest!,
        integration: this.integrationStatus,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.status = 'error';
      if (this.manifest && this.manifest.errorReason === undefined) {
        this.manifest.errorReason = reason;
      }
      this.log({ level: 'error', message: reason });
      if (this.manifest) {
        this.manifest.finishedAt = this.manifest.finishedAt ?? Date.now();
        this.manifest.status = 'error';
      }
      this.emit();
      throw err;
    } finally {
      if (this.processLogUnsubscribe) {
        this.processLogUnsubscribe();
        this.processLogUnsubscribe = null;
      }

      // Multi-run: leave the scheduler so the freed budget flows to the other
      // runs. Guarded — start() may have thrown before registration.
      if (this.schedulerHandle) {
        this.scheduler?.unregister(this.schedulerHandle);
        this.schedulerHandle = null;
      }
      // Idempotent — safe even when subordinate mode never started it.
      this.autoScaler.stop();
      // Backstop sweep of this run's port windows. Per-agent release() covers
      // every normal exit, but the port set is SHARED across runs in multi-run
      // mode and lives as long as the host process, so any missed window (e.g.
      // a finalize that timed out past the grace window) would leak permanently
      // without this. Releases only THIS run's windows (see PortAllocator).
      this.portAllocator.releaseAll();

      // Wait for in-flight finalize+dispose with a bounded timeout. The
      // pool's main loop only awaits these on the happy path; an early
      // throw or abort can land us here while subprocess teardown and
      // git worktree removals are still happening. Without this, we'd
      // declare the run "done" and free the dashboard state while
      // background work is still touching the filesystem (and racing
      // with the next run's worktree creation).
      const inFlight: Promise<unknown>[] = [
        ...this.finalizingPromises,
        ...this.disposingPromises,
      ];
      if (inFlight.length > 0) {
        this.dlog('orch', 'await_inflight', {
          finalizing: this.finalizingPromises.size,
          disposing: this.disposingPromises.size,
        });
        await Promise.race([
          Promise.allSettled(inFlight),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);
        if (this.finalizingPromises.size + this.disposingPromises.size > 0) {
          this.dlog('orch', 'inflight_timeout', {
            finalizing: this.finalizingPromises.size,
            disposing: this.disposingPromises.size,
          });
          this.log({
            level: 'warn',
            message: `${this.finalizingPromises.size + this.disposingPromises.size} background task(s) still running after 5s grace; proceeding to cleanup`,
          });
        }
      }

      // Integration worktree teardown lives in finally so a throw or
      // abort during the stage loop doesn't leak the worktree+branch.
      // The previous version cleaned up only on the happy path inside
      // the try block; an exception during stage N+1 left stage N's
      // integration worktree on disk forever (orphan branch + 100s of MB
      // depending on the pipeline).
      if (this.worktreeManager) {
        try {
          await this.worktreeManager.removeIntegrationWorktree();
        } catch (err) {
          this.dlog('orch', 'integration_cleanup_failed', {
            err: err instanceof Error ? err.message : String(err),
          });
          this.log({
            level: 'warn',
            message: `integration worktree cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // Persist run logs to <repoRoot>/.huu/. Runs without a manifest (failed
      // before reaching that point — e.g. preflight invalid) are not flushed.
      if (this.runLogger && this.manifest) {
        const path = this.runLogger.flush(
          this.manifest,
          this.integrationStatus,
          Array.from(this.agents.values()),
        );
        if (path) {
          // Surface the saved path so operators can find the artifact. This
          // log line itself is not in the saved file (flush already happened),
          // but the dashboard's in-memory view shows it.
          this.log({ level: 'info', message: `run log saved: ${path}` });
        } else {
          this.log({ level: 'warn', message: 'failed to write run log to .huu/' });
        }
        this.emit();
      }
    }
  }

  // --- Worker pool ---

  private async executeTaskPool(tasks: AgentTask[]): Promise<void> {
    return gp_executeTaskPool.call(this as unknown as OrchCtx, tasks);
  }

  private async spawnAndRun(task: AgentTask): Promise<void> {
    return gp_spawnAndRun.call(this as unknown as OrchCtx, task);
  }

  // --- Per-task generator → critic loop (§1) ---

  /**
   * Audit ONE task's diff before its branch becomes eligible for the stage
   * merge, sending blocking findings back to the SAME agent to fix.
   *
   * Called from `spawnAndRun` between a successful `agent.prompt` and the
   * finalize handoff, and ONLY when the owning work step declares `review`.
   * Without that field not a line of this runs.
   *
   * EVERY failure mode is forward-default — the work MERGES:
   *   - a critic that throws, times out, is abandoned, or emits nothing
   *     parseable ⇒ `unavailable` ⇒ counted as zero blocking;
   *   - a fix turn that throws or times out ⇒ abort, waive, carry on;
   *   - the round cap reached with blockers still open ⇒ WAIVE and merge, with
   *     every finding recorded and a `warn` in the log.
   * The alternative — failing the card — makes `runStageIntegration` drop it,
   * turning "90% right with one major finding" into "nothing". A broken critic
   * must never be able to destroy a good implementation. The front judge and
   * the epoch gate are the backstops, and the waived findings travel forward in
   * the epoch evidence.
   *
   * Returns `preempted: true` when the memory guard took the worker mid-loop
   * (only reachable after the L3 valve released the lock): the caller then
   * bails exactly like the post-prompt preempt path, since destroyAgent/
   * pauseAgent already own the card state and the requeue. Returns
   * `blocked: true` when the round cap was hit with blockers open under
   * `ReviewSpec.onBlocked: 'hold'` (and an interactive channel is wired):
   * the caller parks the card as a retriable failure instead of finalizing.
   */
  private async runReviewLoop(
    task: AgentTask,
    review: ReviewSpec,
    agent: SpawnedAgent,
    cardTimeoutMs: number,
  ): Promise<{ preempted: boolean; blocked: boolean }> {
    return rl_runReviewLoop.call(this as unknown as OrchCtx, task, review, agent, cardTimeoutMs);
  }

  /**
   * Consume a memory-guard preempt marker for `agentId`.
   *
   * Same consumable-Set discipline as `spawnAndRun`'s catch (see the
   * killedAgentIds/pausedAgentIds docs): the review loop may be the one
   * awaiting when the guard fires, so it has to be able to take the marker.
   */
  private consumePreemptMarker(agentId: number): boolean {
    return gp_consumePreemptMarker.call(this as unknown as OrchCtx, agentId);
  }

  /**
   * Route a critic event onto the WORKER's card, prefixed `🔍`.
   *
   * Deliberately NOT `handleAgentEvent`: an `error` from the critic would mark
   * the TASK as errored and exclude a perfectly good branch from the merge —
   * the exact inversion this whole design refuses. The critic's failures are
   * already handled by `runReviewRound`'s forward default; here they are only
   * shown.
   */
  private handleReviewEvent(taskAgentId: number, reviewId: number, event: AgentEvent): void {
    rl_handleReviewEvent.call(this as unknown as OrchCtx, taskAgentId, reviewId, event);
  }

  /**
   * Write the task's finding shard (one file per task — never a shared file,
   * the same anti-conflict sharding the dev-mode findings protocol uses).
   * Best-effort: a failure here must never affect the run.
   */
  private persistReviewFindings(
    agentId: number,
    review: ReviewSpec,
    findings: readonly ReviewFinding[],
    waived = false,
  ): void {
    rl_persistReviewFindings.call(this as unknown as OrchCtx, agentId, review, findings, waived);
  }

  /**
   * Stage + commit whatever the agent has written so far on its own branch.
   * Returns the new sha, or null when the worktree was already clean.
   *
   * `filesModified` is UNIONED rather than replaced: with a review loop the
   * work arrives across several commits, and the last delta alone would
   * under-report what the agent actually touched (which the write-set metric
   * and the manifest both read). The file list is taken from the COMMIT, not
   * from `git status --porcelain`: porcelain collapses a new directory to
   * `src/` while the committed diff names `src/owned.ts` — and a directory
   * entry is useless to both readers.
   */
  private async commitAgentWork(agentId: number, label: string): Promise<string | null> {
    return fn_commitAgentWork.call(this as unknown as OrchCtx, agentId, label);
  }

  /**
   * Does this agent's branch carry commits its base doesn't?
   *
   * The GIT TRUTH behind "did this task produce anything". A status field can't
   * answer it once a review commits per round (the worktree goes clean) or once
   * a pause clears `commitSha` on a branch that already has commits.
   */
  private async branchAhead(agentId: number): Promise<boolean> {
    return fn_branchAhead.call(this as unknown as OrchCtx, agentId);
  }

  /** Files `baseRef..branch` touched — the committed set when the worktree is clean. */
  private async branchChangedFiles(agentId: number): Promise<string[]> {
    return fn_branchChangedFiles.call(this as unknown as OrchCtx, agentId);
  }

  /**
   * Record a provider failure against the key that produced it and report
   * whether the pool rotated to a different usable one.
   */
  private async reportKeyFailure(
    kind: ReturnType<typeof classifyProviderError>,
    key: string,
  ): Promise<boolean> {
    if (!this.keyPool) return false;
    return this.keyPool.report(kind, key);
  }

  /**
   * Record files this agent committed that its task spec did NOT claim
   * ({@link AgentStatus.writeSetViolations}).
   *
   * PURE INSTRUMENTATION — nothing is blocked, reverted or warned about to the
   * agent. It exists because the research pass behind this design found a
   * GENUINE absence of published evidence on exactly the number huu's
   * worktree+barrier architecture rests on: how often an LLM agent honors a
   * file-scope restriction given only in its prompt. huu is in a position to
   * MEASURE it rather than cite it. No spec, or a spec that claims nothing,
   * records nothing — there is no declaration to violate.
   */
  private async recordWriteSetViolations(agentId: number): Promise<void> {
    return fn_recordWriteSetViolations.call(this as unknown as OrchCtx, agentId);
  }

  private async finalizeAgent(agentId: number): Promise<void> {
    return fn_finalizeAgent.call(this as unknown as OrchCtx, agentId);
  }

  /**
   * Patch the merge-card entry for a stage visit and notify subscribers.
   * Replaces the entry immutably so React consumers see a fresh reference.
   */
  private upsertStageIntegration(visitIndex: number, patch: Partial<StageIntegration>): void {
    const idx = this.stageIntegrations.findIndex((e) => e.visitIndex === visitIndex);
    if (idx === -1) return;
    this.stageIntegrations[idx] = { ...this.stageIntegrations[idx]!, ...patch };
    this.emit();
  }

  /** Same as {@link upsertStageIntegration}, for the judge cards. */
  private upsertCheckRun(visitIndex: number, patch: Partial<CheckRun>): void {
    const idx = this.checkRuns.findIndex((e) => e.visitIndex === visitIndex);
    if (idx === -1) return;
    this.checkRuns[idx] = { ...this.checkRuns[idx]!, ...patch };
    this.emit();
  }

  private async runStageIntegration(
    stageTasks: AgentTask[],
    visitIndex: number,
  ): Promise<{ producedCount: number; failedCount: number }> {
    const integrationPath = this.manifest!.integrationWorktreePath;
    const integrationBranch = this.manifest!.integrationBranch;
    const repoRoot = this.preflight!.repoRoot;
    const runId = this.manifest!.runId;

    // M3-04: count genuine failures (error/timeout) separately from
    // no_changes (agent ran successfully, nothing to change). A rework
    // step that produces the same output as the first run is no_changes,
    // not failed.
    let erroredCount = 0;
    for (const task of stageTasks) {
      const s = this.agents.get(task.agentId);
      if (s?.state === 'error') erroredCount += 1;
    }

    const eligibleEntries: AgentManifestEntry[] = stageTasks
      .map((task) => this.agents.get(task.agentId))
      .filter((s): s is AgentStatus => Boolean(s))
      .filter((s) => s.commitSha && s.state === 'done')
      .map((s) => ({
        agentId: s.agentId,
        branchName: s.branchName!,
        worktreePath: s.worktreePath!,
        files: s.filesModified,
        status: s.phase,
        commitSha: s.commitSha!,
        pushStatus: 'skipped',
        cleanupDone: true,
        noChanges: false,
        stageIndex: s.stageIndex,
        stageName: s.stageName,
      }));

    // Log every excluded agent so it's visible WHY a task didn't make it into
    // the stage merge (missing commitSha, error state, etc.). Without this,
    // dropped tasks are invisible until the final manifest is inspected.
    for (const task of stageTasks) {
      const s = this.agents.get(task.agentId);
      if (!s) {
        this.log({
          level: 'warn',
          message: `agent ${task.agentId} excluded from merge: not found in agent status map`,
        });
      } else if (!s.commitSha || s.state !== 'done') {
        this.log({
          level: 'warn',
          message: `agent ${task.agentId} excluded from merge: state=${s.state}, commitSha=${s.commitSha ? 'present' : 'missing'}`,
        });
      }
    }

    if (eligibleEntries.length === 0) {
      this.log({
        level: 'warn',
        message: `stage produced no eligible entries (0/${stageTasks.length} agents committed)`,
      });
      this.upsertStageIntegration(visitIndex, {
        phase: 'skipped',
        finishedAt: Date.now(),
        lastLog: `0/${stageTasks.length} agents committed — nothing to merge`,
      });
      // eligibleEntries.length === 0: nothing committed.
      // erroredCount counts agents in state 'error'.
      // no_changes agents (phase 'no_changes', state 'done') are NOT failures.
      return { producedCount: 0, failedCount: erroredCount };
    }

    // "done means MERGED": flip each card's merged flag AS its branch lands
    // (the kanban ripple — ascending agentId order is untouched), then
    // reconcile idempotently after the merge resolves so any path that filled
    // branchesMerged without firing the hook is covered, and orphaned work
    // (branchesPending on a failed merge) stops looking green.
    const agentIdByBranch = new Map(eligibleEntries.map((e) => [e.branchName, e.agentId]));
    const markMerged = (branchName: string): void => {
      const id = agentIdByBranch.get(branchName);
      if (id === undefined) return;
      this.updateAgentStatus(id, { merged: true, mergedAt: Date.now() });
    };
    const reconcileMergeFlags = (
      status: { branchesMerged: string[]; branchesPending: string[] },
      failed: boolean,
    ): void => {
      for (const b of status.branchesMerged) {
        const id = agentIdByBranch.get(b);
        if (id === undefined) continue;
        const s = this.agents.get(id);
        if (!s?.merged) {
          this.updateAgentStatus(id, { merged: true, mergedAt: s?.mergedAt ?? Date.now() });
        }
      }
      if (failed) {
        for (const b of status.branchesPending) {
          const id = agentIdByBranch.get(b);
          if (id === undefined) continue;
          this.updateAgentStatus(id, { mergeFailed: true });
        }
      }
      // Manifest entries were appended at finalize time (pre-merge) — replace
      // them so the persisted run reflects the merge truth per card.
      for (const id of agentIdByBranch.values()) this.appendManifestEntry(id);
    };

    // Build the verify gate from the pipeline's mergeGate shell command.
    // Same closure for both paths — no resolver and LLM-resolved merge.
    const mergeVerify = this.pipeline.mergeGate
      ? async (worktreePath: string, branchName: string) => {
          const cmd = this.pipeline.mergeGate!;
          this.dlog('merge', 'verify_start', {
            worktreePath,
            branch: branchName,
            cmd,
          });
          try {
            const output = execFileSync('sh', ['-c', cmd], {
              cwd: worktreePath,
              encoding: 'utf8',
              timeout: 60_000,
            }).trim();
            return { ok: true as const, output };
          } catch (err: unknown) {
            const output = String(
              (err as { stderr?: unknown }).stderr ??
                (err instanceof Error ? err.message : err),
            ).trim();
            return { ok: false as const, output };
          }
        }
      : undefined;

    if (this.conflictResolverFactory) {
      // LLM-resolved path: try deterministic merge, then fall back to integration agent.
      const effectiveConfig = this.pipeline.integrationModelId
        ? { ...this.config, modelId: this.pipeline.integrationModelId }
        : this.config;
      const resolution = await runStageIntegrationWithResolver(eligibleEntries, {
        repoRoot,
        integrationWorktreePath: integrationPath,
        integrationBranch,
        runId,
        config: effectiveConfig,
        resolverFactory: this.conflictResolverFactory,
        mergeVerify,
        onPhase: () => {
          this.upsertStageIntegration(visitIndex, {
            phase: 'conflict_resolving',
            resolverUsed: true,
          });
        },
        onBranchMerged: markMerged,
        // Count the reserved resolver (9999) in the global RAM budget while
        // it lives — it only spawns when the deterministic merge left
        // conflicts, exactly when memory is under the most pressure.
        onReservedLifecycle: (ev, id) => this.trackReservedAgent(ev, id),
        onEvent: (agentId, event) => {
          // Forward integration-agent events into the run logs.
          // Integration agent uses the reserved id 9999.
          if (event.type === 'log') {
            this.log({
              level: event.level ?? 'info',
              message: event.message,
              agentId,
            });
            this.upsertStageIntegration(visitIndex, { lastLog: event.message });
          } else if (event.type === 'error') {
            this.log({ level: 'error', message: event.message, agentId });
            this.upsertStageIntegration(visitIndex, { lastLog: event.message });
          }
        },
      });
      this.mergeIntegrationStatus(resolution.status);
      reconcileMergeFlags(resolution.status, !resolution.success);
      this.upsertStageIntegration(visitIndex, {
        phase: resolution.success ? 'done' : 'error',
        finishedAt: Date.now(),
        branchesMerged: [...resolution.status.branchesMerged],
        branchesPending: [...resolution.status.branchesPending],
        conflicts: resolution.status.conflicts.map((c) => ({ ...c })),
        error: resolution.errorMessage,
      });
      this.log({
        level: resolution.success ? 'info' : 'error',
        message: resolution.success
          ? `merged ${resolution.status.branchesMerged.length}/${eligibleEntries.length} branches; ${resolution.status.conflicts.length} conflicts` +
            (resolution.resolvedConflicts > 0 ? ` (${resolution.resolvedConflicts} resolved by LLM)` : '') +
            ` [${resolution.status.branchesMerged.join(', ')}]`
          : `stage merge failed: ${resolution.errorMessage ?? 'unknown'}`,
      });
      this.emit();
      const mergedLen = resolution.status.branchesMerged.length;
      // failedCount = agent errors + eligible entries that couldn't be merged
      return {
        producedCount: mergedLen,
        failedCount: erroredCount + (eligibleEntries.length - mergedLen),
      };
    }

    // No resolver — deterministic only. `hasIssues` reflects THIS stage only;
    // older versions used the cumulative `this.integrationStatus`, which made
    // a clean stage 2 fail if stage 1 had any conflict/pending — even when the
    // resolver path elsewhere had already handled it.
    const stageStatus = await mergeAgentBranches(
      eligibleEntries,
      integrationPath,
      repoRoot,
      markMerged,
      mergeVerify,
    );
    this.mergeIntegrationStatus(stageStatus);
    const hasIssues =
      stageStatus.conflicts.length > 0 ||
      stageStatus.branchesPending.length > 0;
    reconcileMergeFlags(stageStatus, hasIssues);
    this.upsertStageIntegration(visitIndex, {
      phase: hasIssues ? 'error' : 'done',
      finishedAt: Date.now(),
      branchesMerged: [...stageStatus.branchesMerged],
      branchesPending: [...stageStatus.branchesPending],
      conflicts: stageStatus.conflicts.map((c) => ({ ...c })),
      error: hasIssues
        ? `${stageStatus.conflicts.length} conflict(s), ${stageStatus.branchesPending.length} pending (no resolver)`
        : undefined,
    });
    this.log({
      level: hasIssues ? 'error' : 'info',
      message: `merged ${stageStatus.branchesMerged.length}/${eligibleEntries.length} branches; ${stageStatus.conflicts.length} conflicts; ${stageStatus.branchesPending.length} pending` +
        ` [${stageStatus.branchesMerged.join(', ')}]`,
    });
    this.emit();
    const mergedLen = stageStatus.branchesMerged.length;
    // failedCount = agent errors + eligible entries that couldn't be merged
    return {
      producedCount: mergedLen,
      failedCount: erroredCount + (eligibleEntries.length - mergedLen),
    };
  }

  // --- Agent event handling ---

  private handleAgentEvent(agentId: number, event: AgentEvent): void {
    this.runLogger?.appendEvent(agentId, event);
    // Count EVERY event as a card action before the type-specific handling
    // below: it mutates the map in place (no emit), and the switch's
    // updateAgentStatus/appendAgentLog read a fresh snapshot that preserves it.
    this.bumpAction(agentId, actionName(event));
    switch (event.type) {
      case 'log':
        this.log({ level: event.level ?? 'info', message: event.message, agentId });
        this.appendAgentLog(agentId, event.message);
        break;
      case 'stream':
        // Live streamed output. Coalesce into lines, then surface them — this
        // is the difference between a run log that advances token-by-token and
        // one that only updates at tool/turn boundaries. Returns early WITHOUT
        // a state-snapshot emit() when no line completed, so per-token deltas
        // don't trigger a getState() each (the firehose handles per-line push).
        this.handleStreamDelta(agentId, event.channel, event.delta);
        return;
      case 'compaction':
        this.handleCompaction(agentId, event.reason);
        break;
      case 'state_change':
        // While a card is under review the LIFECYCLE PHASE belongs to
        // `runReviewLoop` (`reviewing`/`fixing`) — the fix turn streams like
        // any other, and letting its state_change overwrite `phase` would
        // flip the card back to RUNNING mid-fix and lose the whole
        // REVIEW → FIXING → REVIEW progression the kanban renders. `state`
        // still tracks reality either way.
        this.updateAgentStatus(agentId, {
          state: event.state,
          ...(this.reviewLockedIds.has(agentId) ? {} : { phase: event.state }),
        });
        break;
      case 'file_write':
        this.appendAgentLog(agentId, `wrote ${event.file}`);
        break;
      case 'usage': {
        // Accumulate token / cost telemetry into AgentStatus. Backends
        // emit this alongside the human-readable "tokens +Xin +Yout" log
        // line; the log is for the dashboard, the structured event is
        // what makes per-agent token reporting in the run log non-zero.
        const cur = this.agents.get(agentId);
        if (cur) {
          this.updateAgentStatus(agentId, {
            tokensIn: cur.tokensIn + (event.inputTokens ?? 0),
            tokensOut: cur.tokensOut + (event.outputTokens ?? 0),
            cacheReadTokens: cur.cacheReadTokens + (event.cacheReadTokens ?? 0),
            cacheWriteTokens: cur.cacheWriteTokens + (event.cacheWriteTokens ?? 0),
            cost: cur.cost + (event.cost ?? 0),
          });
        }
        break;
      }
      case 'done':
        this.flushStreamBuffers(agentId);
        this.updateAgentStatus(agentId, { state: 'done' });
        break;
      case 'error':
        this.flushStreamBuffers(agentId);
        this.updateAgentStatus(agentId, { state: 'error', error: event.message });
        this.log({ level: 'error', message: event.message, agentId });
        break;
    }
    this.emit();
  }

  /**
   * Feed a streamed delta through the agent's per-channel line coalescer and
   * surface every completed line. Assistant lines advance the GLOBAL run log
   * AND the per-agent log AND the firehose. Thinking lines go to the firehose
   * AND the per-agent log (tagged with {@link THINKING_LOG_PREFIX}) so a card's
   * drawer shows the same stream the browser console mirrors — but NOT the
   * global run log, where the verbose reasoning trace would drown everything
   * else. emit() runs once per line so the snapshot ticks in real time without
   * a getState() per token.
   */
  private handleStreamDelta(
    agentId: number,
    channel: 'assistant' | 'thinking',
    delta: string,
  ): void {
    let buffers = this.streamBuffers.get(agentId);
    if (!buffers) {
      buffers = { assistant: new StreamLineBuffer(), thinking: new StreamLineBuffer() };
      this.streamBuffers.set(agentId, buffers);
    }
    const lines = buffers[channel].push(delta);
    for (const line of lines) this.emitStreamLine(agentId, channel, line);
  }

  private emitStreamLine(
    agentId: number,
    channel: 'assistant' | 'thinking',
    line: string,
  ): void {
    if (line.length === 0) return; // skip blank lines — pure noise in a log view
    // Firehose: every line, both channels, verbatim (browser-console mirror).
    this.emitAgentOutput({ agentId, channel, text: line });
    if (channel === 'assistant') {
      // Reply text: the global run log + the per-agent log, tagged to the worker.
      this.log({ level: 'info', message: line, agentId, kind: 'worker' });
      this.appendAgentLog(agentId, line);
    } else {
      // Reasoning trace: into the per-agent log too (so the card drawer matches
      // the console firehose), tagged so it reads apart from reply text; kept
      // OUT of the global run log to avoid drowning it.
      this.appendAgentLog(agentId, `${THINKING_LOG_PREFIX}${line}`);
    }
    this.emit();
  }

  /** Drain any buffered partial lines for an agent and forget its buffers. */
  private flushStreamBuffers(agentId: number): void {
    const buffers = this.streamBuffers.get(agentId);
    if (!buffers) return;
    for (const channel of ['assistant', 'thinking'] as const) {
      const rest = buffers[channel].flush();
      if (rest !== null) this.emitStreamLine(agentId, channel, rest);
    }
    this.streamBuffers.delete(agentId);
  }

  /**
   * Mark the run failed with an ACTIONABLE reason — what broke AND what to
   * do next. The FIRST fatal reason wins (later cascading errors don't
   * overwrite the root cause); it travels on the manifest to the summary
   * screen, the headless final JSON and the web result frame.
   */
  private recordRunError(reason: string): void {
    this.status = 'error';
    if (this.manifest && this.manifest.errorReason === undefined) {
      this.manifest.errorReason = reason;
    }
    this.log({ level: 'error', message: reason });
    this.emit();
  }

  // --- Step-visit bodies (shared by the legacy cursor and DAG waves) ---

  /**
   * Decompose a work step into tasks: memory resolution (filesFrom read
   * from the integration worktree), agent-id/branch/worktree allocation and
   * kanban card registration. `fatal: true` means the run was already moved
   * to error state (corrupt memory file) and the caller must stop.
   */
  private prepareStageTasks(
    workStep: WorkStep,
    stepIdx: number,
    runId: string,
  ): { tasks: AgentTask[]; fatal: boolean } {
    let stepFiles = workStep.files;
    let memoryHints: Map<string, string> | undefined;
    if (workStep.scope === 'memory' && workStep.files.length === 0) {
      // Resolve the file list the producing step left in the merged
      // integration state. Read on EVERY visit so check-loop rewrites
      // of the memory file take effect. (A non-empty workStep.files
      // here means a run-config override won.)
      try {
        const resolved = resolveMemoryFiles(
          workStep.filesFrom!,
          this.manifest!.integrationWorktreePath,
          workStep.maxFiles,
        );
        for (const warning of resolved.warnings) {
          this.log({ level: 'warn', message: `memory scope "${workStep.name}": ${warning}` });
        }
        stepFiles = resolved.files;
        memoryHints = resolved.hints;
        this.log({
          level: 'info',
          message: `memory scope "${workStep.name}": ${stepFiles.length} task(s) from ${workStep.filesFrom}`,
        });
      } catch (err) {
        // Corrupt memory file: never legitimate — fail the run loudly.
        this.recordRunError(
          `memory scope "${workStep.name}": ${err instanceof MemoryFileError ? err.message : String(err)} — the producer wrote an invalid huu-memory-v1 file; tighten its prompt, or declare \`produces\` on it so huu appends the exact format contract (docs/memory-scope.md → Troubleshooting)`,
        );
        return { tasks: [], fatal: true };
      }
    }
    let tasks = decomposeTasks(stepFiles, this.nextAgentId, stepIdx, workStep.name);
    if (workStep.scope === 'memory' && stepFiles.length === 0) {
      // Missing/empty memory file resolves to ZERO tasks (not one
      // whole-project task — that would silently widen the blast
      // radius the producer chose). The stage completes empty and the
      // merge card is skipped, mirroring "no agent commits".
      tasks = [];
    }
    this.nextAgentId += tasks.length;
    // The DECLARED write scope, resolved once, here — the only place that can.
    // A `memory`-scope task's `files` is its SPEC path, and the spec's
    // `## Files this task OWNS` list is the real contract; it exists in the
    // integration worktree (the same tree `resolveMemoryFiles` reads) before
    // any agent worktree does. Feeding it to the header is what stops the
    // agent being told its own briefing is the one file it may edit.
    const owned =
      workStep.scope === 'memory'
        ? this.resolveDeclaredOwnership(stepFiles)
        : new Map<string, string[]>();
    // Declared-vs-declared collision, checked NOW — before a single agent of
    // this step spawns, and across EVERY step of the run so far, which is what
    // makes it catch the dangerous case: two parallel fronts claiming the same
    // file. It reports; it never blocks. A guard layer here degrades (the run
    // proceeds, the merge may conflict, the resolver earns its keep) because
    // refusing to run work the human already approved is a worse failure than
    // a conflict huu can name in advance.
    for (const [spec, paths] of owned) this.declaredOwnership.set(spec, paths);
    if (owned.size > 0) {
      const collisions = collideDeclaredOwnership(this.declaredOwnership);
      const fresh = collisions.filter((c) => !this.reportedCollisions.has(c.path));
      if (fresh.length > 0) {
        for (const c of fresh) this.reportedCollisions.add(c.path);
        this.declaredWriteCollisions = collisions;
        this.log({ level: 'warn', message: formatDeclaredCollisions(fresh) });
      }
    }
    for (const task of tasks) {
      if (memoryHints) task.hint = memoryHints.get(task.files[0] ?? '');
      const declared = owned.get(task.files[0] ?? '');
      if (declared && declared.length > 0) task.ownedPaths = declared;
      if (workStep.readOnly === true) task.readOnly = true;
      if (workStep.writes && workStep.writes.length > 0) task.writes = [...workStep.writes];
      task.branchName = agentBranchName(runId, task.agentId);
      task.worktreePath = agentWorktreePath(this.preflight!.repoRoot, runId, task.agentId);
      this.agents.set(task.agentId, this.initialAgentStatus(task));
    }
    this.totalTasksAcrossStages += tasks.length;
    return { tasks, fatal: false };
  }

  /**
   * The card's context was compacted. Two responses, in this order.
   *
   * FIRST compaction — RE-STATE THE CONSTRAINT. Compaction is documented to
   * drop early-conversation instructions, and the earliest instructions an
   * agent got are the ones that matter most here: which file it is working
   * from and which files it may write. huu already tells agents to write facts
   * down because "tool results may be compacted away later"; this is the same
   * idea applied to the constraint rather than the findings, and it is
   * mechanism instead of hope. Delivered through `steer()`, so nothing is
   * cancelled and no second `prompt()` races the first.
   *
   * THIRD consecutive compaction — STOP. Context refilling to the limit
   * immediately after each compaction is a card that is not making progress,
   * usually because one oversized read or command keeps coming back. Letting it
   * run to the 10-minute wall clock buys nothing and bills for all of it. The
   * threshold is the same 3 as {@link MAX_CONSECUTIVE_EPOCH_FAILURES}, adopted
   * from the same incident shape — a loop that never recovers, burning calls.
   * The card fails with an actionable message and the normal retry path owns
   * what happens next; huu never silently swallows the work.
   */
  private handleCompaction(agentId: number, reason: string): void {
    const status = this.agents.get(agentId);
    const count = (status?.compactions ?? 0) + 1;
    this.updateAgentStatus(agentId, { compactions: count });
    this.log({
      level: 'warn',
      message: `context compaction #${count} (${reason}) — earlier turns are being dropped`,
      agentId,
    });

    const agent = this.activeAgents.get(agentId);

    if (count >= MAX_CARD_COMPACTIONS) {
      this.log({
        level: 'error',
        message: `${count} context compactions on one card — the context refills as fast as it is compacted, so this card is not progressing. Stopping it rather than billing the rest of its timeout. Narrow the step's scope, or have it read large files in slices.`,
        agentId,
      });
      void agent?.abort().catch(() => {
        /* the prompt rejection is the real signal; abort is best-effort */
      });
      return;
    }

    if (count === 1 && agent?.steer) {
      void agent.steer(compactionReminder(agent.task)).catch(() => {
        /* steering is an improvement to a running turn, never a failure of it */
      });
    }
  }

  /**
   * Read each spec out of the INTEGRATION worktree and parse its declared
   * `## Files this task OWNS` list.
   *
   * Never throws and never blocks: a spec that cannot be read, or that
   * declares nothing, simply yields no entry — the header then falls back to
   * the file list exactly as it did before this existed. The declaration is a
   * CONTRACT the recon wrote, not a permission huu grants, so a missing one is
   * an absence of information, not an error.
   *
   * Also the input to the pre-fan-out collision report (`writePartitionCollisions`):
   * the same parse answers both "what may this agent write" and "do two agents
   * claim the same file", and doing it once keeps those two answers consistent.
   */
  private resolveDeclaredOwnership(specPaths: readonly string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const root = this.manifest?.integrationWorktreePath;
    if (!root) return out;
    for (const spec of specPaths) {
      try {
        const full = join(root, spec);
        if (!existsSync(full)) continue;
        const declared = parseOwnedPaths(readFileSync(full, 'utf8'));
        if (declared.length > 0) out.set(spec, declared);
      } catch {
        // Unreadable spec — the agent still gets its briefing path; only the
        // declared scope is missing.
      }
    }
    return out;
  }

  /**
   * One CheckStep visit: maxRuns fallback or live judge in the integration
   * worktree. Pushes/updates the judge card + trace and returns the chosen
   * outcome's nextStepName (legacy mode sets the cursor to it; DAG mode
   * treats it as an activation edge).
   */
  private async runCheckVisit(
    step: CheckStep,
    stepIdx: number,
    visitIndex: number,
    runs: number,
    integration: { worktreePath: string; branchName: string },
    runId: string,
    traceEntry: ExecutionTraceEntry,
  ): Promise<string> {
    const judgeModelId = step.modelId ?? this.config.modelId;
    const maxRuns = step.maxRuns;
    if (maxRuns !== undefined && runs > maxRuns) {
      const fallback = step.outcomes.find((o) => o.default) ?? step.outcomes[0]!;
      this.log({
        level: 'warn',
        message: `check "${step.name}" hit maxRuns=${maxRuns}; using default outcome "${fallback.label}"`,
      });
      // Completed judge card so the forced default is visible on the
      // board (DONE column) rather than the check silently skipping.
      this.checkRuns.push({
        visitIndex,
        stepIndex: stepIdx,
        stepName: step.name,
        runs,
        maxRuns,
        phase: 'done',
        modelId: judgeModelId,
        condition: step.condition,
        outcomeLabel: fallback.label,
        nextStepName: fallback.nextStepName,
        fromJudge: false,
        reason: `maxRuns=${maxRuns} reached`,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      traceEntry.outcomeLabel = fallback.label;
      traceEntry.nextStepName = fallback.nextStepName;
      traceEntry.finishedAt = Date.now();
      return fallback.nextStepName;
    }

    this.log({
      level: 'info',
      message: `=== check ${visitIndex}: ${step.name} (run ${runs}${maxRuns ? `/${maxRuns}` : ''})`,
    });
    // Judge card — DOING column while the judge deliberates.
    this.checkRuns.push({
      visitIndex,
      stepIndex: stepIdx,
      stepName: step.name,
      runs,
      maxRuns,
      phase: 'judging',
      modelId: judgeModelId,
      condition: step.condition,
      startedAt: Date.now(),
    });
    this.emit();

    const result = await evaluateCheckStep({
      step,
      runs,
      repoRoot: this.preflight!.repoRoot,
      integrationWorktreePath: integration.worktreePath,
      integrationBranch: integration.branchName,
      baseCommit: this.preflight!.baseCommit,
      runId,
      config: this.config,
      factory: this.conflictResolverFactory ?? this.agentFactory,
      // The judge has no retry loop of its own and every outcome defaults
      // FORWARD, so a 429 there approves in silence. The pool buys it exactly
      // one rotation retry.
      keyPool: this.keyPool,
      // Count the reserved judge (9998) in the global RAM budget while it lives.
      onReservedLifecycle: (ev, id) => this.trackReservedAgent(ev, id),
      onEvent: (agentId, event) => {
        if (event.type === 'log') {
          this.log({ level: event.level ?? 'info', message: event.message, agentId });
          this.upsertCheckRun(visitIndex, { lastLog: event.message });
        } else if (event.type === 'error') {
          this.log({ level: 'error', message: event.message, agentId });
          this.upsertCheckRun(visitIndex, { lastLog: event.message });
        }
      },
    });
    this.upsertCheckRun(visitIndex, {
      phase: 'done',
      condition: result.resolvedCondition,
      outcomeLabel: result.label,
      nextStepName: result.nextStepName,
      fromJudge: result.fromJudge,
      reason: result.reason,
      finishedAt: Date.now(),
    });
    traceEntry.outcomeLabel = result.label;
    traceEntry.nextStepName = result.nextStepName;
    traceEntry.resolvedCondition = result.resolvedCondition;
    traceEntry.finishedAt = Date.now();
    this.log({
      level: 'info',
      message: `check "${step.name}" → ${result.label}${result.fromJudge ? '' : ' (default)'} → ${result.nextStepName}`,
    });
    return result.nextStepName;
  }

  /**
   * Runtime write-set disjunction: before the stage merge, build a
   * {@code Map<path, agentId[]>} from each agent's {@code filesModified}
   * and flag every path with >=2 writers. The static validation in
   * {@code validateTopology} already rejects overlapping intra-wave write
   * sets; this catches runtime divergence where an agent writes outside its
   * declared surface. Violations are LOGGED and recorded in
   * {@code AgentStatus.writeSetViolations} — purely instrumentation today.
   */
  private runWriteSetCheck(workStep: WorkStep, stageTasks: AgentTask[]): void {
    if (!workStep.writes || workStep.writes.length === 0) return;
    const filesByAgent = new Map<number, readonly string[]>();
    for (const task of stageTasks) {
      const st = this.agents.get(task.agentId);
      if (st?.filesModified && st.filesModified.length > 0) {
        filesByAgent.set(task.agentId, st.filesModified);
      }
    }
    if (filesByAgent.size < 2) return;
    const violations = checkWriteSetViolations(filesByAgent);
    for (const v of violations) {
      const ids = v.agentIds.join(', ');
      this.log({
        level: 'warn',
        message: `write-set violation: "${v.path}" modified by agents [${ids}] — concurrent agents wrote to the same file`,
        agentId: v.agentIds[0]!,
      });
      // Record the violation on each involved agent.
      for (const agentId of v.agentIds) {
        const st = this.agents.get(agentId);
        if (st) {
          const current = st.writeSetViolations ?? [];
          this.updateAgentStatus(agentId, {
            writeSetViolations: [...current, v.path],
          });
        }
      }
    }
    if (violations.length > 0) {
      this.dlog('orch', 'write_set_violations', {
        stageName: workStep.name,
        count: violations.length,
        paths: violations.map((v) => v.path),
      });
    }
  }

  /**
   * The integration phase of one work-step visit: serial merge into the
   * integration worktree + HEAD ref update. Returns false when the run was
   * moved to error state (caller stops).
   */
  private async mergeStepVisit(
    workStep: WorkStep,
    visitIndex: number,
    runs: number,
    stageTasks: AgentTask[],
    integration: { worktreePath: string },
    traceEntry: ExecutionTraceEntry,
  ): Promise<boolean> {
    this.status = 'integrating';
    this.upsertStageIntegration(visitIndex, { phase: 'merging', startedAt: Date.now() });
    // Runtime write-set disjunction check: before the merge, detect paths
    // written by >=2 agents. Log + record violations; do NOT block merge.
    this.runWriteSetCheck(workStep, stageTasks);

    const mergeResult = await this.runStageIntegration(stageTasks, visitIndex);
    // M3-04: failedCount now captures BOTH agent errors AND merge failures
    // (branches that couldn't land). no_changes (agent ran but produced no
    // new output) is NOT a failure and contributes 0 to failedCount.
    if (mergeResult.failedCount > 0) {
      if (this.interactiveRetry) {
        traceEntry.finishedAt = Date.now();
        this.log({
          level: 'warn',
          message: `step "${workStep.name}" had ${mergeResult.failedCount} failure(s); ${mergeResult.producedCount}/${stageTasks.length} tasks produced work (awaiting retry)`,
        });
        this.status = 'running';
        this.emit();
        return true;
      }
      traceEntry.finishedAt = Date.now();
      this.recordRunError(
        `stage integration failed in "${workStep.name}" — ${mergeResult.failedCount} task(s) failed, ${mergeResult.producedCount}/${stageTasks.length} tasks produced work`,
      );
      return false;
    }

    // Accept gate: post-merge enforcement run in the integration worktree.
    if (workStep.accept) {
      const gateResult = runAcceptGate(integration.worktreePath, workStep.accept);
      if (!gateResult.ok) {
        for (const task of stageTasks) {
          this.updateAgentStatus(task.agentId, { mergeFailed: true });
        }
        traceEntry.finishedAt = Date.now();
        this.recordRunError(
          `accept gate failed for step "${workStep.name}": command "${workStep.accept.command}" exited with ${gateResult.exitCode} (expected ${workStep.accept.expectExit ?? 0}). Output: ${gateResult.output.slice(0, 500)}`,
        );
        return false;
      }
      this.log({
        level: 'info',
        message: `accept gate passed for step "${workStep.name}": exit ${gateResult.exitCode}`,
      });
    }

    // Update integration HEAD ref (worktree never rewinds — loops just
    // re-run on top of current HEAD, accumulating commits).
    const previousBaseRef = this.stageBaseRef;
    try {
      this.stageBaseRef = await this.worktreeManager!.getGitClient().getHead(integration.worktreePath);
      this.manifest!.stageBaseCommits!.push(this.stageBaseRef);
      traceEntry.commitAfter = this.stageBaseRef;
    } catch (err) {
      traceEntry.finishedAt = Date.now();
      this.recordRunError(
        `cannot read integration HEAD after step ${visitIndex} ("${workStep.name}"): ${err instanceof Error ? err.message : String(err)}. The next step cannot branch from a known-good base; aborting. If a previous run left orphan worktrees behind, run \`huu prune\` and retry (docs/troubleshooting.md#git-state)`,
      );
      return false;
    }
    traceEntry.finishedAt = Date.now();
    this.dlog('orch', 'step_advance', {
      visitIndex,
      stepName: workStep.name,
      runs,
      previousBaseRef,
      newBaseRef: this.stageBaseRef,
      stepTaskCount: stageTasks.length,
    });
    this.log({
      level: 'info',
      message: `step ${visitIndex} "${workStep.name}" done; next branches from ${this.stageBaseRef.slice(0, 8)} (was ${previousBaseRef.slice(0, 8)})`,
    });
    this.status = 'running';
    this.flushManifestToDisk();
    this.emit();
    return true;
  }

  /**
   * DAG (wave) executor — BSP supersteps. Each wave runs every pending step
   * whose effective deps are done: their tasks share ONE pool, then merge
   * sequentially in ARRAY ORDER (deterministic: composition and merge order
   * derive from the graph + array, never from timing). Ready checks run as
   * singleton waves; check outcomes and work `next` act as ACTIVATION edges
   * that re-pend their target plus its downstream cone.
   */
  private async runDagWaves(args: {
    runId: string;
    integration: { worktreePath: string; branchName: string };
    tasksByStepName: Map<string, AgentTask[]>;
    stepIndexByName: Map<string, number>;
    maxNodeExecutions: number;
  }): Promise<void> {
    return wd_runDagWaves.call(this as unknown as OrchCtx, args);
  }

  // --- Helpers ---

  private renderPrompt(step: PromptStep, task: AgentTask): string {
    let prompt = step.prompt;
    if (task.files.length > 0) {
      // `$hint` carries the per-file context a memory-file producer attached
      // to this path (empty for non-memory tasks) — replaced before `$file`
      // so a hint containing the literal `$file` can't be re-expanded.
      prompt = prompt.replaceAll('$hint', task.hint ?? '').replaceAll('$file', task.files[0]!);
    }
    // `$baseCommit` = repo HEAD at run start (preflight). Lets a step diff the
    // run against its origin (`git diff --name-only $baseCommit..HEAD`) or
    // restore a frozen file (`git checkout $baseCommit -- <path>`) — e.g. the
    // Test Suite cleanup step restoring any production source an agent drifted.
    prompt = prompt.replaceAll('$baseCommit', this.preflight?.baseCommit ?? '');
    if (step.produces) {
      // The producer promised a memory file: append the deterministic
      // contract (exact path/format/cap) so the pipeline author never
      // writes that boilerplate — and the cap always matches what the
      // consuming step will actually enforce.
      prompt += `\n\n${memoryContract(step.produces, memoryCapForPath(this.pipeline, step.produces))}`;
    }
    return prompt;
  }

  private buildSystemPromptHint(step: PromptStep, task: AgentTask): string {
    const fileScope =
      task.files.length === 0
        ? 'You have full access to the repository.'
        : `Work only on these files: ${task.files.join(', ')}`;
    return `Stage: ${step.name}\n${fileScope}`;
  }

  private initialAgentStatus(task: AgentTask): AgentStatus {
    return {
      agentId: task.agentId,
      state: 'idle',
      phase: 'pending' as AgentLifecyclePhase,
      currentFile: task.files.length > 0 ? task.files[0]! : null,
      logs: [],
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      filesModified: [],
      branchName: task.branchName,
      worktreePath: task.worktreePath,
      pushStatus: 'pending',
      stageIndex: task.stageIndex,
      stageName: task.stageName,
      createdAt: Date.now(),
    };
  }

  private updateAgentStatus(agentId: number, patch: Partial<AgentStatus>): void {
    const cur = this.agents.get(agentId);
    if (!cur) return;

    if (!cur.startedAt && cur.phase === 'pending' && patch.phase && patch.phase !== 'pending') {
      patch = { ...patch, startedAt: Date.now() };
    }

    const isTerminal =
      patch.state === 'done' ||
      patch.state === 'error' ||
      patch.phase === 'done' ||
      patch.phase === 'error' ||
      patch.phase === 'no_changes';
    if (isTerminal && !cur.finishedAt) {
      patch = { ...patch, finishedAt: Date.now() };
    }

    this.agents.set(agentId, { ...cur, ...patch });
    this.emit();
  }

  private appendAgentLog(agentId: number, message: string): void {
    const cur = this.agents.get(agentId);
    if (!cur) return;
    // Retain up to the web server's per-frame bound (MAX_AGENT_LOG_LINES = 200)
    // so the drawer's live tail and the full set from /api/agent-logs agree.
    // 100 was too tight now that the reasoning trace shares this buffer.
    const next = { ...cur, logs: [...cur.logs, message].slice(-200) };
    this.agents.set(agentId, next);
  }

  /**
   * Increment the per-action counter for `action` and record it as the most
   * recent one. Like {@link appendAgentLog}, mutates the agents map without
   * emitting — `handleAgentEvent` emits once after the type-specific handler.
   */
  private bumpAction(agentId: number, action: string): void {
    const cur = this.agents.get(agentId);
    if (!cur) return;
    const actionCounts = { ...(cur.actionCounts ?? {}) };
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    this.agents.set(agentId, { ...cur, actionCounts, lastAction: action });
  }

  /**
   * Flush the in-memory manifest to `.huu/manifest-<runId>.json`.
   * Called at every stage boundary so a crash mid-run leaves a recoverable
   * record — not only in the `finally` of `start()`.
   */
  private flushManifestToDisk(): void {
    if (!this.manifest || !this.runLogger) return;
    // Update mutable fields the logger reads before writing.
    this.manifest.executionTrace = this.executionTrace;
    this.manifest.stageIntegrations = this.stageIntegrations;
    this.manifest.checkRuns = this.checkRuns;
    this.runLogger.flushManifest(this.manifest);
  }

  private appendManifestEntry(agentId: number): void {
    if (!this.manifest) return;
    const status = this.agents.get(agentId);
    if (!status) return;
    const entry: AgentManifestEntry = {
      agentId,
      branchName: status.branchName ?? '',
      worktreePath: status.worktreePath ?? '',
      files: status.filesModified,
      status: status.phase,
      commitSha: status.commitSha,
      pushStatus: status.pushStatus,
      // 'error' here means we already attempted cleanup in spawnAndRun's catch,
      // so the worktree+branch are gone. 'no_changes' is a terminal state where
      // finalizeAgent already removed the worktree. Either way, treat as
      // cleaned-up to avoid a redundant best-effort sweep in cleanupRunFromManifest.
      cleanupDone:
        status.phase === 'done' || status.phase === 'error' || status.phase === 'no_changes',
      noChanges: status.phase === 'no_changes',
      error: status.error,
      errorKind: status.errorKind,
      attempt: status.attempt,
      stageIndex: status.stageIndex,
      stageName: status.stageName,
      merged: status.merged,
      mergeFailed: status.mergeFailed,
    };
    // agentIds are unique per task-instance (loop revisits allocate fresh ids),
    // EXCEPT a user retry reuses the same id — replace the prior entry so the
    // manifest reflects the FINAL outcome of each agent rather than duplicating.
    const existing = this.manifest.agentEntries.findIndex((e) => e.agentId === agentId);
    if (existing >= 0) {
      this.manifest.agentEntries[existing] = entry;
    } else {
      this.manifest.agentEntries.push(entry);
    }
  }

  private collectFilesModified(): string[] {
    const all = new Set<string>();
    for (const agent of this.agents.values()) {
      for (const f of agent.filesModified) all.add(f);
    }
    return Array.from(all);
  }

  private log(entry: { level: 'info' | 'warn' | 'error' | 'debug'; message: string; agentId?: number; kind?: LogEntry['kind'] }): void {
    // Enrich with run / stage context so log aggregation can pivot
    // across runs and stages. Previously every entry was just
    // (timestamp, agentId, level, message) — diagnosing "which stage
    // emitted this warning?" required reading the surrounding lines.
    const agentId = entry.agentId ?? -1;
    const status = agentId >= 0 ? this.agents.get(agentId) : undefined;
    const stageIndex = status?.stageIndex ?? (this.currentStage > 0 ? this.currentStage - 1 : undefined);
    const stageName =
      status?.stageName ??
      (stageIndex !== undefined ? this.pipeline.steps[stageIndex]?.name : undefined);
    // Default kind: agent id 9999 is the integration agent, negative is
    // orchestrator-level, anything else is a worker. Caller can override.
    const kind: LogEntry['kind'] =
      entry.kind ?? (agentId === 9999 ? 'integrator' : agentId >= 0 ? 'worker' : 'orchestrator');
    const logEntry: LogEntry = {
      timestamp: Date.now(),
      agentId,
      level: entry.level,
      message: entry.message,
      runId: this.manifest?.runId,
      stageIndex,
      stageName,
      kind,
    };
    this.logs.push(logEntry);
    if (this.logs.length > 1000) this.logs.shift();
    this.runLogger?.append(logEntry);
    if (this.onLogSink) {
      try {
        this.onLogSink(logEntry);
      } catch {
        /* an external log sink must never take the run down */
      }
    }
  }

  private mergeIntegrationStatus(stageStatus: IntegrationStatus): void {
    this.integrationStatus.branchesMerged.push(...stageStatus.branchesMerged);
    // Append (don't replace) so a pending branch from stage N stays visible
    // in the manifest after stage N+1 runs. Future stages don't operate on
    // older stages' branches, so this is purely observability — but losing
    // it makes "why didn't this branch land?" impossible to answer post-run.
    this.integrationStatus.branchesPending.push(...stageStatus.branchesPending);
    this.integrationStatus.conflicts.push(...stageStatus.conflicts);
    if (stageStatus.finalCommitSha) {
      this.integrationStatus.finalCommitSha = stageStatus.finalCommitSha;
    }
    if (stageStatus.phase === 'error' || this.integrationStatus.phase === 'error') {
      this.integrationStatus.phase = 'error';
    } else if (stageStatus.phase === 'conflict_resolving' || this.integrationStatus.phase === 'conflict_resolving') {
      this.integrationStatus.phase = 'conflict_resolving';
    } else {
      this.integrationStatus.phase = stageStatus.phase;
    }
  }

  private emit(): void {
    const state = this.getState();
    for (const sub of this.subscribers) sub(state);
  }
}
