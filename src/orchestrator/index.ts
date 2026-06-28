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
} from '../lib/types.js';
import {
  DEFAULT_CARD_TIMEOUT_MS,
  DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_NODE_EXECUTIONS,
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
import { PortAllocator } from './port-allocator.js';
import {
  AGENT_BIN_DIR,
  AGENT_ENV_FILE,
  writeAgentBinShim,
  writeAgentEnvFile,
} from './agent-env.js';
import { ensureNativeShim, type NativeShim } from './native-shim.js';
import { AutoScaler } from './auto-scaler.js';
import type { GlobalScheduler, RunDriverHandle } from './global-scheduler.js';
import { getSystemMetrics } from '../lib/resource-monitor.js';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute } from 'node:path';
import { log, scopedDebugLog } from '../lib/debug-logger.js';
import { attachProcessLogSink } from '../lib/process-log-bridge.js';
import { checkOpenRouterReachable } from '../lib/openrouter.js';
import { AuthError } from '../lib/auth-error.js';
import { findSpec, keyRemedyHint, resolveApiKeyWithSource } from '../lib/api-key.js';

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
const AUTO_SCALE_MAX_INSTANCES = 200;
const MIN_INSTANCES = 1;
const POLL_INTERVAL_MS = 500;

class TimeoutError extends Error {
  readonly isTimeout = true;
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`card timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function computeCardTimeoutMs(task: AgentTask, pipeline: Pipeline): number {
  if (task.files.length === 1) {
    return pipeline.singleFileCardTimeoutMs ?? DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS;
  }
  return pipeline.cardTimeoutMs ?? DEFAULT_CARD_TIMEOUT_MS;
}

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
   * When set, this run is SUBORDINATE to a GlobalScheduler (multi-run
   * scheduling): the scheduler owns the concurrency target (`grantFor`) and the
   * cross-run memory-guard kill (lowest-priority newest first), and this run's
   * own AutoScaler stays dormant (display-only). Omit for the normal single-run
   * path — every code path below then behaves exactly as before.
   */
  scheduler?: GlobalScheduler;
  /**
   * Externally-assigned run id. When set, start() uses it instead of generating
   * one — letting a multi-run manager key its Map<runId, …> and return the id
   * to the browser BEFORE start() resolves (so concurrent runs never collide on
   * an empty-string key). Omit for the normal self-assigned path.
   */
  runId?: string;
}

/**
 * Short, stable name for an AgentEvent, used as the key of
 * `AgentStatus.actionCounts` and the value of `AgentStatus.lastAction`.
 * `state_change` splits into `stream`/`tool`; every other event maps to its
 * own `type`. Keep these in sync with the kanban renderer's ACTION_ORDER.
 */
function actionName(event: AgentEvent): string {
  if (event.type === 'state_change') {
    return event.state === 'tool_running' ? 'tool' : 'stream';
  }
  if (event.type === 'file_write') return 'file';
  return event.type; // 'log' | 'usage' | 'done' | 'error'
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
  private autoScaleDisabledByUser = false;
  /**
   * Set when this run is subordinate to a GlobalScheduler (multi-run). Null on
   * the normal single-run path, where the per-run AutoScaler drives the pool.
   */
  private scheduler: GlobalScheduler | null = null;
  /** Handle for unregistering from the scheduler in the finally block. */
  private schedulerHandle: RunDriverHandle | null = null;
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
    this.externalRunId = options.runId;
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
      autoScale: this.autoScaler.getStatus(),
    };
  }

  /**
   * Live project cost = Σ per-agent cost. Each agent's `cost` accumulates the
   * authoritative `usage.cost` the backend reports per turn (OpenRouter returns
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

  async destroyAgent(agentId: number): Promise<void> {
    const agent = this.activeAgents.get(agentId);
    if (!agent) return;

    // Marker consumed by spawnAndRun's catch so the killed attempt's
    // rejection skips retry accounting (see killedAgentIds doc).
    this.killedAgentIds.add(agentId);

    // Dispose causes agent.prompt() to reject in spawnAndRun.
    try {
      await agent.dispose();
    } catch {
      /* best-effort */
    }

    this.activeAgents.delete(agentId);
    this.spawningIds.delete(agentId);

    const status = this.agents.get(agentId);
    const worktreePath = status?.worktreePath;
    const branchName = status?.branchName;

    if (worktreePath) {
      try {
        await this.worktreeManager!.removeAgentWorktree(agentId);
      } catch {
        /* best-effort */
      }
    }

    if (branchName) {
      try {
        const git = this.worktreeManager!.getGitClient();
        await git.deleteBranch(branchName);
      } catch {
        /* best-effort */
      }
    }

    this.portAllocator.release(agentId);

    // Back to the TODO column — the card visibly returns to `pending` with
    // a requeue counter, and work restarts from zero on the next spawn.
    // Older agents are never the victim, so their finished work is kept.
    const task = agent.task;
    this.updateAgentStatus(agentId, {
      state: 'idle',
      phase: 'pending',
      currentFile: task.files.length > 0 ? task.files[0]! : null,
      filesModified: [],
      pushStatus: 'pending',
      branchName: task.branchName,
      worktreePath: task.worktreePath,
      commitSha: undefined,
      error: undefined,
      errorKind: undefined,
      attempt: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      requeues: (this.agents.get(agentId)?.requeues ?? 0) + 1,
    });
    const ramPercent = Math.round(this.autoScaler.getStatus().ramPercent);
    this.log({
      level: 'warn',
      message: `agent ${agentId} killed by memory guard (RAM ${ramPercent}%); task requeued to TODO`,
      agentId,
    });

    this.pendingTasks.unshift(task);
    this.poolWakeup?.();
  }

  // --- GlobalScheduler RunDriver surface (multi-run subordinate mode) ---

  /** Slots this run could use right now: active + spawning + pending. */
  private getDemand(): number {
    return this.activeAgents.size + this.spawningIds.size + this.pendingTasks.length;
  }

  /**
   * Running TASK agents with their work-start time, for the scheduler's victim
   * selection (newest = least work lost — mirrors the in-pool guard's
   * `startedAt ?? createdAt`). Reserved integration/judge agents never enter
   * `activeAgents`, so they are naturally excluded as kill victims.
   */
  private activeAgentAges(): Array<{ agentId: number; startedAt: number }> {
    const out: Array<{ agentId: number; startedAt: number }> = [];
    for (const id of this.activeAgents.keys()) {
      const st = this.agents.get(id);
      out.push({ agentId: id, startedAt: st?.startedAt ?? st?.createdAt ?? 0 });
    }
    return out;
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
      // Fast network probe — fail loudly in <8s instead of letting every
      // agent burn 32s × 8 retries on an unreachable OpenRouter. Common
      // failure: Docker bridge MTU (1500) > VPN tunnel MTU (~1420) drops
      // TLS ClientHello packets silently.
      if ((this.config.backend ?? 'pi') === 'pi') {
        this.dlog('orch', 'network_probe_start');
        const probeStartedAt = Date.now();
        const reach = await checkOpenRouterReachable(this.config.apiKey);
        this.dlog('orch', 'network_probe_end', {
          durationMs: Date.now() - probeStartedAt,
          kind: reach.kind,
        });
        if (reach.kind === 'unauthorized') {
          // Name the source that actually supplied the rejected key. The saved
          // Options key now outranks the env var (store is resolver step 2, the
          // env var is step 4), so the hint correctly says "update the saved
          // key" when a saved key won, or "fix the env var / save one" when the
          // env var was only the fallback — never a misdirecting blanket message.
          const spec = findSpec('openrouter');
          const hint = spec
            ? keyRemedyHint(spec, resolveApiKeyWithSource(spec))
            : 'Update OPENROUTER_API_KEY in the Options screen.';
          throw new AuthError({
            backendKind: 'pi',
            specName: 'openrouter',
            message: `OpenRouter rejected the API key (HTTP ${reach.status}). ${hint}`,
          });
        }
        if (reach.kind === 'unreachable') {
          const inContainer = process.env.HUU_IN_CONTAINER === '1';
          const hint = inContainer
            ? ' Hint: if you are on a VPN (WireGuard/OpenVPN), the docker bridge MTU (1500) is likely larger than your tunnel MTU (~1420), silently dropping TLS handshake packets. Workaround: `export HUU_DOCKER_NETWORK=host` and rerun. Permanent fix: edit /etc/docker/daemon.json with `{"mtu": 1420}` and restart dockerd.'
            : '';
          throw new Error(
            `Cannot reach openrouter.ai (${reach.reason}). Aborting before agents spawn so you don't waste 30 minutes on retries.${hint}`,
          );
        }
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
        this.schedulerHandle = this.scheduler.register({
          runId,
          getDemand: () => this.getDemand(),
          activeAgentAges: () => this.activeAgentAges(),
          destroyAgent: (id) => this.destroyAgent(id),
          acceptMetrics: (m) => this.autoScaler.acceptMetrics(m),
        });
      } else {
        this.autoScaler.start();
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
    this.pendingTasks = [...tasks];

    while (
      !this.aborted &&
      (this.pendingTasks.length > 0 || this.activeAgents.size > 0 || this.spawningIds.size > 0 || this.finalizingIds.size > 0)
    ) {
      if (this.scheduler) {
        // SUBORDINATE (multi-run): the GlobalScheduler owns the concurrency
        // target AND the cross-run, priority-ordered memory-guard kill. Refresh
        // grants so this run's current demand is reflected, then read our slice.
        // No in-pool guard here — selectGlobalVictim() runs in the scheduler
        // tick so the victim is the LOWEST-priority run's newest agent.
        this.scheduler.recomputeGrants();
        this.instanceCount = this.scheduler.grantFor(this.manifest!.runId);
      } else {
        this.autoScaler.notifyTaskQueued(this.pendingTasks.length);
        // Auto mode drives the concurrency target from memory headroom; greedy
        // (MAX) mode drives it from the queue depth; manual mode keeps the
        // user's pinned value. Both scaler modes recompute every tick.
        const scaleMode = this.autoScaler.getMode();
        if (scaleMode === 'auto' || scaleMode === 'greedy') {
          this.instanceCount = this.autoScaler.targetConcurrency();
        }

        // Memory guard (both modes): at the destroy threshold, kill the
        // NEWEST agent — the one with the least work done — and requeue its
        // task to TODO so older agents' progress is never lost.
        if (this.autoScaler.shouldDestroy() && this.activeAgents.size > 0) {
          let newestId = -1;
          let newestTime = 0;
          for (const [id, _agent] of this.activeAgents) {
            const status = this.agents.get(id);
            const since = status?.startedAt ?? status?.createdAt;
            if (since && since > newestTime) {
              newestTime = since;
              newestId = id;
            }
          }
          if (newestId >= 0) {
            await this.destroyAgent(newestId);
            this.autoScaler.notifyAgentDestroyed();
            // Re-evaluation: next poll cycle will check shouldDestroy() again
          }
        }
      }

      // Spawn replacements up to instanceCount
      const busyCount = this.activeAgents.size + this.spawningIds.size;
      const slotsAvailable = Math.max(0, this.instanceCount - busyCount);
      for (let i = 0; i < slotsAvailable && this.pendingTasks.length > 0; i++) {
        if (!(this.scheduler ? this.scheduler.shouldSpawn() : this.autoScaler.shouldSpawn())) {
          break;
        }
        const task = this.pendingTasks.shift()!;
        // spawnAndRun owns its own try/catches; this outer .catch() is the
        // safety net for an error that escapes ALL of them — typically a
        // synchronous throw before the first await (e.g., an unexpected
        // factory shape, or getGitClient() blowing up). Without bumping
        // completedTasks and clearing every queue here, the pool's poll loop
        // could otherwise see a "ghost" task forever and never exit.
        this.spawnAndRun(task).catch((err) => {
          this.spawningIds.delete(task.agentId);
          this.activeAgents.delete(task.agentId);
          this.finalizingIds.delete(task.agentId);
          this.portAllocator.release(task.agentId);
          this.updateAgentStatus(task.agentId, {
            state: 'error',
            phase: 'error',
            error: err instanceof Error ? err.message : String(err),
            errorKind: 'failed',
          });
          this.completedTasks++;
          this.appendManifestEntry(task.agentId);
          this.poolWakeup?.();
        });
      }

      // Wait with wakeup
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, POLL_INTERVAL_MS);
        this.poolWakeup = () => {
          clearTimeout(timer);
          this.poolWakeup = null;
          resolve();
        };
      });
    }
  }

  private async spawnAndRun(task: AgentTask): Promise<void> {
    // In wave (DAG) mode, tasks of SEVERAL steps share one pool — the
    // owning step is resolved from the task itself (names are unique by
    // topology validation). A miss is an internal bug: the throw lands in
    // executeTaskPool's outer .catch safety net and errors the card.
    const step = this.pipeline.steps.find(
      (s): s is PromptStep => !isCheckStep(s) && s.name === task.stageName,
    );
    if (!step) {
      throw new Error(`internal: task ${task.agentId} references unknown step "${task.stageName}"`);
    }
    const maxRetries = this.pipeline.maxRetries ?? DEFAULT_MAX_RETRIES;
    const totalAttempts = 1 + maxRetries;
    const timeoutMs = computeCardTimeoutMs(task, this.pipeline);
    const git = this.worktreeManager!.getGitClient();
    this.dlog('orch', 'spawn_start', {
      agentId: task.agentId,
      files: task.files,
      totalAttempts,
      timeoutMs,
    });

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      // Re-add at the top of every attempt so the pool poll loop never sees
      // the task as "free" between attempts. spawningIds is moved to
      // activeAgents below once the factory succeeds.
      this.spawningIds.add(task.agentId);
      const isRetry = attempt > 1;
      let agent: SpawnedAgent | null = null;
      let attemptBranchName: string | null = null;

      try {
        this.updateAgentStatus(task.agentId, {
          phase: 'worktree_creating',
          attempt,
          ...(isRetry ? { error: undefined, errorKind: undefined } : {}),
        });
        const wtStartedAt = Date.now();
        const wt = await this.worktreeManager!.createAgentWorktree(
          task.agentId,
          this.stageBaseRef,
          attempt,
        );
        this.dlog('orch', 'worktree_ready', {
          agentId: task.agentId,
          attempt,
          durationMs: Date.now() - wtStartedAt,
          path: wt.worktreePath,
          branch: wt.branchName,
        });
        attemptBranchName = wt.branchName;
        // Keep task in sync so the agent prompt header receives the right
        // branch/worktree on retry.
        task.branchName = wt.branchName;
        task.worktreePath = wt.worktreePath;
        this.updateAgentStatus(task.agentId, {
          phase: 'worktree_ready',
          branchName: wt.branchName,
          worktreePath: wt.worktreePath,
        });

        // Allocate the agent's port window and materialize .env.huu + shim in
        // the (fresh) worktree. Allocator is idempotent per agentId, so retries
        // reuse the same window — but the worktree was destroyed and recreated,
        // so the on-disk artefacts must be rewritten on every attempt.
        let portBundle = this.portAllocator.isEnabled()
          ? this.portAllocator.getBundle(task.agentId)
          : undefined;
        if (this.portAllocator.isEnabled()) {
          try {
            if (!portBundle) {
              portBundle = await this.portAllocator.allocate(task.agentId);
            }
            writeAgentEnvFile(wt.worktreePath, portBundle, this.manifest!.runId, this.nativeShim);
            writeAgentBinShim(wt.worktreePath);
          } catch (envErr) {
            // Port isolation is best-effort: a failure here would otherwise
            // abort the whole attempt over what is, for many pipelines, a
            // non-issue (steps that never bind a socket). Log loud and keep
            // going without injection.
            portBundle = undefined;
            this.log({
              level: 'warn',
              message: `agent ${task.agentId} port allocation failed: ${envErr instanceof Error ? envErr.message : String(envErr)}; continuing without per-agent ports`,
              agentId: task.agentId,
            });
          }
        }

        this.updateAgentStatus(task.agentId, { phase: 'session_starting' });
        // Retries and memory-guard requeues reuse the same agentId, so drop any
        // partial line a previous attempt left buffered — otherwise its tail
        // would prepend to this attempt's first streamed line.
        this.streamBuffers.delete(task.agentId);
        const stepConfig = step.modelId
          ? { ...this.config, modelId: step.modelId }
          : this.config;
        agent = await this.agentFactory(
          task,
          stepConfig,
          this.buildSystemPromptHint(step, task),
          wt.worktreePath,
          (event) => this.handleAgentEvent(task.agentId, event),
          portBundle
            ? { ports: portBundle, shimAvailable: this.nativeShim !== null }
            : undefined,
        );
        this.activeAgents.set(task.agentId, agent);
        this.spawningIds.delete(task.agentId);
        this.autoScaler.notifyAgentSpawned();

        const renderedPrompt = this.renderPrompt(step, task);
        this.updateAgentStatus(task.agentId, { state: 'streaming', phase: 'streaming' });

        try {
          await withTimeout(agent.prompt(renderedPrompt), timeoutMs);
          // If agent didn't emit `done`/`error` itself, we treat resolve as done.
          const status = this.agents.get(task.agentId);
          if (status && status.state !== 'done' && status.state !== 'error') {
            this.updateAgentStatus(task.agentId, { state: 'done' });
          }
        } catch (err) {
          // Hard cancel: dispose the (possibly hung) agent and clean up the
          // attempt's worktree+branch before deciding to retry. Move the task
          // back to spawningIds BEFORE the awaits below so the pool's poll
          // loop doesn't observe all queues empty and exit while we're still
          // in flight (would silently drop the retry).
          if (this.killedAgentIds.delete(task.agentId)) {
            // Memory guard killed this attempt; destroyAgent already reset
            // the card to TODO and requeued the task. Do NOT retry here, do
            // NOT mark as error, do NOT count as completed.
            this.spawningIds.delete(task.agentId);
            return;
          }

          const isTimeout = err instanceof TimeoutError;
          this.dlog('orch', 'attempt_failed', {
            agentId: task.agentId,
            attempt,
            totalAttempts,
            kind: isTimeout ? 'timeout' : 'failed',
            timeoutMs,
            err: err instanceof Error ? err.message : String(err),
          });
          // Balance the notifyAgentSpawned() of this attempt — a retry
          // re-increments when it respawns. Without this the scaler's
          // active count inflates on every retry/final-fail, skewing the
          // observed per-agent memory estimate.
          if (this.activeAgents.delete(task.agentId)) {
            this.autoScaler.notifyAgentCompleted();
          }
          this.spawningIds.add(task.agentId);
          // On timeout, the in-flight HTTP request is still burning tokens
          // until the provider naturally finishes. Tell the SDK to abort
          // before we tear down listeners. Capped at 3s so a stuck SDK
          // can't push the retry decision back indefinitely.
          if (isTimeout) {
            try {
              await withTimeout(agent.abort(), 3_000);
            } catch (abortErr) {
              this.dlog('orch', 'abort_failed', {
                agentId: task.agentId,
                err: abortErr instanceof Error ? abortErr.message : String(abortErr),
              });
            }
          }
          try {
            await agent.dispose();
          } catch {
            /* best effort */
          }
          try {
            await this.worktreeManager!.removeAgentWorktree(task.agentId, attempt);
          } catch {
            /* best effort */
          }
          try {
            await git.deleteBranch(wt.branchName);
          } catch {
            /* best effort */
          }

          if (attempt >= totalAttempts) {
            this.spawningIds.delete(task.agentId);
            this.portAllocator.release(task.agentId);
            this.updateAgentStatus(task.agentId, {
              state: 'error',
              phase: 'error',
              error: err instanceof Error ? err.message : String(err),
              errorKind: isTimeout ? 'timeout' : 'failed',
            });
            // finalizeAgent won't run for final-fail, so bump the progress
            // counters and persist the manifest entry manually.
            this.completedTasks++;
            this.appendManifestEntry(task.agentId);
            this.poolWakeup?.();
            return;
          }

          this.log({
            level: 'warn',
            message: `agent ${task.agentId} ${isTimeout ? 'timed out' : 'failed'} on attempt ${attempt}/${totalAttempts}: ${err instanceof Error ? err.message : String(err)}; retrying`,
            agentId: task.agentId,
          });
          this.emit();
          continue;
        }

        // Success path — hand off to finalize BEFORE releasing the active slot.
        // There must be no `await` between decrementing one queue and
        // incrementing the next, or executeTaskPool's poll loop can observe
        // all queues empty and exit while dispose/finalize are still in flight.
        this.finalizingIds.add(task.agentId);
        this.activeAgents.delete(task.agentId);
        try {
          await agent.dispose();
        } catch (disposeErr) {
          this.log({
            level: 'warn',
            message: `agent ${task.agentId} dispose failed: ${disposeErr instanceof Error ? disposeErr.message : String(disposeErr)}`,
          });
        }

        // Track the finalize promise so abort/start can await it (see
        // finalizingPromises field doc). Catch errors that escape
        // finalizeAgent's own try/catch — those should be impossible
        // (the inner catch maps everything to status), but if a future
        // edit slips an unguarded throw past it we want a loud
        // unhandled-rejection in the run log instead of a silent process
        // exit code 1 from Node's default handler.
        const finalizePromise = this.finalizeAgent(task.agentId);
        this.finalizingPromises.add(finalizePromise);
        finalizePromise
          .catch((err) => {
            this.dlog('orch', 'finalize_unhandled', {
              agentId: task.agentId,
              err: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
            this.log({
              level: 'error',
              message: `agent ${task.agentId} finalize unhandled error: ${err instanceof Error ? err.message : String(err)}`,
              agentId: task.agentId,
            });
          })
          .finally(() => {
            this.finalizingIds.delete(task.agentId);
            this.finalizingPromises.delete(finalizePromise);
            this.poolWakeup?.();
          });
        return;
      } catch (err) {
        // Setup failure (worktree creation, agent factory). Treat as a failed
        // attempt — clean up partials and decide retry vs final-fail. Keep
        // task in spawningIds across the cleanup awaits so the pool's poll
        // loop doesn't drop us mid-retry. On final-fail we delete it.
        this.dlog('orch', 'attempt_setup_failed', {
          agentId: task.agentId,
          attempt,
          totalAttempts,
          err: err instanceof Error ? err.message : String(err),
        });
        if (this.activeAgents.delete(task.agentId)) {
          this.autoScaler.notifyAgentCompleted();
        }
        this.spawningIds.add(task.agentId);
        if (agent) {
          try {
            await agent.dispose();
          } catch {
            /* best effort */
          }
        }
        try {
          await this.worktreeManager!.removeAgentWorktree(task.agentId, attempt);
        } catch {
          /* best effort */
        }
        if (attemptBranchName) {
          try {
            await git.deleteBranch(attemptBranchName);
          } catch {
            /* best effort */
          }
        }

        if (attempt >= totalAttempts) {
          this.spawningIds.delete(task.agentId);
          this.portAllocator.release(task.agentId);
          this.updateAgentStatus(task.agentId, {
            state: 'error',
            phase: 'error',
            error: err instanceof Error ? err.message : String(err),
            errorKind: 'failed',
          });
          this.completedTasks++;
          this.appendManifestEntry(task.agentId);
          this.poolWakeup?.();
          return;
        }

        this.log({
          level: 'warn',
          message: `agent ${task.agentId} setup failed on attempt ${attempt}/${totalAttempts}: ${err instanceof Error ? err.message : String(err)}; retrying`,
          agentId: task.agentId,
        });
        this.emit();
      }
    }
  }

  private async finalizeAgent(agentId: number): Promise<void> {
    const status = this.agents.get(agentId);
    if (!status || !status.worktreePath) return;
    const git = this.worktreeManager!.getGitClient();
    let noChanges = false;

    this.dlog('orch', 'finalize_start', {
      agentId,
      worktreePath: status.worktreePath,
      stageIndex: status.stageIndex,
      stageName: status.stageName,
    });

    try {
      this.updateAgentStatus(agentId, { phase: 'finalizing' });
      noChanges = !(await git.hasChanges(status.worktreePath));
      this.dlog('orch', 'finalize_changes_check', { agentId, noChanges });
      if (noChanges) {
        this.updateAgentStatus(agentId, { phase: 'no_changes' });
      } else {
        this.updateAgentStatus(agentId, { phase: 'committing' });
        const changed = await git.getChangedFiles(status.worktreePath);
        await git.stageAll(status.worktreePath);
        const commitMsg = `[${this.pipeline.name}] ${status.stageName} (agent ${agentId})`;
        const commitSha = await git.commitNoVerify(status.worktreePath, commitMsg);
        this.dlog('orch', 'finalize_committed', {
          agentId,
          commitSha,
          fileCount: changed.length,
        });
        this.updateAgentStatus(agentId, {
          commitSha,
          filesModified: changed,
        });
      }

      this.updateAgentStatus(agentId, { phase: 'cleaning_up' });
      await this.worktreeManager!.removeAgentWorktree(agentId);
      this.dlog('orch', 'finalize_done', {
        agentId,
        noChanges,
        commitSha: status.commitSha,
      });
      // Preserve the no_changes phase as the terminal state for "agent ran
      // but produced nothing". Overwriting it with `done` collapsed two
      // distinct outcomes into one in the manifest and the kanban, making
      // diagnosis ("did the agent skip silently?") harder.
      this.updateAgentStatus(agentId, {
        phase: noChanges ? 'no_changes' : 'done',
        state: 'done',
      });
    } catch (err) {
      // Capture the failure with full context so post-mortem can tell
      // "commit failed because the worktree was already gone" from
      // "git lock contention" — the bare error message often elides
      // which step we were on when it threw.
      this.dlog('orch', 'finalize_failed', {
        agentId,
        worktreePath: status.worktreePath,
        commitSoFar: status.commitSha,
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      this.updateAgentStatus(agentId, {
        phase: 'error',
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.portAllocator.release(agentId);
      this.completedTasks++;
      this.appendManifestEntry(agentId);
      this.autoScaler.notifyAgentCompleted();
      this.emit();
    }
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

  private async runStageIntegration(stageTasks: AgentTask[], visitIndex: number): Promise<boolean> {
    const integrationPath = this.manifest!.integrationWorktreePath;
    const integrationBranch = this.manifest!.integrationBranch;
    const repoRoot = this.preflight!.repoRoot;
    const runId = this.manifest!.runId;

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
      return true;
    }

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
        onPhase: () => {
          this.upsertStageIntegration(visitIndex, {
            phase: 'conflict_resolving',
            resolverUsed: true,
          });
        },
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
      return resolution.success;
    }

    // No resolver — deterministic only. `hasIssues` reflects THIS stage only;
    // older versions used the cumulative `this.integrationStatus`, which made
    // a clean stage 2 fail if stage 1 had any conflict/pending — even when the
    // resolver path elsewhere had already handled it.
    const stageStatus = await mergeAgentBranches(eligibleEntries, integrationPath, repoRoot);
    this.mergeIntegrationStatus(stageStatus);
    const hasIssues =
      stageStatus.conflicts.length > 0 ||
      stageStatus.branchesPending.length > 0;
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
    return !hasIssues;
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
      case 'state_change':
        this.updateAgentStatus(agentId, { state: event.state, phase: event.state });
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
    for (const task of tasks) {
      if (memoryHints) task.hint = memoryHints.get(task.files[0] ?? '');
      task.branchName = agentBranchName(runId, task.agentId);
      task.worktreePath = agentWorktreePath(this.preflight!.repoRoot, runId, task.agentId);
      this.agents.set(task.agentId, this.initialAgentStatus(task));
    }
    this.totalTasksAcrossStages += tasks.length;
    return { tasks, fatal: false };
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
    const merged = await this.runStageIntegration(stageTasks, visitIndex);
    if (!merged && !this.continueOnConflict) {
      traceEntry.finishedAt = Date.now();
      this.recordRunError(
        `stage integration failed: unresolved merge conflicts in "${workStep.name}" — parallel agents edited the same lines. Narrow each task's write surface (per-file prompts should write ONLY to $file), or set pipeline.integrationModelId to a stronger conflict-resolver model. Note: the stub backend never resolves conflicts by design (docs/troubleshooting.md#merge-conflicts)`,
      );
      return false;
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
    const { runId, integration, tasksByStepName, stepIndexByName, maxNodeExecutions } = args;
    const steps = this.pipeline.steps;
    const done = new Set<string>();
    const pending = new Set(steps.map((s) => s.name));
    let visitIndex = 0;
    let wave = 0;

    const activate = (target: string): void => {
      if (!stepIndexByName.has(target)) {
        this.log({ level: 'warn', message: `activation target "${target}" is not a step; ignoring` });
        return;
      }
      for (const name of [target, ...descendantsOf(steps, target)]) {
        done.delete(name);
        pending.add(name);
      }
    };

    while (pending.size > 0 && !this.aborted) {
      const ready = computeWave(steps, done, pending);
      if (ready.length === 0) {
        this.log({
          level: 'warn',
          message: `no runnable step remains; skipping: ${[...pending].join(', ')}`,
        });
        break;
      }
      if (visitIndex + ready.length > maxNodeExecutions) {
        this.recordRunError(
          `pipeline exceeded maxNodeExecutions=${maxNodeExecutions} — raise pipeline.maxNodeExecutions, or break the activation loop: an outcome/next that keeps re-pending its downstream cone re-runs it every wave (docs/troubleshooting.md#runaway-loop)`,
        );
        return;
      }
      wave += 1;
      this.currentWave = wave;

      const first = ready[0]!;
      if (isCheckStep(first)) {
        const stepIdx = stepIndexByName.get(first.name)!;
        visitIndex += 1;
        const runs = (this.runsByStep.get(first.name) ?? 0) + 1;
        this.runsByStep.set(first.name, runs);
        this.currentStage = visitIndex;
        const traceEntry: ExecutionTraceEntry = {
          visitIndex,
          stepName: first.name,
          stepType: 'check',
          runs,
          startedAt: Date.now(),
        };
        this.executionTrace.push(traceEntry);
        const next = await this.runCheckVisit(
          first, stepIdx, visitIndex, runs, integration, runId, traceEntry,
        );
        pending.delete(first.name);
        done.add(first.name);
        activate(next);
        this.emit();
        continue;
      }

      // Work wave: prepare every ready step, run ONE shared pool, then
      // merge each step sequentially in array order.
      interface WavePrep {
        step: WorkStep;
        stepIdx: number;
        visitIndex: number;
        runs: number;
        tasks: AgentTask[];
        traceEntry: ExecutionTraceEntry;
      }
      const preps: WavePrep[] = [];
      let fatal = false;
      for (const s of ready) {
        const workStep = s as WorkStep;
        const stepIdx = stepIndexByName.get(workStep.name)!;
        visitIndex += 1;
        const runs = (this.runsByStep.get(workStep.name) ?? 0) + 1;
        this.runsByStep.set(workStep.name, runs);
        this.currentStage = visitIndex;
        const traceEntry: ExecutionTraceEntry = {
          visitIndex,
          stepName: workStep.name,
          stepType: 'work',
          runs,
          startedAt: Date.now(),
        };
        this.executionTrace.push(traceEntry);
        let tasks = runs === 1 ? tasksByStepName.get(workStep.name) : undefined;
        if (!tasks) {
          const prep = this.prepareStageTasks(workStep, stepIdx, runId);
          if (prep.fatal) {
            fatal = true;
            break;
          }
          tasks = prep.tasks;
        }
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
        preps.push({ step: workStep, stepIdx, visitIndex, runs, tasks, traceEntry });
      }
      if (fatal) return;

      const union = preps.flatMap((p) => p.tasks);
      this.log({
        level: 'info',
        message: `=== wave ${wave}: ${preps.map((p) => `"${p.step.name}"`).join(' + ')} — ${union.length} task(s), one pool`,
      });
      this.emit();

      await this.executeTaskPool(union);
      if (this.aborted) return;

      for (const p of preps) {
        const ok = await this.mergeStepVisit(
          p.step, p.visitIndex, p.runs, p.tasks, integration, p.traceEntry,
        );
        if (!ok) return;
        pending.delete(p.step.name);
        done.add(p.step.name);
        if (p.step.next !== undefined) {
          // In DAG mode `next` is an activation edge (loops), never a skip.
          activate(p.step.next);
        }
      }
      this.emit();
    }
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
    };
    this.manifest.agentEntries.push(entry);
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
