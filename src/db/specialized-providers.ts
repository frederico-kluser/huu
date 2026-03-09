// SQLite implementations of specialized view data providers
//
// Each provider follows the 2-phase watermark pattern:
// 1. getWatermark() — cheap composite check
// 2. getSnapshot() — full data read only when watermark changes

import type Database from 'better-sqlite3';
import type {
  LogsDataProvider,
  LogsSnapshot,
  AggregatedLogEntry,
  LogLevel,
  MergeQueueDataProvider,
  MergeQueueSnapshot,
  MergeQueueItemView,
  MergeViewStatus,
  MergeViewTier,
  CostDataProvider,
  CostSnapshot,
  CostGroupBy,
  CostBreakdownRow,
  BeatSheetDataProvider,
  BeatSheetSnapshot,
  BeatNode,
  BeatViewStatus,
  CheckpointView,
  CheckpointName,
  CoordinationMetricsProvider,
  CoordinationMetricsSnapshot,
  OverheadLevel,
} from '../tui/types.js';

// ── Logs Provider ───────────────────────────────────────────────────

export class SqliteLogsProvider implements LogsDataProvider {
  constructor(
    private readonly db: Database.Database,
    private readonly projectId: string,
  ) {}

  getWatermark(): string {
    try {
      const row = this.db
        .prepare(
          `SELECT COALESCE(
             (SELECT MAX(id) FROM messages WHERE project_id = ?), 0
           ) || '|' || COALESCE(
             (SELECT MAX(id) FROM audit_log WHERE project_id = ?), 0
           ) AS wm`,
        )
        .get(this.projectId, this.projectId) as { wm: string } | undefined;
      return row?.wm ?? '';
    } catch {
      return '';
    }
  }

  getSnapshot(limit: number = 5000): LogsSnapshot {
    const entries: AggregatedLogEntry[] = [];

    // Read from messages table
    try {
      const msgRows = this.db
        .prepare(
          `SELECT id, created_at, sender_agent, message_type, payload_json
           FROM messages
           WHERE project_id = ?
           ORDER BY id DESC
           LIMIT ?`,
        )
        .all(this.projectId, limit) as Array<{
        id: number;
        created_at: string;
        sender_agent: string;
        message_type: string;
        payload_json: string;
      }>;

      for (const row of msgRows) {
        const level = this.messageTypeToLevel(row.message_type);
        let message = row.message_type;
        try {
          const payload = JSON.parse(row.payload_json) as Record<
            string,
            unknown
          >;
          message =
            (payload['message'] as string) ??
            (payload['title'] as string) ??
            row.message_type;
        } catch {
          // Use message_type as fallback
        }

        entries.push({
          id: `msg-${row.id}`,
          ts: new Date(row.created_at).getTime(),
          agentId: row.sender_agent,
          level,
          message,
          source: 'messages',
        });
      }
    } catch {
      // Table may not exist
    }

    // Read from audit_log table
    try {
      const auditRows = this.db
        .prepare(
          `SELECT id, created_at, agent_id, tool_name, result_status, error_text
           FROM audit_log
           WHERE project_id = ?
           ORDER BY id DESC
           LIMIT ?`,
        )
        .all(this.projectId, limit) as Array<{
        id: number;
        created_at: string;
        agent_id: string;
        tool_name: string;
        result_status: string;
        error_text: string | null;
      }>;

      for (const row of auditRows) {
        const level: LogLevel =
          row.result_status === 'error' ? 'error' : 'debug';
        const message = row.error_text ?? `${row.tool_name} ${row.result_status}`;

        entries.push({
          id: `audit-${row.id}`,
          ts: new Date(row.created_at).getTime(),
          agentId: row.agent_id,
          level,
          message,
          source: 'audit_log',
        });
      }
    } catch {
      // Table may not exist
    }

    // Sort by (ts, id) for stable ordering
    entries.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));

    // Trim to buffer limit
    if (entries.length > limit) {
      entries.splice(0, entries.length - limit);
    }

    return { entries, watermark: this.getWatermark() };
  }

  private messageTypeToLevel(type: string): LogLevel {
    switch (type) {
      case 'escalation':
        return 'error';
      case 'abort_requested':
      case 'abort_ack':
        return 'warn';
      case 'task_progress':
      case 'health_check':
        return 'debug';
      default:
        return 'info';
    }
  }
}

// ── Merge Queue Provider ────────────────────────────────────────────

