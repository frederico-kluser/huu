// Crash recovery — bootstrap + deterministic replay (5.2.1)
//
// Reconstructs orchestrator state from SQLite on startup.
// Uses event log + high-watermark for deterministic replay.
// Idempotency keys prevent duplicate side effects.

import type Database from 'better-sqlite3';
import { RunStateMachine } from './state-machine.js';
import type { RunRecord } from './state-machine.js';

// ── Types ────────────────────────────────────────────────────────────

export interface OrchestratorEvent {
  id: number;
  run_id: string;
  task_id: string | null;
  event_type: string;
  payload_json: string;
  idempotency_key: string | null;
  created_at: string;
}

export interface TaskAttemptRecord {
  run_id: string;
  task_id: string;
  attempt: number;
  state: string;
  agent_name: string | null;
  agent_pid: number | null;
  worktree_path: string | null;
  idempotency_key: string | null;
  heartbeat_at: string;
  started_at: string;
  finished_at: string | null;
  error_text: string | null;
  updated_at: string;
}

export interface RecoveryResult {
  runId: string;
  previousStatus: string;
  eventsReplayed: number;
  taskStates: Map<string, TaskAttemptRecord>;
  recoveryDurationMs: number;
  warnings: string[];
}

export interface RecoverySnapshot {
  run: RunRecord;
  activeAttempts: TaskAttemptRecord[];
  pendingEvents: OrchestratorEvent[];
  highWatermark: number;
}

// ── Event log ────────────────────────────────────────────────────────

