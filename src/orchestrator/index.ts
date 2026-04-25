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
import { runPreflight } from '../git/preflight.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { agentBranchName, agentWorktreePath } from '../git/branch-namer.js';
import { mergeAgentBranches } from '../git/integration-merge.js';
import { decomposeTasks } from './task-decomposer.js';
import type { AgentEvent, AgentFactory, SpawnedAgent } from './types.js';
import { generateRunId } from '../lib/run-id.js';
import { runStageIntegrationWithResolver } from './integration-agent.js';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

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

const DEFAULT_CONCURRENCY = 2;
const MAX_INSTANCES = 20;
const MIN_INSTANCES = 1;
const POLL_INTERVAL_MS = 500;

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
    this.aborted = true;
    this.log({ level: 'warn', message: 'abort requested' });
    this.poolWakeup?.();
  }

  async start(): Promise<OrchestratorResult> {
    if (this.status !== 'idle') throw new Error('Orchestrator already running');
    this.startedAt = Date.now();
    this.status = 'starting';
    this.emit();

    try {
      this.preflight = runPreflight(this.cwd);
      if (!this.preflight.valid) {
        throw new Error(`Preflight failed: ${this.preflight.errors.join('; ')}`);
      }
      for (const w of this.preflight.warnings) {
        this.log({ level: 'warn', message: `preflight: ${w}` });
      }
      ensureGitignored(this.preflight.repoRoot, '.programatic-agent-worktrees/');

      const runId = generateRunId();
      this.worktreeManager = new WorktreeManager(
        this.preflight.repoRoot,
        runId,
        this.preflight.baseCommit,
      );
      const integration = this.worktreeManager.createIntegrationWorktree();
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

      // Pre-count tasks for progress display
      this.totalTasksAcrossStages = this.pipeline.steps.reduce(
        (sum, step) => sum + Math.max(1, step.files.length),
        0,
      );

      for (let stageIdx = 0; stageIdx < this.totalStages; stageIdx++) {
        if (this.aborted) break;

        const step = this.pipeline.steps[stageIdx]!;
        this.currentStage = stageIdx + 1;
        this.log({ level: 'info', message: `=== stage ${this.currentStage}/${this.totalStages}: ${step.name}` });
        this.emit();

        const stageTasks = decomposeTasks(step.files, this.nextAgentId, stageIdx, step.name);
        this.nextAgentId += stageTasks.length;

        // Pre-fill branch/worktree paths
        for (const task of stageTasks) {
          task.branchName = agentBranchName(runId, task.agentId);
          task.worktreePath = agentWorktreePath(this.preflight.repoRoot, runId, task.agentId);
          this.agents.set(task.agentId, this.initialAgentStatus(task));
        }
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

        // Update stage base ref to integration HEAD (next stage branches from here)
        try {
          this.stageBaseRef = this.worktreeManager.getGitClient().getHead(integration.worktreePath);
          this.manifest.stageBaseCommits!.push(this.stageBaseRef);
        } catch (err) {
          this.log({ level: 'warn', message: `could not read integration HEAD: ${err}` });
        }
        this.status = 'running';
        this.emit();
      }

      // Cleanup
      try {
        this.worktreeManager.removeIntegrationWorktree();
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
      this.emit();
      throw err;
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
        void this.spawnAndRun(task, step);
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
    this.spawningIds.add(task.agentId);
    try {
      this.updateAgentStatus(task.agentId, { phase: 'worktree_creating' });
      const wt = this.worktreeManager!.createAgentWorktree(task.agentId, this.stageBaseRef);
      this.updateAgentStatus(task.agentId, {
        phase: 'worktree_ready',
        branchName: wt.branchName,
        worktreePath: wt.worktreePath,
      });

      this.updateAgentStatus(task.agentId, { phase: 'session_starting' });
      const agent = await this.agentFactory(
        task,
        this.config,
        this.buildSystemPromptHint(step, task),
        wt.worktreePath,
        (event) => this.handleAgentEvent(task.agentId, event),
      );
      this.activeAgents.set(task.agentId, agent);
      this.spawningIds.delete(task.agentId);

      const renderedPrompt = this.renderPrompt(step, task);
      this.updateAgentStatus(task.agentId, { state: 'streaming', phase: 'streaming' });
      try {
        await agent.prompt(renderedPrompt);
        // If agent didn't emit `done`/`error` itself, we treat resolve as done.
        const status = this.agents.get(task.agentId);
        if (status && status.state !== 'done' && status.state !== 'error') {
          this.updateAgentStatus(task.agentId, { state: 'done' });
        }
      } catch (err) {
        this.updateAgentStatus(task.agentId, {
          state: 'error',
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }

      this.activeAgents.delete(task.agentId);
      await agent.dispose();

      // Background finalize
      this.finalizingIds.add(task.agentId);
      void this.finalizeAgent(task.agentId).finally(() => {
        this.finalizingIds.delete(task.agentId);
        this.poolWakeup?.();
      });
    } catch (err) {
      this.spawningIds.delete(task.agentId);
      this.updateAgentStatus(task.agentId, {
        state: 'error',
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      this.poolWakeup?.();
    }
  }

  private async finalizeAgent(agentId: number): Promise<void> {
    const status = this.agents.get(agentId);
    if (!status || !status.worktreePath) return;
    const git = this.worktreeManager!.getGitClient();

    try {
      this.updateAgentStatus(agentId, { phase: 'finalizing' });
      if (!git.hasChanges(status.worktreePath)) {
        this.updateAgentStatus(agentId, { phase: 'no_changes' });
      } else {
        this.updateAgentStatus(agentId, { phase: 'committing' });
        const changed = git.getChangedFiles(status.worktreePath);
        git.stageAll(status.worktreePath);
        const commitMsg = `[${this.pipeline.name}] ${status.stageName} (agent ${agentId})`;
        const commitSha = git.commitNoVerify(status.worktreePath, commitMsg);
        this.updateAgentStatus(agentId, {
          commitSha,
          filesModified: changed,
        });
      }

      this.updateAgentStatus(agentId, { phase: 'cleaning_up' });
      this.worktreeManager!.removeAgentWorktree(agentId);
      this.updateAgentStatus(agentId, { phase: 'done', state: 'done' });
    } catch (err) {
      this.updateAgentStatus(agentId, {
        phase: 'error',
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
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

    if (eligibleEntries.length === 0) {
      this.log({ level: 'info', message: 'stage produced no commits to merge' });
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
      this.integrationStatus = resolution.status;
      this.log({
        level: resolution.success ? 'info' : 'error',
        message: resolution.success
          ? `stage merged: ${resolution.status.branchesMerged.length} branches${resolution.resolvedConflicts > 0 ? `, ${resolution.resolvedConflicts} conflict(s) resolved by LLM` : ''}`
          : `stage merge failed: ${resolution.errorMessage ?? 'unknown'}`,
      });
      this.emit();
      return resolution.success;
    }

    // No resolver — deterministic only.
    this.integrationStatus = mergeAgentBranches(eligibleEntries, integrationPath, repoRoot);
    this.log({
      level: this.integrationStatus.conflicts.length > 0 ? 'error' : 'info',
      message: `merged ${this.integrationStatus.branchesMerged.length}/${eligibleEntries.length} branches; ${this.integrationStatus.conflicts.length} conflicts`,
    });
    this.emit();
    return this.integrationStatus.conflicts.length === 0;
  }

  // --- Agent event handling ---

  private handleAgentEvent(agentId: number, event: AgentEvent): void {
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
      cleanupDone: status.phase === 'done',
      noChanges: status.phase === 'no_changes',
      error: status.error,
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
    this.logs.push({
      timestamp: Date.now(),
      agentId: entry.agentId ?? -1,
      level: entry.level,
      message: entry.message,
    });
    if (this.logs.length > 1000) this.logs.shift();
  }

  private emit(): void {
    const state = this.getState();
    for (const sub of this.subscribers) sub(state);
  }
}
