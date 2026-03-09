// SQLite implementation of KanbanDataProvider
//
// Reads beat_state.snapshot_json for task data and sessions for cost.
// Maps BeatTaskStatus → KanbanColumn:
//   pending/ready → backlog, running → running, blocked → review,
//   done → done, failed → failed

import type Database from 'better-sqlite3';
import type {
  KanbanDataProvider,
  BoardSnapshot,
  KanbanTask,
  KanbanColumn,
} from '../tui/types.js';

const STATUS_TO_COLUMN: Record<string, KanbanColumn> = {
  pending: 'backlog',
  ready: 'backlog',
  running: 'running',
  blocked: 'review',
  done: 'done',
  failed: 'failed',
};

export class SqliteKanbanProvider implements KanbanDataProvider {
  constructor(
    private readonly db: Database.Database,
    private readonly projectId: string,
  ) {}

  getWatermark(): string {
    try {
      const row = this.db
        .prepare(
          `SELECT COALESCE(
             (SELECT updated_at FROM beat_state WHERE project_id = ?), ''
           ) || '|' || COALESCE(
             (SELECT MAX(id) FROM messages WHERE project_id = ?), 0
           ) AS wm`,
        )
        .get(this.projectId, this.projectId) as { wm: string } | undefined;
      return row?.wm ?? '';
    } catch {
      return '';
    }
  }

  getSnapshot(): BoardSnapshot {
    const beatRow = this.db
      .prepare(
        'SELECT current_act, current_beat, snapshot_json FROM beat_state WHERE project_id = ?',
      )
      .get(this.projectId) as
      | {
          current_act: number;
          current_beat: string | null;
          snapshot_json: string;
        }
      | undefined;

    const act = beatRow?.current_act ?? 0;
    const beat = beatRow?.current_beat ?? null;
    const tasks: KanbanTask[] = [];

    if (beatRow?.snapshot_json) {
      try {
        const snap = JSON.parse(beatRow.snapshot_json) as Record<
          string,
          unknown
        >;
        this.extractTasks(snap, tasks);
      } catch {
        // Invalid JSON — return empty tasks
      }
    }

    let totalCostUsd = 0;
    try {
      const costRow = this.db
        .prepare(
          'SELECT COALESCE(SUM(total_cost_usd), 0) as total FROM sessions WHERE project_id = ?',
        )
        .get(this.projectId) as { total: number };
      totalCostUsd = costRow.total;
    } catch {
      // Table might not exist
    }

    return { tasks, act, beat, totalCostUsd, watermark: this.getWatermark() };
  }

  private extractTasks(
    snapshot: Record<string, unknown>,
    out: KanbanTask[],
  ): void {
    const acts = snapshot['acts'] as
      | Array<Record<string, unknown>>
      | undefined;
    if (!Array.isArray(acts)) return;

    for (const actNode of acts) {
      const sequences = actNode['sequences'] as
        | Array<Record<string, unknown>>
        | undefined;
      if (!Array.isArray(sequences)) continue;

      for (const seq of sequences) {
        const taskList = seq['tasks'] as
          | Array<Record<string, unknown>>
          | undefined;
        if (!Array.isArray(taskList)) continue;

        for (const t of taskList) {
          const status = String(t['status'] ?? 'pending');
          const column = STATUS_TO_COLUMN[status] ?? 'backlog';
          out.push({
            id: String(t['id'] ?? 'unknown'),
            name: String(t['title'] ?? 'Untitled'),
            agent: String(t['agent'] ?? 'n/a'),
            model: String(t['model'] ?? 'n/a'),
            elapsedMs: Number(t['elapsedMs'] ?? 0),
            costUsd: Number(t['costUsd'] ?? 0),
            column,
          });
        }
      }
    }
  }
}
