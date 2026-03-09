// Orchestrator Loop — FSM + main cycle + backpressure
//
// The showrunner's brain. Coordinates the full lifecycle:
// DECOMPOSE → ASSIGN → MONITOR → COLLECT → MERGE → ADVANCE_BEAT
//
// Invariants:
// 1. No implicit state in volatile memory: progress recoverable from SQLite after crash
// 2. Idempotent message consumption: same message never causes duplicate transition
// 3. Serialized merge on main: merge via MergeManager (mutex in 1.3)
// 4. No event loop blocking: all I/O async, polling via setTimeout (not setInterval)
// 5. No silent failures: every exception → auditable escalation

import type Database from 'better-sqlite3';
import type { SimpleGit } from 'simple-git';
import type { OrchestratorState, OrchestratorConfig, AgentSlot } from '../types/index.js';
import type { AgentDefinition, AgentRunResult } from '../agents/types.js';
import type { RuntimeDeps } from '../agents/runtime.js';
import { spawnAgent } from '../agents/runtime.js';
import type { AtomicTask, BeatSheet } from './beatsheet.js';
import { collectTasks, computeReadySet } from './beatsheet.js';
import { BeatSheetPersistence } from './beatsheet-persistence.js';
import {
  evaluateAllCheckpoints,
  applyCheckpointResults,
  getCurrentCheckpoint,
} from './checkpoints.js';
import type { CheckpointName } from './checkpoints.js';
import { OrchestratorMonitor, parsePayload } from './monitor.js';
import type { ClassifiedMessages } from './monitor.js';
import { HealthChecker, computeLoopDelay, updateHeartbeat } from './health.js';
import type { HealthCheckResult } from './health.js';
import {
  schedule,
  updateReadySince,
} from './scheduler.js';
import type { SchedulerContext, TaskAssignment } from './scheduler.js';
import { EscalationManager, determineAction, classifyEscalation } from './escalations.js';
import type { MergeManager } from '../git/MergeManager.js';
import type { MessageQueue } from '../db/queue.js';
import { onTaskDone as curatorOnTaskDone } from './curator.js';
import type { TaskDoneEvent } from './curator.js';
import { strategicCompact } from './strategic-compact.js';
import { buildContextPack, renderContextPack } from './retrieval-jit.js';

// ── Default configuration ────────────────────────────────────────────

export const DEFAULT_CONFIG: OrchestratorConfig = {
  projectId: 'default',
  maxConcurrentAgents: 5,
  roleCaps: { builder: 3, tester: 2, reviewer: 1 },
  pollIntervalActiveMs: 500,
  pollIntervalIdleMs: 2000,
  stuckTimeoutMs: 45_000,
  maxRetries: 3,
  backpressure: {
    minDelayMs: 250,
    maxDelayMs: 2000,
    loadFactor: 0.1,
  },
};

// ── Loop context ─────────────────────────────────────────────────────

export interface LoopDeps {
  db: Database.Database;
  queue: MessageQueue;
  runtimeDeps: RuntimeDeps;
  mergeManager: MergeManager;
  availableAgents: AgentDefinition[];
}

export interface LoopState {
  fsm: OrchestratorState;
  runId: string;
  projectId: string;
  activeSlots: Map<string, AgentSlot>;
  doneTaskIds: Set<string>;
  failedTaskIds: Set<string>;
  runningTaskIds: Set<string>;
  readySince: Map<string, number>;
  retryCounts: Map<string, number>;
  /** IDs of task_done messages already processed (idempotency). */
  processedDoneIds: Set<number>;
  /** IDs of merge_result messages already processed. */
  processedMergeIds: Set<number>;
  /** Tasks that have been merged successfully. */
  mergedTaskIds: Set<string>;
  tickCount: number;
}

// ── Events (for external consumers like CLI/TUI) ─────────────────────

export type LoopEventType =
  | 'state_change'
  | 'task_assigned'
  | 'task_completed'
  | 'task_failed'
  | 'merge_completed'
  | 'merge_failed'
  | 'beat_advanced'
  | 'escalation'
  | 'health_warning'
  | 'loop_error'
  | 'loop_completed';