export class EventLog {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Append an event to the log. If idempotencyKey already exists for this run,
   * the insert is silently skipped (UNIQUE constraint).
   */
  append(params: {
    runId: string;
    taskId?: string;
    eventType: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  }): number | null {
    const payloadJson = JSON.stringify(params.payload);

    try {
      const result = this.db.prepare(`
        INSERT INTO orchestrator_events (run_id, task_id, event_type, payload_json, idempotency_key)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        params.runId,
        params.taskId ?? null,
        params.eventType,
        payloadJson,
        params.idempotencyKey ?? null,
      );

      return Number(result.lastInsertRowid);
    } catch (err) {
      // UNIQUE constraint violation means idempotent duplicate
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get events after the given high-watermark ID.
   */
  getEventsAfter(runId: string, afterId: number): OrchestratorEvent[] {
    return this.db.prepare(`
      SELECT id, run_id, task_id, event_type, payload_json, idempotency_key, created_at
      FROM orchestrator_events
      WHERE run_id = ? AND id > ?
      ORDER BY id
    `).all(runId, afterId) as OrchestratorEvent[];
  }

  /**
   * Check if an idempotency key has already been processed.
   */
  hasIdempotencyKey(runId: string, key: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM orchestrator_events WHERE run_id = ? AND idempotency_key = ?
    `).get(runId, key);
    return row !== undefined;
  }

  /**
   * Get the highest event ID for a run.
   */
  getMaxEventId(runId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(id), 0) as max_id FROM orchestrator_events WHERE run_id = ?
    `).get(runId) as { max_id: number };
    return row.max_id;
  }
}

// ── Task attempt tracker ─────────────────────────────────────────────

export class TaskAttemptTracker {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Record a new task attempt.
   */
  recordAttempt(params: {
    runId: string;
    taskId: string;
    attempt: number;
    state: string;
    agentName?: string;
    agentPid?: number;
    worktreePath?: string;
    idempotencyKey?: string;
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO task_attempts
        (run_id, task_id, attempt, state, agent_name, agent_pid, worktree_path, idempotency_key, heartbeat_at, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.runId,
      params.taskId,
      params.attempt,
      params.state,
      params.agentName ?? null,
      params.agentPid ?? null,
      params.worktreePath ?? null,
      params.idempotencyKey ?? null,
      now, now, now,
    );
  }

  /**
   * Update task attempt state.
   */
  updateState(runId: string, taskId: string, attempt: number, state: string, errorText?: string): void {
    const now = new Date().toISOString();
    const finishedAt = ['done', 'failed', 'timeout', 'aborted'].includes(state) ? now : null;
    this.db.prepare(`
      UPDATE task_attempts
      SET state = ?, error_text = ?, finished_at = COALESCE(?, finished_at), updated_at = ?
      WHERE run_id = ? AND task_id = ? AND attempt = ?
    `).run(state, errorText ?? null, finishedAt, now, runId, taskId, attempt);
  }

  /**
   * Update heartbeat for a running attempt.
   */
  updateHeartbeat(runId: string, taskId: string, attempt: number): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE task_attempts SET heartbeat_at = ?, updated_at = ?
      WHERE run_id = ? AND task_id = ? AND attempt = ?
    `).run(now, now, runId, taskId, attempt);
  }

  /**
   * Get the latest attempt for a task.
   */
  getLatestAttempt(runId: string, taskId: string): TaskAttemptRecord | undefined {
    return this.db.prepare(`
      SELECT * FROM task_attempts
      WHERE run_id = ? AND task_id = ?
      ORDER BY attempt DESC LIMIT 1
    `).get(runId, taskId) as TaskAttemptRecord | undefined;
  }

  /**
   * Get all active (non-terminal) attempts for a run.
   */
  getActiveAttempts(runId: string): TaskAttemptRecord[] {
    return this.db.prepare(`
      SELECT * FROM task_attempts
      WHERE run_id = ? AND state IN ('assigned', 'running')
      ORDER BY task_id, attempt
    `).all(runId) as TaskAttemptRecord[];
  }

  /**
   * Get stale attempts (no heartbeat within threshold).
   */
  getStaleAttempts(runId: string, staleThresholdMs: number): TaskAttemptRecord[] {
    const cutoff = new Date(Date.now() - staleThresholdMs).toISOString();
    return this.db.prepare(`
      SELECT * FROM task_attempts
      WHERE run_id = ? AND state IN ('assigned', 'running') AND heartbeat_at < ?
      ORDER BY heartbeat_at
    `).all(runId, cutoff) as TaskAttemptRecord[];
  }

  /**
   * Get the current attempt number for a task (for retry counting).
   */
  getAttemptCount(runId: string, taskId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(attempt), 0) as cnt FROM task_attempts WHERE run_id = ? AND task_id = ?
    `).get(runId, taskId) as { cnt: number };
    return row.cnt;
  }

  /**
   * Get all attempts for a run (for recovery snapshot).
   */
  getAllAttempts(runId: string): TaskAttemptRecord[] {
    return this.db.prepare(`
      SELECT * FROM task_attempts WHERE run_id = ? ORDER BY task_id, attempt
    `).all(runId) as TaskAttemptRecord[];
  }
}

// ── Transactional persistence ────────────────────────────────────────

/**
 * Atomically persist a task state transition + event log entry.
 * This is the critical path for crash recovery — both writes must succeed together.
 */
export function persistTaskTransition(
  db: Database.Database,
  params: {
    runId: string;
    taskId: string;
    attempt: number;
    nextState: string;
    eventType: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    errorText?: string;
  },
): void {
  const now = new Date().toISOString();
  const payloadJson = JSON.stringify(params.payload);
  const finishedAt = ['done', 'failed', 'timeout', 'aborted'].includes(params.nextState) ? now : null;

  const doTransition = db.transaction(() => {
    // Update task attempt state
    db.prepare(`
      UPDATE task_attempts
      SET state = ?, error_text = ?, finished_at = COALESCE(?, finished_at), heartbeat_at = ?, updated_at = ?
      WHERE run_id = ? AND task_id = ? AND attempt = ?
    `).run(params.nextState, params.errorText ?? null, finishedAt, now, now, params.runId, params.taskId, params.attempt);

    // Append event (idempotent via UNIQUE constraint)
    db.prepare(`
      INSERT OR IGNORE INTO orchestrator_events (run_id, task_id, event_type, payload_json, idempotency_key)
      VALUES (?, ?, ?, ?, ?)
    `).run(params.runId, params.taskId, params.eventType, payloadJson, params.idempotencyKey);

    // Bump run version
    db.prepare(`
      UPDATE orchestrator_runs SET state_version = state_version + 1, updated_at = ? WHERE run_id = ?
    `).run(now, params.runId);
  });

  doTransition();
}

// ── Recovery engine ──────────────────────────────────────────────────

export class RecoveryEngine {
  private readonly db: Database.Database;
  private readonly stateMachine: RunStateMachine;
  private readonly eventLog: EventLog;
  private readonly attemptTracker: TaskAttemptTracker;

  constructor(db: Database.Database) {
    this.db = db;
    this.stateMachine = new RunStateMachine(db);
    this.eventLog = new EventLog(db);
    this.attemptTracker = new TaskAttemptTracker(db);
  }

  /**
   * Validate database integrity on startup.
   */
  validateIntegrity(): { ok: boolean; error?: string } {
    try {
      const result = this.db.pragma('quick_check') as Array<{ quick_check: string }>;
      const isOk = result.length === 1 && result[0]!.quick_check === 'ok';
      if (!isOk) {
        return { ok: false, error: `Database integrity check failed: ${JSON.stringify(result)}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Integrity check error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * Perform WAL checkpoint.
   */
  checkpoint(mode: 'PASSIVE' | 'FULL' = 'PASSIVE'): void {
    this.db.pragma(`wal_checkpoint(${mode})`);
  }

  /**
   * Recover a previously interrupted run.
   * Returns the recovery result with replayed state.
   */
  recover(runId: string): RecoveryResult {
    const startMs = Date.now();
    const warnings: string[] = [];

    // 1. Get the run record
    const run = this.stateMachine.getRun(runId);
    if (!run) {
      throw new Error(`Run not found for recovery: ${runId}`);
    }

    const previousStatus = run.status;

    // 2. Transition to recovering
    if (run.status !== 'done' && run.status !== 'failed') {
      this.stateMachine.transition(runId, 'recovering', 'crash_recovery');
    }

    // 3. Get events after high-watermark for replay
    const pendingEvents = this.eventLog.getEventsAfter(runId, run.last_applied_event_id);

    // 4. Replay events to reconstruct task states
    const taskStates = new Map<string, TaskAttemptRecord>();

    for (const event of pendingEvents) {
      this.replayEvent(runId, event, taskStates, warnings);
    }

    // 5. Update high-watermark
    if (pendingEvents.length > 0) {
      const maxId = pendingEvents[pendingEvents.length - 1]!.id;
      this.stateMachine.updateHighWatermark(runId, maxId);
    }

    // 6. Mark stale in-progress attempts as timeout
    const activeAttempts = this.attemptTracker.getActiveAttempts(runId);
    for (const attempt of activeAttempts) {
      // Check if PID is alive
      const pidAlive = attempt.agent_pid ? isProcessAlive(attempt.agent_pid) : false;
      if (!pidAlive) {
        this.attemptTracker.updateState(runId, attempt.task_id, attempt.attempt, 'timeout', 'process_not_alive_on_recovery');
        warnings.push(`Task ${attempt.task_id} attempt ${attempt.attempt}: process not alive, marked timeout`);
      }
      taskStates.set(attempt.task_id, this.attemptTracker.getLatestAttempt(runId, attempt.task_id)!);
    }

    // 7. Transition back to running (if not terminal)
    const currentRun = this.stateMachine.getRun(runId)!;
    if (currentRun.status === 'recovering') {
      this.stateMachine.transition(runId, 'running', 'recovery_complete');
    }

    // 8. Log recovery event
    this.eventLog.append({
      runId,
      eventType: 'recovery_completed',
      payload: {
        previousStatus,
        eventsReplayed: pendingEvents.length,
        warningCount: warnings.length,
        recoveryDurationMs: Date.now() - startMs,
      },
      idempotencyKey: `recovery-${runId}-${Date.now()}`,
    });

    return {
      runId,
      previousStatus,
      eventsReplayed: pendingEvents.length,
      taskStates,
      recoveryDurationMs: Date.now() - startMs,
      warnings,
    };
  }

  /**
   * Build a snapshot of the current run state for recovery analysis.
   */
  buildSnapshot(runId: string): RecoverySnapshot | undefined {
    const run = this.stateMachine.getRun(runId);
    if (!run) return undefined;

    return {
      run,
      activeAttempts: this.attemptTracker.getActiveAttempts(runId),
      pendingEvents: this.eventLog.getEventsAfter(runId, run.last_applied_event_id),
      highWatermark: run.last_applied_event_id,
    };
  }

  /**
   * Find and recover the most recent interrupted run for a project.
   */
  findAndRecover(projectId: string): RecoveryResult | undefined {
    const interrupted = this.stateMachine.findInterruptedRuns(projectId);
    if (interrupted.length === 0) return undefined;
    return this.recover(interrupted[0]!.run_id);
  }

  // ── Internal ────────────────────────────────────────────────────────

  private replayEvent(
    runId: string,
    event: OrchestratorEvent,
    taskStates: Map<string, TaskAttemptRecord>,
    warnings: string[],
  ): void {
    if (!event.task_id) return;

    const latest = this.attemptTracker.getLatestAttempt(runId, event.task_id);
    if (latest) {
      taskStates.set(event.task_id, latest);
    }

    // Validate event consistency
    try {
      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      if (event.event_type === 'task_state_change' && payload['nextState'] && latest) {
        const expectedState = payload['nextState'] as string;
        if (latest.state !== expectedState) {
          warnings.push(
            `Task ${event.task_id}: event says state should be ${expectedState} but DB has ${latest.state}`,
          );
        }
      }
    } catch {
      warnings.push(`Task ${event.task_id}: failed to parse event payload for event ${event.id}`);
    }
  }
}

// ── Utility ──────────────────────────────────────────────────────────

/**
 * Check if a process is still alive by sending signal 0.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
