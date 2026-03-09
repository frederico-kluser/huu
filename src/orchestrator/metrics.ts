// Coordination overhead metrics — instrumentation + persistence
//
// Tracks how much time the system spends coordinating vs executing real work.
// Key metric: coordination_overhead_ratio = coordination_ms / (coordination_ms + execution_ms)
//
// Events are recorded as raw timestamps, with derived columns computed by SQLite.

import type Database from 'better-sqlite3';

// ── Types ────────────────────────────────────────────────────────────

export interface TaskTimingEvent {
  sessionId: string;
  taskId: string;
  agentId: string;
  runId: string;
}

export interface CoordinationSummary {
  sessionId: string;
  coordinationMs: number;
  executionMs: number;
  ratio: number;
  taskCount: number;
  p50QueueWaitMs: number;
  p95QueueWaitMs: number;
  avgMergeWaitMs: number;
  tasksPerSecond: number;
}

export type OverheadLevel = 'green' | 'yellow' | 'red';

export function overheadLevel(ratio: number): OverheadLevel {
  if (ratio < 0.25) return 'green';
  if (ratio <= 0.40) return 'yellow';
  return 'red';
}

// ── Metrics Recorder ────────────────────────────────────────────────

export class MetricsRecorder {
  private readonly insertStmt: Database.Statement;
  private readonly updateStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO task_runtime_metrics
        (session_id, task_id, agent_id, run_id, task_queued_at, task_dispatched_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.updateStmt = db.prepare(`
      UPDATE task_runtime_metrics
      SET agent_started_at = COALESCE(?, agent_started_at),
          agent_done_at = COALESCE(?, agent_done_at),
          merge_queued_at = COALESCE(?, merge_queued_at),
          merge_started_at = COALESCE(?, merge_started_at),
          merge_done_at = COALESCE(?, merge_done_at),
          lock_wait_ms = COALESCE(?, lock_wait_ms),
          updated_at = datetime('now')
      WHERE task_id = ? AND run_id = ?
    `);
  }

  /** Record when a task is queued for scheduling. */
  recordQueued(event: TaskTimingEvent, nowMs: number): void {
    try {
      this.insertStmt.run(
        event.sessionId,
        event.taskId,
        event.agentId,
        event.runId,
        nowMs,
        nowMs,
      );
    } catch {
      // Non-fatal: metrics collection should not break orchestration
    }
  }

  /** Record when an agent starts working. */
  recordAgentStarted(taskId: string, runId: string, nowMs: number): void {
    try {
      this.updateStmt.run(nowMs, null, null, null, null, null, taskId, runId);
    } catch {
      // Non-fatal
    }
  }

  /** Record when an agent finishes. */
  recordAgentDone(taskId: string, runId: string, nowMs: number): void {
    try {
      this.updateStmt.run(null, nowMs, null, null, null, null, taskId, runId);
    } catch {
      // Non-fatal
    }
  }

  /** Record when merge is queued. */
  recordMergeQueued(taskId: string, runId: string, nowMs: number): void {
    try {
      this.updateStmt.run(null, null, nowMs, null, null, null, taskId, runId);
    } catch {
      // Non-fatal
    }
  }

  /** Record when merge starts processing. */
  recordMergeStarted(taskId: string, runId: string, nowMs: number): void {
    try {
      this.updateStmt.run(null, null, null, nowMs, null, null, taskId, runId);
    } catch {
      // Non-fatal
    }
  }

  /** Record when merge completes. */
  recordMergeDone(taskId: string, runId: string, nowMs: number): void {
    try {
      this.updateStmt.run(null, null, null, null, nowMs, null, taskId, runId);
    } catch {
      // Non-fatal
    }
  }

  /** Record lock wait time. */
  recordLockWait(taskId: string, runId: string, waitMs: number): void {
    try {
      this.updateStmt.run(null, null, null, null, null, waitMs, taskId, runId);
    } catch {
      // Non-fatal
    }
  }
}

// ── Metrics Query ───────────────────────────────────────────────────

export class MetricsQuery {
  constructor(private readonly db: Database.Database) {}

  /** Get coordination summary for a session. */
  getSessionSummary(sessionId: string): CoordinationSummary | null {
    try {
      const row = this.db
        .prepare(
          `SELECT
            session_id,
            COALESCE(SUM(coordination_ms), 0) AS coordination_ms,
            COALESCE(SUM(execution_ms), 0) AS execution_ms,
            COUNT(*) AS task_count,
            COALESCE(MIN(task_queued_at), 0) AS first_queued,
            COALESCE(MAX(agent_done_at), 0) AS last_done
          FROM task_runtime_metrics
          WHERE session_id = ?
          GROUP BY session_id`,
        )
        .get(sessionId) as {
        session_id: string;
        coordination_ms: number;
        execution_ms: number;
        task_count: number;
        first_queued: number;
        last_done: number;
      } | undefined;

      if (!row) return null;

      const total = row.coordination_ms + row.execution_ms;
      const ratio = total > 0 ? row.coordination_ms / total : 0;
      const durationSec = row.last_done > row.first_queued
        ? (row.last_done - row.first_queued) / 1000
        : 1;

      // Percentiles for queue wait
      const queueWaits = this.db
        .prepare(
          `SELECT queue_wait_ms FROM task_runtime_metrics
           WHERE session_id = ? AND queue_wait_ms IS NOT NULL
           ORDER BY queue_wait_ms ASC`,
        )
        .all(sessionId) as Array<{ queue_wait_ms: number }>;

      const p50 = percentile(queueWaits.map((r) => r.queue_wait_ms), 0.5);
      const p95 = percentile(queueWaits.map((r) => r.queue_wait_ms), 0.95);

      // Average merge wait
      const mergeRow = this.db
        .prepare(
          `SELECT COALESCE(AVG(merge_wait_ms), 0) AS avg_mw
           FROM task_runtime_metrics
           WHERE session_id = ? AND merge_wait_ms IS NOT NULL`,
        )
        .get(sessionId) as { avg_mw: number };

      return {
        sessionId: row.session_id,
        coordinationMs: row.coordination_ms,
        executionMs: row.execution_ms,
        ratio: Math.round(ratio * 10000) / 10000,
        taskCount: row.task_count,
        p50QueueWaitMs: p50,
        p95QueueWaitMs: p95,
        avgMergeWaitMs: Math.round(mergeRow.avg_mw),
        tasksPerSecond: Math.round((row.task_count / durationSec) * 100) / 100,
      };
    } catch {
      return null;
    }
  }

  /** Get per-task metrics for a session. */
  getTaskMetrics(sessionId: string): Array<{
    taskId: string;
    agentId: string;
    queueWaitMs: number | null;
    executionMs: number | null;
    mergeWaitMs: number | null;
    coordinationMs: number;
  }> {
    try {
      return this.db
        .prepare(
          `SELECT task_id, agent_id, queue_wait_ms, execution_ms,
                  merge_wait_ms, coordination_ms
           FROM task_runtime_metrics
           WHERE session_id = ?
           ORDER BY created_at ASC`,
        )
        .all(sessionId) as Array<{
        taskId: string;
        agentId: string;
        queueWaitMs: number | null;
        executionMs: number | null;
        mergeWaitMs: number | null;
        coordinationMs: number;
      }>;
    } catch {
      return [];
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}