const STATUS_MAP: Record<string, MergeViewStatus> = {
  queued: 'queued',
  in_progress: 'running',
  merged: 'merged',
  conflict: 'blocked',
  failed: 'failed',
  retry_wait: 'queued',
};

export class SqliteMergeQueueProvider implements MergeQueueDataProvider {
  constructor(private readonly db: Database.Database) {}

  getWatermark(): string {
    try {
      const row = this.db
        .prepare(
          `SELECT COALESCE(MAX(updated_at), '') || '|' || COUNT(*) AS wm
           FROM merge_queue`,
        )
        .get() as { wm: string } | undefined;
      return row?.wm ?? '';
    } catch {
      return '';
    }
  }

  getSnapshot(): MergeQueueSnapshot {
    const items: MergeQueueItemView[] = [];
    let queueLength = 0;
    let runningCount = 0;
    let blockedCount = 0;
    let totalWaitMs = 0;
    let waitCount = 0;

    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM merge_queue
           ORDER BY
             CASE WHEN status IN ('queued','in_progress','conflict','retry_wait') THEN 0 ELSE 1 END,
             created_at ASC, id ASC`,
        )
        .all() as Array<{
        id: number;
        request_id: string;
        source_branch: string;
        status: string;
        attempts: number;
        last_error: string | null;
        created_at: string;
        started_at: string | null;
        finished_at: string | null;
        updated_at: string;
      }>;

      const now = Date.now();
      let position = 0;

      for (const row of rows) {
        const status = STATUS_MAP[row.status] ?? 'queued';
        const enqueuedAt = new Date(row.created_at).getTime();
        const waitMs = row.finished_at
          ? new Date(row.finished_at).getTime() - enqueuedAt
          : now - enqueuedAt;

        if (status === 'queued' || status === 'running' || status === 'blocked') {
          position++;
          queueLength++;
        }
        if (status === 'running') runningCount++;
        if (status === 'blocked') blockedCount++;

        totalWaitMs += waitMs;
        waitCount++;

        // Determine tier from merge_results if available
        let currentTier: MergeViewTier | undefined;
        try {
          const tierRow = this.db
            .prepare(
              `SELECT tier_selected FROM merge_results
               WHERE queue_id = ?
               ORDER BY created_at DESC LIMIT 1`,
            )
            .get(row.id) as { tier_selected: string } | undefined;
          if (tierRow?.tier_selected) {
            const tierNum = parseInt(tierRow.tier_selected.replace('tier', ''), 10);
            if (tierNum >= 1 && tierNum <= 4) {
              currentTier = tierNum as MergeViewTier;
            }
          }
        } catch {
          // merge_results may not exist
        }

        items.push({
          id: String(row.id),
          position: status === 'merged' || status === 'failed' ? 0 : position,
          taskId: row.request_id,
          branch: row.source_branch,
          enqueuedAt,
          waitMs,
          currentTier,
          status,
          retries: row.attempts,
          lastError: row.last_error ?? undefined,
        });
      }
    } catch {
      // Tables may not exist
    }

    return {
      items,
      queueLength,
      runningCount,
      blockedCount,
      avgWaitMs: waitCount > 0 ? Math.round(totalWaitMs / waitCount) : 0,
      watermark: this.getWatermark(),
    };
  }
}

// ── Cost Provider ───────────────────────────────────────────────────

// Default rate card (USD per million tokens)
const RATE_CARD: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.8, output: 4 },
};

function modelRate(model: string): { input: number; output: number } {
  const lower = model.toLowerCase();
  for (const [key, rate] of Object.entries(RATE_CARD)) {
    if (lower.includes(key)) return rate;
  }
  return { input: 3, output: 15 }; // Default to Sonnet rates
}

export class SqliteCostProvider implements CostDataProvider {
  constructor(
    private readonly db: Database.Database,
    private readonly projectId: string,
  ) {}

  getWatermark(): string {
    try {
      const row = this.db
        .prepare(
          `SELECT COALESCE(
             (SELECT MAX(id) FROM observations WHERE project_id = ?), 0
           ) || '|' || COALESCE(
             (SELECT SUM(total_cost_usd) FROM sessions WHERE project_id = ?), 0
           ) AS wm`,
        )
        .get(this.projectId, this.projectId) as { wm: string } | undefined;
      return row?.wm ?? '';
    } catch {
      return '';
    }
  }

  getSnapshot(groupBy: CostGroupBy): CostSnapshot {
    const rows: CostBreakdownRow[] = [];
    let totalCostUsd = 0;
    let totalTokens = 0;
    let taskCount = 0;
    const trend: number[] = [];

    try {
      // Get total cost from sessions
      const costRow = this.db
        .prepare(
          'SELECT COALESCE(SUM(total_cost_usd), 0) as total FROM sessions WHERE project_id = ?',
        )
        .get(this.projectId) as { total: number };
      totalCostUsd = costRow.total;
    } catch {
      // Table may not exist
    }

    try {
      // Count tasks for avg
      const countRow = this.db
        .prepare(
          'SELECT COUNT(*) as cnt FROM observations WHERE project_id = ? AND tool_phase = ?',
        )
        .get(this.projectId, 'post') as { cnt: number };
      taskCount = countRow.cnt || 1;
    } catch {
      taskCount = 1;
    }

    // Get breakdown by dimension from observations
    try {
      const groupCol =
        groupBy === 'agent'
          ? 'agent_id'
          : groupBy === 'model'
            ? 'tool_name'
            : 'tool_phase';

      const obsRows = this.db
        .prepare(
          `SELECT ${groupCol} as grp,
                  COALESCE(SUM(tokens_input), 0) as prompt_tokens,
                  COALESCE(SUM(tokens_output), 0) as completion_tokens,
                  COALESCE(SUM(cost_usd), 0) as cost
           FROM observations
           WHERE project_id = ?
           GROUP BY ${groupCol}
           ORDER BY cost DESC`,
        )
        .all(this.projectId) as Array<{
        grp: string;
        prompt_tokens: number;
        completion_tokens: number;
        cost: number;
      }>;

      for (const row of obsRows) {
        const t = row.prompt_tokens + row.completion_tokens;
        totalTokens += t;
        rows.push({
          key: row.grp ?? 'unknown',
          promptTokens: row.prompt_tokens,
          completionTokens: row.completion_tokens,
          totalTokens: t,
          costUsd: row.cost,
          pct: 0,
        });
      }

      // Calculate percentages
      const totalRowCost = rows.reduce((sum, r) => sum + r.costUsd, 0);
      for (const row of rows) {
        row.pct =
          totalRowCost > 0 ? Math.round((row.costUsd / totalRowCost) * 100) : 0;
      }
    } catch {
      // Table may not exist
    }

    // Build trend (last 10 data points from sessions)
    try {
      const trendRows = this.db
        .prepare(
          `SELECT total_cost_usd FROM sessions
           WHERE project_id = ?
           ORDER BY created_at DESC
           LIMIT 10`,
        )
        .all(this.projectId) as Array<{ total_cost_usd: number }>;

      for (const r of trendRows.reverse()) {
        trend.push(r.total_cost_usd);
      }
    } catch {
      // Table may not exist
    }

    // Use totalCostUsd from sessions, or sum of observations if sessions is 0
    if (totalCostUsd === 0 && rows.length > 0) {
      totalCostUsd = rows.reduce((sum, r) => sum + r.costUsd, 0);
    }

    return {
      totalCostUsd,
      totalTokens,
      avgCostPerTask: taskCount > 0 ? totalCostUsd / taskCount : 0,
      rows,
      trend,
      watermark: this.getWatermark(),
    };
  }
}

// ── Beat Sheet Provider ─────────────────────────────────────────────

const CHECKPOINT_LABELS: Record<string, { name: CheckpointName; label: string }> = {
  catalyst: { name: 'catalyst', label: 'Catalyst' },
  midpoint: { name: 'midpoint', label: 'Midpoint' },
  allIsLost: { name: 'all_is_lost', label: 'All Is Lost' },
  breakIntoThree: { name: 'break_into_three', label: 'Break Into Three' },
  finalImage: { name: 'final_image', label: 'Final Image' },
};

function taskStatusToBeatView(status: string): BeatViewStatus {
  switch (status) {
    case 'done':
      return 'done';
    case 'running':
      return 'running';
    case 'blocked':
    case 'failed':
      return 'blocked';
    default:
      return 'pending';
  }
}

export class SqliteBeatSheetProvider implements BeatSheetDataProvider {
  constructor(
    private readonly db: Database.Database,
    private readonly projectId: string,
  ) {}

  getWatermark(): string {
    try {
      const row = this.db
        .prepare(
          `SELECT COALESCE(updated_at, '') AS wm
           FROM beat_state
           WHERE project_id = ?`,
        )
        .get(this.projectId) as { wm: string } | undefined;
      return row?.wm ?? '';
    } catch {
      return '';
    }
  }

  getSnapshot(): BeatSheetSnapshot {
    const nodes: BeatNode[] = [];
    const checkpoints: CheckpointView[] = [];
    let overallProgressPct = 0;

    try {
      const beatRow = this.db
        .prepare(
          'SELECT snapshot_json, progress_pct FROM beat_state WHERE project_id = ?',
        )
        .get(this.projectId) as
        | { snapshot_json: string; progress_pct: number }
        | undefined;

      if (!beatRow?.snapshot_json) {
        return { nodes, checkpoints, overallProgressPct: 0, watermark: this.getWatermark() };
      }

      overallProgressPct = beatRow.progress_pct ?? 0;

      const snap = JSON.parse(beatRow.snapshot_json) as Record<string, unknown>;
      const sheet = (snap['sheet'] ?? snap) as Record<string, unknown>;

      // Build objective root node
      const objectiveTitle = (sheet['objective'] as string) ?? 'Project';
      nodes.push({
        id: 'root',
        type: 'objective',
        title: objectiveTitle,
        status: overallProgressPct >= 100 ? 'done' : overallProgressPct > 0 ? 'running' : 'pending',
        progressPct: overallProgressPct,
        depth: 0,
      });

      // Build act, sequence, task nodes
      const acts = sheet['acts'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(acts)) {
        for (const act of acts) {
          const actId = String(act['id'] ?? '');
          const actTasks = this.collectActTasks(act);
          const actDone = actTasks.filter((t) => t === 'done').length;
          const actProgress =
            actTasks.length > 0
              ? Math.round((actDone / actTasks.length) * 100)
              : 0;

          nodes.push({
            id: actId,
            parentId: 'root',
            type: 'act',
            title: String(act['name'] ?? act['type'] ?? 'Act'),
            status: taskStatusToBeatView(
              actProgress >= 100 ? 'done' : actProgress > 0 ? 'running' : 'pending',
            ),
            progressPct: actProgress,
            depth: 1,
          });

          const sequences = act['sequences'] as
            | Array<Record<string, unknown>>
            | undefined;
          if (Array.isArray(sequences)) {
            for (const seq of sequences) {
              const seqId = String(seq['id'] ?? '');
              const tasks = seq['tasks'] as
                | Array<Record<string, unknown>>
                | undefined;
              const seqTasks = (tasks ?? []).map((t) =>
                String(t['status'] ?? 'pending'),
              );
              const seqDone = seqTasks.filter((s) => s === 'done').length;
              const seqProgress =
                seqTasks.length > 0
                  ? Math.round((seqDone / seqTasks.length) * 100)
                  : 0;

              nodes.push({
                id: seqId,
                parentId: actId,
                type: 'sequence',
                title: String(seq['name'] ?? 'Sequence'),
                status: taskStatusToBeatView(
                  seqProgress >= 100
                    ? 'done'
                    : seqProgress > 0
                      ? 'running'
                      : 'pending',
                ),
                progressPct: seqProgress,
                depth: 2,
              });

              if (Array.isArray(tasks)) {
                for (const task of tasks) {
                  const taskStatus = String(task['status'] ?? 'pending');
                  nodes.push({
                    id: String(task['id'] ?? ''),
                    parentId: seqId,
                    type: 'task',
                    title: String(task['title'] ?? 'Task'),
                    status: taskStatusToBeatView(taskStatus),
                    progressPct: taskStatus === 'done' ? 100 : taskStatus === 'running' ? 50 : 0,
                    depth: 3,
                  });
                }
              }
            }
          }
        }
      }

      // Build checkpoints
      const cp = sheet['checkpoints'] as Record<string, string> | undefined;
      if (cp) {
        for (const [key, meta] of Object.entries(CHECKPOINT_LABELS)) {
          const state = cp[key] ?? 'pending';
          checkpoints.push({
            name: meta.name,
            label: meta.label,
            status: state === 'passed' ? 'done' : state === 'failed' ? 'blocked' : 'pending',
          });
        }
      }
    } catch {
      // Invalid data — return empty
    }

    return {
      nodes,
      checkpoints,
      overallProgressPct,
      watermark: this.getWatermark(),
    };
  }

  private collectActTasks(act: Record<string, unknown>): string[] {
    const statuses: string[] = [];
    const sequences = act['sequences'] as
      | Array<Record<string, unknown>>
      | undefined;
    if (Array.isArray(sequences)) {
      for (const seq of sequences) {
        const tasks = seq['tasks'] as
          | Array<Record<string, unknown>>
          | undefined;
        if (Array.isArray(tasks)) {
          for (const t of tasks) {
            statuses.push(String(t['status'] ?? 'pending'));
          }
        }
      }
    }
    return statuses;
  }
}

// ── Coordination Metrics Provider ───────────────────────────────────

function toOverheadLevel(ratio: number): OverheadLevel {
  if (ratio < 0.25) return 'green';
  if (ratio <= 0.40) return 'yellow';
  return 'red';
}

export class SqliteCoordinationMetricsProvider implements CoordinationMetricsProvider {
  private schedulerRunning = 0;
  private schedulerPending = 0;
  private schedulerSaturated = false;

  constructor(
    private readonly db: Database.Database,
    private readonly sessionId: string,
  ) {}

  /** Update scheduler stats from the SchedulerQueue (called externally). */
  updateSchedulerStats(running: number, pending: number, saturated: boolean): void {
    this.schedulerRunning = running;
    this.schedulerPending = pending;
    this.schedulerSaturated = saturated;
  }

  getWatermark(): string {
    try {
      const row = this.db
        .prepare(
          `SELECT COALESCE(MAX(id), 0) || '|' || COUNT(*) AS wm
           FROM task_runtime_metrics
           WHERE session_id = ?`,
        )
        .get(this.sessionId) as { wm: string } | undefined;
      return (row?.wm ?? '') + `|${this.schedulerRunning}|${this.schedulerPending}`;
    } catch {
      return '';
    }
  }

  getSnapshot(): CoordinationMetricsSnapshot {
    const empty: CoordinationMetricsSnapshot = {
      coordinationMs: 0,
      executionMs: 0,
      ratio: 0,
      level: 'green',
      taskCount: 0,
      p50QueueWaitMs: 0,
      p95QueueWaitMs: 0,
      avgMergeWaitMs: 0,
      tasksPerSecond: 0,
      schedulerRunning: this.schedulerRunning,
      schedulerPending: this.schedulerPending,
      schedulerSaturated: this.schedulerSaturated,
      watermark: this.getWatermark(),
    };

    try {
      const row = this.db
        .prepare(
          `SELECT
            COALESCE(SUM(coordination_ms), 0) AS coordination_ms,
            COALESCE(SUM(execution_ms), 0) AS execution_ms,
            COUNT(*) AS task_count,
            COALESCE(MIN(task_queued_at), 0) AS first_queued,
            COALESCE(MAX(agent_done_at), 0) AS last_done
          FROM task_runtime_metrics
          WHERE session_id = ?`,
        )
        .get(this.sessionId) as {
        coordination_ms: number;
        execution_ms: number;
        task_count: number;
        first_queued: number;
        last_done: number;
      } | undefined;

      if (!row || row.task_count === 0) return empty;

      const total = row.coordination_ms + row.execution_ms;
      const ratio = total > 0 ? row.coordination_ms / total : 0;
      const roundedRatio = Math.round(ratio * 10000) / 10000;
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
        .all(this.sessionId) as Array<{ queue_wait_ms: number }>;

      const values = queueWaits.map((r) => r.queue_wait_ms);
      const p50 = percentileValue(values, 0.5);
      const p95 = percentileValue(values, 0.95);

      const mergeRow = this.db
        .prepare(
          `SELECT COALESCE(AVG(merge_wait_ms), 0) AS avg_mw
           FROM task_runtime_metrics
           WHERE session_id = ? AND merge_wait_ms IS NOT NULL`,
        )
        .get(this.sessionId) as { avg_mw: number };

      return {
        coordinationMs: row.coordination_ms,
        executionMs: row.execution_ms,
        ratio: roundedRatio,
        level: toOverheadLevel(roundedRatio),
        taskCount: row.task_count,
        p50QueueWaitMs: p50,
        p95QueueWaitMs: p95,
        avgMergeWaitMs: Math.round(mergeRow.avg_mw),
        tasksPerSecond: Math.round((row.task_count / durationSec) * 100) / 100,
        schedulerRunning: this.schedulerRunning,
        schedulerPending: this.schedulerPending,
        schedulerSaturated: this.schedulerSaturated,
        watermark: this.getWatermark(),
      };
    } catch {
      return empty;
    }
  }
}

function percentileValue(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}