export interface LoopEvent {
  type: LoopEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type LoopEventHandler = (event: LoopEvent) => void;

// ── Orchestrator ─────────────────────────────────────────────────────

export class OrchestratorLoop {
  private readonly config: OrchestratorConfig;
  private readonly deps: LoopDeps;
  private readonly state: LoopState;
  private readonly monitor: OrchestratorMonitor;
  private readonly healthChecker: HealthChecker;
  private readonly escalations: EscalationManager;
  private readonly persistence: BeatSheetPersistence;
  private readonly eventHandlers: LoopEventHandler[] = [];

  private beatSheet: BeatSheet | null = null;

  constructor(
    deps: LoopDeps,
    runId: string,
    config?: Partial<OrchestratorConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;

    this.state = {
      fsm: 'DECOMPOSE',
      runId,
      projectId: this.config.projectId,
      activeSlots: new Map(),
      doneTaskIds: new Set(),
      failedTaskIds: new Set(),
      runningTaskIds: new Set(),
      readySince: new Map(),
      retryCounts: new Map(),
      processedDoneIds: new Set(),
      processedMergeIds: new Set(),
      mergedTaskIds: new Set(),
      tickCount: 0,
    };

    this.monitor = new OrchestratorMonitor(deps.db, {
      batchSize: 200,
      messageTypes: [
        'task_progress',
        'task_done',
        'merge_result',
        'escalation',
        'health_check',
        'abort_ack',
      ],
    });

    this.healthChecker = new HealthChecker({
      stuckThresholdMs: this.config.stuckTimeoutMs,
      maxRetries: this.config.maxRetries,
    });

    this.escalations = new EscalationManager(
      deps.queue,
      this.config.projectId,
    );

    this.persistence = new BeatSheetPersistence(deps.db);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Register an event handler for loop events.
   */
  on(handler: LoopEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Get current FSM state.
   */
  getState(): OrchestratorState {
    return this.state.fsm;
  }

  /**
   * Get current loop state (for status/testing).
   */
  getLoopState(): Readonly<LoopState> {
    return this.state;
  }

  /**
   * Get the current beat sheet.
   */
  getBeatSheet(): BeatSheet | null {
    return this.beatSheet;
  }

  /**
   * Set the beat sheet (used when decomposition happens externally,
   * e.g., from a planner agent or CLI input).
   */
  setBeatSheet(sheet: BeatSheet): void {
    this.beatSheet = sheet;
    this.persistence.save(this.state.projectId, this.state.runId, sheet);
  }

  /**
   * Run the orchestrator loop until completion, failure, or abort.
   */
  async run(signal: AbortSignal): Promise<OrchestratorState> {
    while (!signal.aborted) {
      const startedAt = Date.now();

      try {
        await this.tick(signal);
      } catch (err) {
        this.escalations.raiseLoopError(err, this.state.runId);
        this.emit('loop_error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Terminal states
      if (this.state.fsm === 'COMPLETED' || this.state.fsm === 'FAILED') {
        break;
      }

      // Backpressure delay
      const tickDuration = Date.now() - startedAt;
      const delay = computeLoopDelay(
        this.state.activeSlots.size,
        this.config.maxConcurrentAgents,
        tickDuration,
        this.config.backpressure,
      );

      await sleep(delay, signal);
    }

    return this.state.fsm;
  }

  /**
   * Execute a single tick of the orchestrator loop.
   * Public for testing; normally called by run().
   */
  async tick(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;

    this.state.tickCount++;

    switch (this.state.fsm) {
      case 'DECOMPOSE':
        await this.handleDecompose();
        break;
      case 'ASSIGN':
        await this.handleAssign(signal);
        break;
      case 'MONITOR':
        await this.handleMonitor();
        break;
      case 'COLLECT':
        await this.handleCollect();
        break;
      case 'MERGE':
        await this.handleMerge();
        break;
      case 'ADVANCE_BEAT':
        await this.handleAdvanceBeat();
        break;
      case 'ESCALATED':
        await this.handleEscalated();
        break;
      case 'FAILED':
      case 'COMPLETED':
        // Terminal — no-op
        break;
    }
  }

  // ── FSM handlers ───────────────────────────────────────────────────

  private async handleDecompose(): Promise<void> {
    // Load or verify beat sheet exists
    if (!this.beatSheet) {
      const loaded = this.persistence.load(this.state.projectId);
      if (loaded) {
        this.beatSheet = loaded;
      } else {
        // No beat sheet yet — wait for external decomposition
        // In a full system, this would invoke the planner agent
        this.emit('state_change', { state: 'DECOMPOSE', waiting: 'beat_sheet' });
        return;
      }
    }

    // Synchronize task states from beat sheet
    this.syncTaskStates();

    this.transition('ASSIGN');
  }

  private async handleAssign(signal: AbortSignal): Promise<void> {
    if (!this.beatSheet) {
      this.transition('DECOMPOSE');
      return;
    }

    const allTasks = collectTasks(this.beatSheet);
    const now = Date.now();

    // Update aging tracker
    updateReadySince(
      allTasks,
      this.state.doneTaskIds,
      this.state.runningTaskIds,
      this.state.readySince,
      now,
    );

    const ctx: SchedulerContext = {
      allTasks,
      doneTaskIds: this.state.doneTaskIds,
      runningTaskIds: this.state.runningTaskIds,
      activeSlots: this.state.activeSlots,
      availableAgents: this.deps.availableAgents,
      config: this.config,
      readySince: this.state.readySince,
      retryCounts: this.state.retryCounts,
      now,
    };

    const assignments = schedule(ctx);

    if (assignments.length === 0) {
      // Nothing to assign
      if (this.state.activeSlots.size > 0) {
        // Agents running, go monitor
        this.transition('MONITOR');
      } else if (this.isAllDone()) {
        // Everything done, advance
        this.transition('ADVANCE_BEAT');
      } else if (this.escalations.hasCriticalOpen()) {
        this.transition('ESCALATED');
      } else {
        // Nothing ready, nothing running — check for deadlock
        const readyTasks = computeReadySet(allTasks, this.state.doneTaskIds);
        if (readyTasks.length === 0 && !this.isAllDone()) {
          // Potential deadlock — all remaining tasks have unmet deps
          this.escalations.raise(
            {
              runId: this.state.runId,
              error: 'No tasks are ready and no agents are running — possible dependency deadlock',
              context: {
                doneCount: this.state.doneTaskIds.size,
                failedCount: this.state.failedTaskIds.size,
                totalTasks: allTasks.length,
              },
            },
            0,
            this.config.maxRetries,
          );
          this.transition('ESCALATED');
        } else {
          // Tasks are ready but we can't assign (capacity?) — monitor
          this.transition('MONITOR');
        }
      }
      return;
    }

    // Spawn agents for assignments
    for (const assignment of assignments) {
      await this.spawnForAssignment(assignment, signal);
    }

    this.transition('MONITOR');
  }

  private async handleMonitor(): Promise<void> {
    // 1. Poll for new messages
    const classified = this.monitor.pollAndClassify();

    // 2. Health check
    const now = Date.now();
    const healthResult = this.processHealthChecks(classified, now);

    // 3. Handle health issues
    await this.handleHealthIssues(healthResult);

    // 4. Process heartbeats from task_progress
    this.processHeartbeats(classified, now);

    // 5. If there are actionable messages, transition to COLLECT
    const hasActionable =
      classified.taskDone.length > 0 ||
      classified.mergeResult.length > 0 ||
      classified.escalation.length > 0;

    if (hasActionable) {
      this.transition('COLLECT');
      return;
    }

    // 6. Check if all agents have finished
    if (this.state.activeSlots.size === 0) {
      if (this.isAllDone()) {
        this.transition('ADVANCE_BEAT');
      } else if (this.hasPendingMerges()) {
        this.transition('MERGE');
      } else {
        this.transition('ASSIGN');
      }
      return;
    }

    // Stay in MONITOR
  }

  private async handleCollect(): Promise<void> {
    // Re-poll to get latest messages
    const classified = this.monitor.pollAndClassify();

    // Process task_done messages
    for (const msg of classified.taskDone) {
      if (this.state.processedDoneIds.has(msg.id)) continue;
      this.state.processedDoneIds.add(msg.id);

      const payload = parsePayload(msg);
      const taskId = (msg.correlation_id ?? payload['taskId'] as string | undefined) ?? null;
      const agentRunId = msg.run_id;

      if (taskId) {
        this.state.runningTaskIds.delete(taskId);

        // Remove from active slots
        if (agentRunId) {
          this.state.activeSlots.delete(agentRunId);
        }

        // Mark task as done in beat sheet
        if (this.beatSheet) {
          this.persistence.updateTaskStatus(this.state.projectId, taskId, 'done');
          const allTasks = collectTasks(this.beatSheet);
          const task = allTasks.find(t => t.id === taskId);
          if (task) task.status = 'done';
        }
        this.state.doneTaskIds.add(taskId);

        this.emit('task_completed', {
          taskId,
          agentRunId,
          summary: payload['summary'],
          commitSha: payload['commitSha'],
        });

        // Enqueue merge if there's a commit
        if (typeof payload['commitSha'] === 'string' && agentRunId) {
          try {
            this.deps.mergeManager.enqueue({
              source_branch: `huu-agent/${agentRunId}`,
              source_head_sha: payload['commitSha'] as string,
              target_branch: 'main',
              request_id: `task-${taskId}-${agentRunId}`,
            });

            this.deps.queue.enqueue({
              project_id: this.state.projectId,
              message_type: 'merge_ready',
              sender_agent: 'orchestrator',
              recipient_agent: 'orchestrator',
              run_id: this.state.runId,
              correlation_id: taskId,
              payload: { taskId, agentRunId },
            });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.escalations.raise(
              { taskId, runId: this.state.runId, error: `Merge enqueue failed: ${errorMsg}` },
              0,
              this.config.maxRetries,
            );
          }
        }

        // ── Context Curator: post-activity hook ──────────────────
        // Runs after every task_done to curate memory (idempotent).
        try {
          const summaryVal = payload['summary'] as string | undefined;
          const commitShaVal = payload['commitSha'] as string | undefined;
          const filesChangedVal = payload['filesChanged'] as string[] | undefined;
          const fileChangeSummaryVal = payload['changed_files'] as TaskDoneEvent['fileChangeSummary'];
          const usageVal = payload['usage'] as TaskDoneEvent['usage'];
          const durationMsVal = payload['durationMs'] as number | undefined;
          const curatorEvt: TaskDoneEvent = {
            taskId,
            agentId: msg.sender_agent,
            runId: agentRunId ?? this.state.runId,
            projectId: this.state.projectId,
            ...(summaryVal !== undefined ? { summary: summaryVal } : {}),
            ...(commitShaVal !== undefined ? { commitSha: commitShaVal } : {}),
            ...(filesChangedVal !== undefined ? { filesChanged: filesChangedVal } : {}),
            ...(fileChangeSummaryVal !== undefined ? { fileChangeSummary: fileChangeSummaryVal } : {}),
            ...(usageVal !== undefined ? { usage: usageVal } : {}),
            ...(durationMsVal !== undefined ? { durationMs: durationMsVal } : {}),
          };
          await curatorOnTaskDone(this.deps.db, curatorEvt);
        } catch (err) {
          // Curator failure is non-fatal but auditable
          this.emit('loop_error', {
            source: 'curator',
            taskId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Process escalation messages
    for (const msg of classified.escalation) {
      const payload = parsePayload(msg);
      const taskId = msg.correlation_id ?? null;
      const agentRunId = msg.run_id;

      if (payload['state'] === 'failed' && taskId) {
        this.state.runningTaskIds.delete(taskId);
        if (agentRunId) {
          this.state.activeSlots.delete(agentRunId);
        }

        const retryCount = this.state.retryCounts.get(taskId) ?? 0;
        const { severity, category } = classifyEscalation(
          (payload['error'] as string) ?? 'unknown',
          retryCount,
        );
        const action = determineAction(severity, category, retryCount, this.config.maxRetries);

        if (action.action === 'retry') {
          this.state.retryCounts.set(taskId, retryCount + 1);
          // Mark task as pending for re-assignment
          if (this.beatSheet) {
            this.persistence.updateTaskStatus(this.state.projectId, taskId, 'pending');
            const allTasks = collectTasks(this.beatSheet);
            const task = allTasks.find(t => t.id === taskId);
            if (task) task.status = 'pending';
          }
        } else if (action.action === 'fail') {
          this.state.failedTaskIds.add(taskId);
          if (this.beatSheet) {
            this.persistence.updateTaskStatus(this.state.projectId, taskId, 'failed');
            const allTasks = collectTasks(this.beatSheet);
            const task = allTasks.find(t => t.id === taskId);
            if (task) task.status = 'failed';
          }
          this.emit('task_failed', { taskId, error: payload['error'] });
        } else {
          // pause_scope or reroute
          this.emit('escalation', {
            taskId,
            severity,
            category,
            action: action.action,
            error: payload['error'],
          });
        }
      }
    }

    // Process abort_ack
    for (const msg of [...classified.other]) {
      if (msg.message_type === 'abort_ack') {
        const agentRunId = msg.run_id;
        const taskId = msg.correlation_id;
        if (agentRunId) {
          this.state.activeSlots.delete(agentRunId);
        }
        if (taskId) {
          this.state.runningTaskIds.delete(taskId);
        }
      }
    }

    // Decide next state
    if (this.hasPendingMerges()) {
      this.transition('MERGE');
    } else if (this.escalations.hasCriticalOpen()) {
      this.transition('ESCALATED');
    } else {
      this.transition('ASSIGN');
    }
  }

  private async handleMerge(): Promise<void> {
    // Process one merge at a time (serialized)
    try {
      const result = await this.deps.mergeManager.processNext();
      if (result) {
        if (result.outcome === 'merged') {
          this.emit('merge_completed', {
            tier: result.tier,
            mode: result.mode,
          });
        } else {
          this.emit('merge_failed', {
            outcome: result.outcome,
            error: result.errorMessage,
            conflicts: result.conflicts,
          });
        }
      }
    } catch (err) {
      this.escalations.raiseLoopError(err, this.state.runId);
    }

    // Check if more merges pending
    if (this.hasPendingMerges()) {
      // Stay in MERGE for next tick
      return;
    }

    if (this.isAllDone()) {
      this.transition('ADVANCE_BEAT');
    } else {
      this.transition('ASSIGN');
    }
  }

  private async handleAdvanceBeat(): Promise<void> {
    if (!this.beatSheet) {
      this.transition('COMPLETED');
      return;
    }

    const allTasks = collectTasks(this.beatSheet);

    // Check if all tasks are resolved (done or failed)
    const allResolved = allTasks.every(
      (t) => t.status === 'done' || t.status === 'failed',
    );

    if (!allResolved) {
      // Not everything is done — go back to assign
      this.transition('ASSIGN');
      return;
    }

    // Evaluate checkpoints
    const prevCheckpoint = getCurrentCheckpoint(this.beatSheet.checkpoints);
    const evaluations = evaluateAllCheckpoints(this.beatSheet);
    const newCheckpoints = applyCheckpointResults(evaluations);
    this.beatSheet.checkpoints = newCheckpoints;
    const newCheckpoint = getCurrentCheckpoint(newCheckpoints);

    // ── Strategic Compact at checkpoint transitions ───────────
    // If we advanced past a checkpoint, trigger compaction.
    if (prevCheckpoint && prevCheckpoint !== newCheckpoint) {
      try {
        strategicCompact(
          this.deps.db,
          this.state.projectId,
          prevCheckpoint,
          this.beatSheet,
        );
      } catch (err) {
        this.emit('loop_error', {
          source: 'strategic_compact',
          checkpoint: prevCheckpoint,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Persist updated beat sheet
    this.persistence.save(this.state.projectId, this.state.runId, this.beatSheet);

    this.emit('beat_advanced', {
      checkpoints: newCheckpoints,
      evaluations: evaluations.map((e) => ({
        name: e.name,
        result: e.result,
      })),
    });

    // All tasks are resolved — the execution phase is done.
    // Checkpoint evaluation is informational at this point;
    // we don't re-decompose when there's nothing left to execute.
    this.transition('COMPLETED');
    this.emit('loop_completed', {
      runId: this.state.runId,
      doneCount: this.state.doneTaskIds.size,
      failedCount: this.state.failedTaskIds.size,
      checkpoints: newCheckpoints,
    });
  }

  private async handleEscalated(): Promise<void> {
    // Check if critical escalations have been resolved
    if (!this.escalations.hasCriticalOpen()) {
      this.transition('ASSIGN');
      return;
    }

    // Check if we should fail entirely
    const openEscalations = this.escalations.getOpen();
    const criticalCount = openEscalations.filter(
      (e) => e.severity === 'critical',
    ).length;

    if (criticalCount >= 3) {
      // Too many critical escalations — fail the loop
      this.transition('FAILED');
      return;
    }

    // Stay escalated, waiting for resolution
    this.emit('state_change', {
      state: 'ESCALATED',
      criticalCount,
      openEscalations: openEscalations.length,
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private transition(to: OrchestratorState): void {
    const from = this.state.fsm;
    if (from === to) return;
    this.state.fsm = to;
    this.emit('state_change', { from, to });
  }

  private emit(type: LoopEventType, data: Record<string, unknown>): void {
    const event: LoopEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors break the loop
      }
    }
  }

  private async spawnForAssignment(
    assignment: TaskAssignment,
    parentSignal: AbortSignal,
  ): Promise<void> {
    const { task, agent } = assignment;
    const abortController = new AbortController();
    const now = Date.now();

    // Mark task as running
    this.state.runningTaskIds.add(task.id);
    if (this.beatSheet) {
      this.persistence.updateTaskStatus(this.state.projectId, task.id, 'running');
      const allTasks = collectTasks(this.beatSheet);
      const t = allTasks.find(tt => tt.id === task.id);
      if (t) t.status = 'running';
    }

    this.emit('task_assigned', {
      taskId: task.id,
      agentName: agent.name,
      score: assignment.score,
    });

    // ── Retrieval JIT: build context pack for this agent ───────
    let scratchpadContext: string | undefined;
    if (this.beatSheet) {
      try {
        const contextPack = buildContextPack(this.deps.db, {
          projectId: this.state.projectId,
          task,
          agentRole: agent.role,
          sheet: this.beatSheet,
        });
        if (contextPack.decisions.length > 0 || contextPack.risks.length > 0) {
          scratchpadContext = renderContextPack(contextPack);
        }
      } catch {
        // JIT retrieval failure is non-fatal
      }
    }

    // Build task prompt with optional JIT context
    let taskPrompt = `Task: ${task.title}\n\nAction: ${task.action}\n\nPrecondition: ${task.precondition}\n\nPostcondition: ${task.postcondition}\n\nVerification: ${task.verification}`;
    if (scratchpadContext) {
      taskPrompt = `<context>\n${scratchpadContext}\n</context>\n\n${taskPrompt}`;
    }

    // Spawn agent asynchronously — don't await, let it run in background
    const spawnPromise = spawnAgent(
      {
        agent,
        taskId: task.id,
        taskPrompt,
        projectId: this.state.projectId,
        parentSignal,
        keepWorktree: true, // Keep worktree for merge
      },
      this.deps.runtimeDeps,
    );

    // We need the runId from the spawn result to track the slot
    // Since spawnAgent generates a runId internally, we track by a temporary id
    // and update when the first task_progress arrives
    spawnPromise
      .then((result: AgentRunResult) => {
        // Register the slot after spawn succeeds (we now have the runId)
        const slot: AgentSlot = {
          runId: result.runId,
          taskId: task.id,
          agentName: agent.name,
          startedAt: now,
          lastHeartbeat: now,
          abortController,
          retryCount: this.state.retryCounts.get(task.id) ?? 0,
        };
        this.state.activeSlots.set(result.runId, slot);

        // If agent already completed by the time we register, handle it
        if (result.status === 'completed' || result.status === 'failed' || result.status === 'aborted') {
          this.state.activeSlots.delete(result.runId);
          if (result.status !== 'completed') {
            this.state.runningTaskIds.delete(task.id);
          }
        }
      })
      .catch((err: unknown) => {
        // Spawn itself failed
        this.state.runningTaskIds.delete(task.id);
        this.escalations.raise(
          {
            taskId: task.id,
            agentName: agent.name,
            runId: this.state.runId,
            error: err instanceof Error ? err : new Error(String(err)),
          },
          this.state.retryCounts.get(task.id) ?? 0,
          this.config.maxRetries,
        );
      });
  }

  private processHeartbeats(classified: ClassifiedMessages, now: number): void {
    for (const msg of classified.taskProgress) {
      const agentRunId = msg.run_id;
      if (agentRunId) {
        const slot = this.state.activeSlots.get(agentRunId);
        if (slot) {
          updateHeartbeat(slot, now);
        }
      }
    }
  }

  private processHealthChecks(
    _classified: ClassifiedMessages,
    now: number,
  ): HealthCheckResult {
    return this.healthChecker.check(this.state.activeSlots, now);
  }

  private async handleHealthIssues(result: HealthCheckResult): Promise<void> {
    for (const report of result.reports) {
      if (report.recommendation === 'abort' || report.recommendation === 'retry') {
        const slot = this.state.activeSlots.get(report.runId);
        if (slot) {
          // Abort the stuck agent
          slot.abortController.abort();
          this.state.activeSlots.delete(report.runId);
          this.state.runningTaskIds.delete(report.taskId);

          if (report.recommendation === 'retry') {
            const retryCount = this.state.retryCounts.get(report.taskId) ?? 0;
            this.state.retryCounts.set(report.taskId, retryCount + 1);
            // Reset task to pending for re-assignment
            if (this.beatSheet) {
              this.persistence.updateTaskStatus(this.state.projectId, report.taskId, 'pending');
              const allTasks = collectTasks(this.beatSheet);
              const task = allTasks.find(t => t.id === report.taskId);
              if (task) task.status = 'pending';
            }
          }

          this.emit('health_warning', {
            taskId: report.taskId,
            agentName: report.agentName,
            status: report.status,
            recommendation: report.recommendation,
            heartbeatAge: report.lastHeartbeatAge,
          });
        }
      } else if (report.recommendation === 'escalate') {
        this.escalations.raise(
          {
            taskId: report.taskId,
            agentName: report.agentName,
            runId: this.state.runId,
            error: `Agent ${report.agentName} stuck/dead after ${report.retryCount} retries`,
          },
          report.retryCount,
          this.config.maxRetries,
        );
      }
    }
  }

  private syncTaskStates(): void {
    if (!this.beatSheet) return;
    const allTasks = collectTasks(this.beatSheet);
    for (const task of allTasks) {
      if (task.status === 'done') {
        this.state.doneTaskIds.add(task.id);
      } else if (task.status === 'failed') {
        this.state.failedTaskIds.add(task.id);
      }
    }
  }

  private isAllDone(): boolean {
    if (!this.beatSheet) return true;
    const allTasks = collectTasks(this.beatSheet);
    return allTasks.every(
      (t) => t.status === 'done' || t.status === 'failed',
    );
  }

  private hasPendingMerges(): boolean {
    // Check merge queue for pending items
    try {
      const row = this.deps.db
        .prepare(
          `SELECT COUNT(*) as cnt FROM merge_queue
           WHERE status IN ('queued', 'in_progress', 'retry_wait')`,
        )
        .get() as { cnt: number };
      return row.cnt > 0;
    } catch {
      return false;
    }
  }
}

// ── Utility ──────────────────────────────────────────────────────────

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
