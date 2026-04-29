import type {
  AgentStatus,
  AgentTask,
  AppConfig,
  IntegrationStatus,
  LogEntry,
  OrchestratorResult,
  OrchestratorState,
  Pipeline,
  PreflightResult,
  PromptStep,
  RunManifest,
  AgentManifestEntry,
  AgentLifecyclePhase,
} from '../lib/types.js';
import {
  DEFAULT_CARD_TIMEOUT_MS,
  DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
} from '../lib/types.js';
import { runPreflight } from '../git/preflight.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { agentBranchName, agentWorktreePath } from '../git/branch-namer.js';
import { mergeAgentBranches } from '../git/integration-merge.js';
import { decomposeTasks } from './task-decomposer.js';
import type { AgentEvent, AgentFactory, SpawnedAgent } from './types.js';
import { generateRunId } from '../lib/run-id.js';
import { RunLogger, RUN_LOG_DIR } from '../lib/run-logger.js';
import { runStageIntegrationWithResolver } from './integration-agent.js';
import { PortAllocator } from './port-allocator.js';
import {
  AGENT_BIN_DIR,
  AGENT_ENV_FILE,
  writeAgentBinShim,
  writeAgentEnvFile,
} from './agent-env.js';
import { ensureNativeShim, type NativeShim } from './native-shim.js';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { log as dlog } from '../lib/debug-logger.js';

function ensureGitignored(repoRoot: string, line: string): void {
  const gitignorePath = join(repoRoot, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, line + '\n', 'utf8');
    return;
  }
  const existing = readFileSync(gitignorePath, 'utf8');
  const normalizedLines = existing.split(/\r?\n/);
  if (normalizedLines.some((l) => l.trim() === line.trim())) return;
  const sep = existing.endsWith('\n') ? '' : '\n';
  appendFileSync(gitignorePath, sep + line + '\n', 'utf8');
}

export type OrchestratorSubscriber = (state: OrchestratorState) => void;

