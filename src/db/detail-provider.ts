// SQLite implementation of DetailDataProvider
//
// Reads task data from beat_state snapshot, messages for log lines,
// and sessions/observations for metrics. Computes intervention signals.

import type Database from 'better-sqlite3';
import type {
  DetailDataProvider,
  DetailSnapshot,
  LogLine,
  DiffFile,
  TaskMetrics,
  InterventionLevel,
  InterventionSignal,
  KanbanColumn,
  DetailLogLevel,
} from '../tui/types.js';

const STATUS_TO_COLUMN: Record<string, KanbanColumn> = {
  pending: 'backlog',
  ready: 'backlog',
  running: 'running',
  blocked: 'review',
  done: 'done',
  failed: 'failed',
};

const LOG_MESSAGE_TYPES = [
  'task_progress',
  'task_done',
  'escalation',
  'merge_result',
  'steer',
  'follow_up',
  'abort_requested',
  'abort_ack',
] as const;

const MESSAGE_TYPE_TO_LEVEL: Record<string, DetailLogLevel> = {
  task_progress: 'progress',
  task_done: 'info',
  escalation: 'escalation',
  merge_result: 'info',
  steer: 'info',
  follow_up: 'info',
  abort_requested: 'warn',
  abort_ack: 'warn',
};

// Model context windows (tokens)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
  'claude-opus-4-20250514': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
};

// Model rates (USD per million tokens)
const MODEL_RATES: Record<string, { inputPerM: number; outputPerM: number }> = {
  opus: { inputPerM: 15, outputPerM: 75 },
  sonnet: { inputPerM: 3, outputPerM: 15 },
  haiku: { inputPerM: 0.25, outputPerM: 1.25 },
};

interface TaskFromSnapshot {
  id: string;
  title: string;
  agent: string;
  model: string;
  status: string;
  elapsedMs: number;
  costUsd: number;
  startedAt: string | null;
  filesChanged: string[];
}

export class SqliteDetailProvider implements DetailDataProvider {
  constructor(
    private readonly db: Database.Database,
    private readonly projectId: string,
  ) {}

  getDetailWatermark(taskId: string): string {
    try {
      const row = this.db
        .prepare(
          `SELECT COALESCE(
             (SELECT updated_at FROM beat_state WHERE project_id = ?), ''
           ) || '|' || COALESCE(
             (SELECT MAX(id) FROM messages WHERE project_id = ? AND correlation_id = ?), 0
           ) AS wm`,
        )
        .get(this.projectId, this.projectId, taskId) as
        | { wm: string }
        | undefined;
      return row?.wm ?? '';
    } catch {
      return '';
    }
  }

  getDetailSnapshot(taskId: string): DetailSnapshot {
    const task = this.findTask(taskId);
    const logs = this.getLogs(taskId);
    const diffs = this.getDiffs(task);
    const metrics = this.getMetrics(taskId, task);
    const { level, signals } = this.computeIntervention(
      taskId,
      task,
      metrics,
      logs,
    );

    return {
      taskId,
      taskName: task?.title ?? 'Unknown',
      agent: task?.agent ?? 'n/a',
      column: STATUS_TO_COLUMN[task?.status ?? 'pending'] ?? 'backlog',
      logs,
      diffs,
      metrics,
      interventionLevel: level,
      interventionSignals: signals,
      watermark: this.getDetailWatermark(taskId),
    };
  }

  private findTask(taskId: string): TaskFromSnapshot | null {
    try {
      const row = this.db
        .prepare(
          'SELECT snapshot_json FROM beat_state WHERE project_id = ?',
        )
        .get(this.projectId) as { snapshot_json: string } | undefined;

      if (!row?.snapshot_json) return null;
      const snap = JSON.parse(row.snapshot_json) as Record<string, unknown>;
      return this.extractTask(snap, taskId);
    } catch {
      return null;
    }
  }

  private extractTask(
    snapshot: Record<string, unknown>,
    taskId: string,
  ): TaskFromSnapshot | null {
    const acts = snapshot['acts'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(acts)) return null;

    for (const act of acts) {
      const sequences = act['sequences'] as
        | Array<Record<string, unknown>>
        | undefined;
      if (!Array.isArray(sequences)) continue;
      for (const seq of sequences) {
        const tasks = seq['tasks'] as
          | Array<Record<string, unknown>>
          | undefined;
        if (!Array.isArray(tasks)) continue;
        for (const t of tasks) {
          if (String(t['id'] ?? '') === taskId) {
            return {
              id: taskId,
              title: String(t['title'] ?? 'Untitled'),
              agent: String(t['agent'] ?? 'n/a'),
              model: String(t['model'] ?? 'n/a'),
              status: String(t['status'] ?? 'pending'),
              elapsedMs: Number(t['elapsedMs'] ?? 0),
              costUsd: Number(t['costUsd'] ?? 0),
              startedAt: (t['startedAt'] as string) ?? null,
              filesChanged: Array.isArray(t['filesChanged'])
                ? (t['filesChanged'] as string[])
                : [],
            };
          }
        }
      }
    }
    return null;
  }

  private getLogs(taskId: string): LogLine[] {
    try {
      const types = LOG_MESSAGE_TYPES.map((t) => `'${t}'`).join(',');
      const rows = this.db
        .prepare(
          `SELECT id, message_type, payload_json, created_at
           FROM messages
           WHERE project_id = ?
             AND (correlation_id = ? OR sender_agent = ?)
             AND message_type IN (${types})
           ORDER BY id ASC
           LIMIT 2000`,
        )
        .all(this.projectId, taskId, taskId) as Array<{
        id: number;
        message_type: string;
        payload_json: string;
        created_at: string;
      }>;

      return rows.map((r) => {
        let message = '';
        try {
          const payload = JSON.parse(r.payload_json) as Record<
            string,
            unknown
          >;
          message =
            String(
              payload['message'] ??
                payload['summary'] ??
                payload['text'] ??
                r.message_type,
            );
        } catch {
          message = r.message_type;
        }

        return {
          id: String(r.id),
          ts: r.created_at,
          level: MESSAGE_TYPE_TO_LEVEL[r.message_type] ?? 'info',
          message,
        };
      });
    } catch {
      return [];
    }
  }

  private getDiffs(task: TaskFromSnapshot | null): DiffFile[] {
    if (!task || task.filesChanged.length === 0) return [];

    // Create a synthetic diff representation from the file list
    // Real git diffs would require worktree access which the TUI shouldn't do
    return task.filesChanged.map((path) => ({
      path,
      lines: [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`],
      truncated: false,
      totalLines: 3,
    }));
  }

  private getMetrics(
    taskId: string,
    task: TaskFromSnapshot | null,
  ): TaskMetrics {
    const model = task?.model ?? 'N/A';
    const contextWindow =
      MODEL_CONTEXT_WINDOWS[model] ?? MODEL_CONTEXT_WINDOWS['sonnet'] ?? 200_000;

    // Try to aggregate from observations
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = task?.costUsd ?? 0;

    try {
      const row = this.db
        .prepare(
          `SELECT
             COALESCE(SUM(tokens_input), 0) AS total_in,
             COALESCE(SUM(tokens_output), 0) AS total_out,
             COALESCE(SUM(cost_usd), 0) AS total_cost
           FROM observations
           WHERE project_id = ?
             AND session_id = ?`,
        )
        .get(this.projectId, taskId) as {
        total_in: number;
        total_out: number;
        total_cost: number;
      };

      inputTokens = row.total_in;
      outputTokens = row.total_out;
      if (row.total_cost > 0) costUsd = row.total_cost;
    } catch {
      // Observations might not have data for this task
    }

    // Fall back to cost estimation if no direct cost data
    if (costUsd === 0 && (inputTokens > 0 || outputTokens > 0)) {
      const rates = MODEL_RATES[model] ?? MODEL_RATES['sonnet']!;
      costUsd =
        (inputTokens / 1_000_000) * rates.inputPerM +
        (outputTokens / 1_000_000) * rates.outputPerM;
    }

    const contextUsed = inputTokens + outputTokens;

    return {
      inputTokens,
      outputTokens,
      contextUsedTokens: contextUsed,
      contextWindowTokens: contextWindow,
      costUsd,
      elapsedMs: task?.elapsedMs ?? 0,
      model,
      startedAt: task?.startedAt ?? null,
      updatedAt: null,
    };
  }

  private computeIntervention(
    _taskId: string,
    task: TaskFromSnapshot | null,
    metrics: TaskMetrics,
    logs: LogLine[],
  ): { level: InterventionLevel; signals: InterventionSignal[] } {
    const signals: InterventionSignal[] = [];

    if (!task || task.status !== 'running') {
      return { level: 'ok', signals };
    }

    // Check context usage
    const contextPct =
      metrics.contextWindowTokens > 0
        ? (metrics.contextUsedTokens / metrics.contextWindowTokens) * 100
        : 0;

    if (contextPct > 85) {
      signals.push({
        label: `Context at ${Math.round(contextPct)}% — risk of degradation`,
        severity: 'act-now',
      });
    } else if (contextPct > 70) {
      signals.push({
        label: `Context at ${Math.round(contextPct)}% — approaching limit`,
        severity: 'watch',
      });
    }

    // Check for recent errors/escalations
    const recentErrors = logs.filter(
      (l) => l.level === 'error' || l.level === 'escalation',
    );
    if (recentErrors.length > 0) {
      const lastError = recentErrors[recentErrors.length - 1]!;
      signals.push({
        label: `Recent ${lastError.level}: ${lastError.message.slice(0, 60)}`,
        severity: lastError.level === 'escalation' ? 'act-now' : 'watch',
      });
    }

    // Check heartbeat (last progress > 60s ago)
    const progressLogs = logs.filter((l) => l.level === 'progress');
    if (progressLogs.length > 0) {
      const lastProgress = progressLogs[progressLogs.length - 1]!;
      const lastProgressMs = new Date(lastProgress.ts).getTime();
      const elapsedSinceProgress = Date.now() - lastProgressMs;
      if (elapsedSinceProgress > 60_000) {
        const delaySec = Math.round(elapsedSinceProgress / 1000);
        signals.push({
          label: `Heartbeat ${delaySec}s ago — possible stall`,
          severity: delaySec > 120 ? 'act-now' : 'watch',
        });
      }
    } else if (metrics.elapsedMs > 30_000) {
      // Running for 30s+ with no progress updates
      signals.push({
        label: 'No progress updates received yet',
        severity: 'watch',
      });
    }

    // Check elapsed time (long running)
    if (metrics.elapsedMs > 600_000) {
      // > 10 min
      signals.push({
        label: `Running for ${Math.round(metrics.elapsedMs / 60_000)}min`,
        severity: 'watch',
      });
    }

    // Determine overall level
    let level: InterventionLevel = 'ok';
    if (signals.some((s) => s.severity === 'act-now')) {
      level = 'act-now';
    } else if (signals.some((s) => s.severity === 'watch')) {
      level = 'watch';
    }

    return { level, signals };
  }
}