const DEFAULT_CONCURRENCY = 10;
const MAX_INSTANCES = 20;
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
  private pendingTasks: AgentTask[] = [];
  private logs: LogEntry[] = [];
  private completedTasks = 0;
  private totalTasksAcrossStages = 0;
  private currentStage = 0;
  private totalStages: number;
  private instanceCount: number;
  private continueOnConflict: boolean;
  private conflictResolverFactory?: AgentFactory;
  private startedAt = 0;
  private subscribers: Set<OrchestratorSubscriber> = new Set();
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

  constructor(
    private config: AppConfig,
    private pipeline: Pipeline,
    private cwd: string,
    private agentFactory: AgentFactory,
    options: OrchestratorOptions = {},
  ) {
    this.totalStages = pipeline.steps.length;
    this.instanceCount = options.initialConcurrency ?? DEFAULT_CONCURRENCY;
    this.continueOnConflict = options.continueOnConflict ?? false;
    this.conflictResolverFactory = options.conflictResolverFactory;
    this.portAllocator = new PortAllocator({
      basePort: pipeline.portAllocation?.basePort,
      windowSize: pipeline.portAllocation?.windowSize,
      enabled: pipeline.portAllocation?.enabled ?? true,
      maxAgents: MAX_INSTANCES,
    });
  }

  subscribe(handler: OrchestratorSubscriber): () => void {
    this.subscribers.add(handler);
    handler(this.getState());
    return () => this.subscribers.delete(handler);
  }

  getState(): OrchestratorState {
    return {
      status: this.status,
      runId: this.manifest?.runId ?? '',
      agents: Array.from(this.agents.values()),
      logs: this.logs.slice(-200),
      totalCost: 0, // M5 will populate
      completedTasks: this.completedTasks,
      totalTasks: this.totalTasksAcrossStages,
      integrationStatus: this.integrationStatus,
      startedAt: this.startedAt,
      elapsedMs: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      concurrency: this.instanceCount,
      currentStage: this.currentStage,
      totalStages: this.totalStages,
    };
  }

  increaseConcurrency(): void {
    this.setConcurrency(this.instanceCount + 1);
  }

  decreaseConcurrency(): void {
    this.setConcurrency(this.instanceCount - 1);
  }

  setConcurrency(value: number): void {
    const clamped = Math.max(MIN_INSTANCES, Math.min(MAX_INSTANCES, value));
    if (clamped === this.instanceCount) return;
    this.instanceCount = clamped;
    this.log({ level: 'info', message: `concurrency set to ${clamped}` });
    this.poolWakeup?.();
    this.emit();
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    dlog('orch', 'abort_requested', { activeAgents: this.activeAgents.size });
    this.log({ level: 'warn', message: 'abort requested' });
    // Tear down currently-streaming agents so their prompt() resolves
    // immediately. Without this, Q feels frozen for several seconds because
    // executeTaskPool's poll waits for the active agents to finish naturally.
    for (const [agentId, agent] of this.activeAgents) {
      try {
        void agent.dispose();
      } catch {
        /* best-effort */
      }
      this.activeAgents.delete(agentId);
      this.portAllocator.release(agentId);
    }
    // Hard reset the allocator so a stuck reservation from a queued/finalizing
    // task doesn't survive into a subsequent run with the same agent ids.
    this.portAllocator.releaseAll();
    this.poolWakeup?.();
  }

  async start(): Promise<OrchestratorResult> {
    if (this.status !== 'idle') throw new Error('Orchestrator already running');
    this.startedAt = Date.now();
    this.status = 'starting';
    this.emit();

    try {
      dlog('orch', 'preflight_start', { cwd: this.cwd });
      const preflightStartedAt = Date.now();
      this.preflight = await runPreflight(this.cwd);
      dlog('orch', 'preflight_end', {
        durationMs: Date.now() - preflightStartedAt,
        valid: this.preflight.valid,
        errors: this.preflight.errors,
        warnings: this.preflight.warnings,
      });
      if (!this.preflight.valid) {
        throw new Error(`Preflight failed: ${this.preflight.errors.join('; ')}`);
      }
      const runId = generateRunId();
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
      );
      dlog('orch', 'integration_worktree_create_start');
      const intStartedAt = Date.now();
      const integration = await this.worktreeManager.createIntegrationWorktree();
      dlog('orch', 'integration_worktree_create_end', {
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

      // Pre-decompose all stages so every card is visible from the start (TODO
      // column), and moves to DOING/DONE as agents progress. Without this, the
      // dashboard only reveals upcoming-stage cards when each stage begins.
      const tasksByStage: AgentTask[][] = [];
      this.totalTasksAcrossStages = 0;
      for (let stageIdx = 0; stageIdx < this.totalStages; stageIdx++) {
        const step = this.pipeline.steps[stageIdx]!;
        const stageTasks = decomposeTasks(step.files, this.nextAgentId, stageIdx, step.name);
        this.nextAgentId += stageTasks.length;
        for (const task of stageTasks) {
          task.branchName = agentBranchName(runId, task.agentId);
          task.worktreePath = agentWorktreePath(this.preflight.repoRoot, runId, task.agentId);
          this.agents.set(task.agentId, this.initialAgentStatus(task));
        }
        tasksByStage.push(stageTasks);
        this.totalTasksAcrossStages += stageTasks.length;
      }
      this.emit();

      for (let stageIdx = 0; stageIdx < this.totalStages; stageIdx++) {
        if (this.aborted) break;

        const step = this.pipeline.steps[stageIdx]!;
        const stageTasks = tasksByStage[stageIdx]!;
        this.currentStage = stageIdx + 1;
        this.log({ level: 'info', message: `=== stage ${this.currentStage}/${this.totalStages}: ${step.name}` });
        this.emit();

        await this.executeTaskPool(stageTasks, step);

        if (this.aborted) break;

        // Stage integration
        this.status = 'integrating';
        this.emit();
        const merged = await this.runStageIntegration(stageTasks);
        if (!merged && !this.continueOnConflict) {
          this.status = 'error';
          this.log({ level: 'error', message: 'stage integration failed (conflicts unresolved)' });
          this.emit();
          break;
        }

        // Update stage base ref to integration HEAD (next stage branches from here).
        // The contract is: stage N+1's worktrees branch from the integration
        // branch's HEAD AFTER stage N's merge. If we can't read that HEAD, the
        // integration worktree is in an inconsistent state — we have no known-good
        // base for the next stage. Fail loud rather than silently branching
        // from the previous (or original baseCommit) ref.
        const previousBaseRef = this.stageBaseRef;
        try {
          this.stageBaseRef = await this.worktreeManager.getGitClient().getHead(integration.worktreePath);
          this.manifest.stageBaseCommits!.push(this.stageBaseRef);
        } catch (err) {
          this.status = 'error';
          this.log({
            level: 'error',
            message: `cannot read integration HEAD after stage ${this.currentStage}: ${err instanceof Error ? err.message : String(err)}. Next stage cannot branch from a known-good base; aborting run.`,
          });
          this.emit();
          break;
        }
        dlog('orch', 'stage_advance', {
          stageIdx: stageIdx,
          stageName: step.name,
          previousBaseRef,
          newBaseRef: this.stageBaseRef,
          stageTaskCount: stageTasks.length,
        });
        this.log({
          level: 'info',
          message: `stage ${this.currentStage}/${this.totalStages} done; next stage branches from ${this.stageBaseRef.slice(0, 8)} (previous base: ${previousBaseRef.slice(0, 8)})`,
        });
        this.status = 'running';
        this.emit();
      }

      // Cleanup
      try {
        await this.worktreeManager.removeIntegrationWorktree();
      } catch {
        /* best effort */
      }

      if (this.status !== 'error' && !this.aborted) {
        this.status = 'done';
      } else if (this.aborted && this.status !== 'error') {
        this.status = 'done';
      }
      if (this.manifest) {
        this.manifest.finishedAt = Date.now();
        this.manifest.status = this.status === 'done' ? 'done' : 'error';
      }
      this.emit();

      return {
        runId,
        agents: Array.from(this.agents.values()),
        logs: this.logs,
        totalCost: 0,
        filesModified: this.collectFilesModified(),
        conflicts: this.integrationStatus.conflicts.map((c) => ({ file: c.file, agents: [] })),
        duration: Date.now() - this.startedAt,
        manifest: this.manifest!,
        integration: this.integrationStatus,
      };
    } catch (err) {
      this.status = 'error';
      this.log({ level: 'error', message: err instanceof Error ? err.message : String(err) });
      if (this.manifest) {
        this.manifest.finishedAt = this.manifest.finishedAt ?? Date.now();
        this.manifest.status = 'error';
      }
      this.emit();
      throw err;
    } finally {
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

  private async executeTaskPool(tasks: AgentTask[], step: PromptStep): Promise<void> {
    this.pendingTasks = [...tasks];

    while (
      !this.aborted &&
      (this.pendingTasks.length > 0 || this.activeAgents.size > 0 || this.spawningIds.size > 0 || this.finalizingIds.size > 0)
    ) {
      // Spawn replacements up to instanceCount
      const busyCount = this.activeAgents.size + this.spawningIds.size;
      const slotsAvailable = Math.max(0, this.instanceCount - busyCount);
      for (let i = 0; i < slotsAvailable && this.pendingTasks.length > 0; i++) {
        const task = this.pendingTasks.shift()!;
        // spawnAndRun owns its own try/catches; this outer .catch() is the
        // safety net for an error that escapes ALL of them — typically a
        // synchronous throw before the first await (e.g., an unexpected
        // factory shape, or getGitClient() blowing up). Without bumping
        // completedTasks and clearing every queue here, the pool's poll loop
        // could otherwise see a "ghost" task forever and never exit.
        this.spawnAndRun(task, step).catch((err) => {
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

  private async spawnAndRun(task: AgentTask, step: PromptStep): Promise<void> {
    const maxRetries = this.pipeline.maxRetries ?? DEFAULT_MAX_RETRIES;
    const totalAttempts = 1 + maxRetries;
    const timeoutMs = computeCardTimeoutMs(task, this.pipeline);
    const git = this.worktreeManager!.getGitClient();
    dlog('orch', 'spawn_start', {
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
        dlog('orch', 'worktree_ready', {
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
          const isTimeout = err instanceof TimeoutError;
          dlog('orch', 'attempt_failed', {
            agentId: task.agentId,
            attempt,
            totalAttempts,
            kind: isTimeout ? 'timeout' : 'failed',
            timeoutMs,
            err: err instanceof Error ? err.message : String(err),
          });
          this.activeAgents.delete(task.agentId);
          this.spawningIds.add(task.agentId);
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

        void this.finalizeAgent(task.agentId).finally(() => {
          this.finalizingIds.delete(task.agentId);
          this.poolWakeup?.();
        });
        return;
      } catch (err) {
        // Setup failure (worktree creation, agent factory). Treat as a failed
        // attempt — clean up partials and decide retry vs final-fail. Keep
        // task in spawningIds across the cleanup awaits so the pool's poll
        // loop doesn't drop us mid-retry. On final-fail we delete it.
        dlog('orch', 'attempt_setup_failed', {
          agentId: task.agentId,
          attempt,
          totalAttempts,
          err: err instanceof Error ? err.message : String(err),
        });
        this.activeAgents.delete(task.agentId);
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

    try {
      this.updateAgentStatus(agentId, { phase: 'finalizing' });
      noChanges = !(await git.hasChanges(status.worktreePath));
      if (noChanges) {
        this.updateAgentStatus(agentId, { phase: 'no_changes' });
      } else {
        this.updateAgentStatus(agentId, { phase: 'committing' });
        const changed = await git.getChangedFiles(status.worktreePath);
        await git.stageAll(status.worktreePath);
        const commitMsg = `[${this.pipeline.name}] ${status.stageName} (agent ${agentId})`;
        const commitSha = await git.commitNoVerify(status.worktreePath, commitMsg);
        this.updateAgentStatus(agentId, {
          commitSha,
          filesModified: changed,
        });
      }

      this.updateAgentStatus(agentId, { phase: 'cleaning_up' });
      await this.worktreeManager!.removeAgentWorktree(agentId);
      // Preserve the no_changes phase as the terminal state for "agent ran
      // but produced nothing". Overwriting it with `done` collapsed two
      // distinct outcomes into one in the manifest and the kanban, making
      // diagnosis ("did the agent skip silently?") harder.
      this.updateAgentStatus(agentId, {
        phase: noChanges ? 'no_changes' : 'done',
        state: 'done',
      });
    } catch (err) {
      this.updateAgentStatus(agentId, {
        phase: 'error',
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.portAllocator.release(agentId);
      this.completedTasks++;
      this.appendManifestEntry(agentId);
      this.emit();
    }
  }

  private async runStageIntegration(stageTasks: AgentTask[]): Promise<boolean> {
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
      return true;
    }

    if (this.conflictResolverFactory) {
      // LLM-resolved path: try deterministic merge, then fall back to integration agent.
      const resolution = await runStageIntegrationWithResolver(eligibleEntries, {
        repoRoot,
        integrationWorktreePath: integrationPath,
        integrationBranch,
        runId,
        config: this.config,
        resolverFactory: this.conflictResolverFactory,
        onEvent: (agentId, event) => {
          // Forward integration-agent events into the run logs.
          // Integration agent uses the reserved id 9999.
          if (event.type === 'log') {
            this.log({
              level: event.level ?? 'info',
              message: event.message,
              agentId,
            });
          } else if (event.type === 'error') {
            this.log({ level: 'error', message: event.message, agentId });
          }
        },
      });
      this.mergeIntegrationStatus(resolution.status);
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
    switch (event.type) {
      case 'log':
        this.log({ level: event.level ?? 'info', message: event.message, agentId });
        this.appendAgentLog(agentId, event.message);
        break;
      case 'state_change':
        this.updateAgentStatus(agentId, { state: event.state, phase: event.state });
        break;
      case 'file_write':
        this.appendAgentLog(agentId, `wrote ${event.file}`);
        break;
      case 'done':
        this.updateAgentStatus(agentId, { state: 'done' });
        break;
      case 'error':
        this.updateAgentStatus(agentId, { state: 'error', error: event.message });
        this.log({ level: 'error', message: event.message, agentId });
        break;
    }
    this.emit();
  }

  // --- Helpers ---

  private renderPrompt(step: PromptStep, task: AgentTask): string {
    if (task.files.length === 0) return step.prompt;
    return step.prompt.replaceAll('$file', task.files[0]!);
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
    const next = { ...cur, logs: [...cur.logs, message].slice(-100) };
    this.agents.set(agentId, next);
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

  private log(entry: { level: 'info' | 'warn' | 'error' | 'debug'; message: string; agentId?: number }): void {
    const logEntry: LogEntry = {
      timestamp: Date.now(),
      agentId: entry.agentId ?? -1,
      level: entry.level,
      message: entry.message,
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
