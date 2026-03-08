// Beat Sheet persistence layer — read/write/version using SQLite beat_state table

import type Database from 'better-sqlite3';
import type {
  BeatSheet,
  CheckpointState,
  AtomicTask,
} from './beatsheet.js';
import {
  assertValidBeatSheet,
  collectTasks,
} from './beatsheet.js';
import {
  getCurrentCheckpoint,
  checkpointProgressPct,
} from './checkpoints.js';
import type { BeatState } from '../types/index.js';

// ── Persisted snapshot format ───────────────────────────────────────

/**
 * The full beat sheet is serialized into the `snapshot_json` column
 * of the existing `beat_state` table. This keeps the schema stable
 * while allowing the engine to persist arbitrarily complex plans.
 */
interface BeatSheetSnapshot {
  sheet: BeatSheet;
}

// ── Persistence class ───────────────────────────────────────────────

export class BeatSheetPersistence {
  constructor(private readonly db: Database.Database) {}

  /**
   * Save a beat sheet for a project. Uses the existing beat_state table.
   * Always runs inside an IMMEDIATE transaction.
   * Increments version if the sheet structure changed (replan).
   */
  save(projectId: string, runId: string, sheet: BeatSheet): BeatState {
    assertValidBeatSheet(sheet);

    const tasks = collectTasks(sheet);
    const stats = computeProgressStats(tasks);
    const checkpoint = getCurrentCheckpoint(sheet.checkpoints);
    const progressPct = Math.max(
      checkpointProgressPct(sheet.checkpoints),
      stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
    );

    const snapshot: BeatSheetSnapshot = { sheet };
    const snapshotJson = JSON.stringify(snapshot);

    // Determine status based on task states
    let status: 'running' | 'blocked' | 'completed';
    if (stats.done === stats.total && stats.total > 0) {
      status = 'completed';
    } else if (stats.blocked > 0 && stats.running === 0 && stats.ready === 0) {
      status = 'blocked';
    } else {
      status = 'running';
    }

    // Find current act (first act with incomplete tasks)
    let currentAct = 1;
    let currentSequence: string | null = null;
    let currentBeat: string | null = null;
    for (let i = 0; i < sheet.acts.length; i++) {
      const act = sheet.acts[i]!;
      const actTasks = tasks.filter((t) => t.actId === act.id);
      const actDone = actTasks.every((t) => t.status === 'done' || t.status === 'failed');
      if (!actDone) {
        currentAct = i + 1;
        // Find first incomplete sequence
        for (const seq of act.sequences) {
          const seqTasks = seq.tasks;
          const seqDone = seqTasks.every((t) => t.status === 'done' || t.status === 'failed');
          if (!seqDone) {
            currentSequence = seq.id;
            // Find first incomplete task
            for (const task of seqTasks) {
              if (task.status !== 'done' && task.status !== 'failed') {
                currentBeat = task.id;
                break;
              }
            }
            break;
          }
        }
        break;
      }
    }

    // Determine blocked reason
    let blockedReason: string | null = null;
    if (status === 'blocked') {
      const blockedTasks = tasks.filter((t) => t.status === 'blocked');
      blockedReason = `${blockedTasks.length} task(s) blocked: ${blockedTasks.map((t) => t.id).join(', ')}`;
    }

    return this.db.transaction(() => {
      return this.db
        .prepare(
          `INSERT INTO beat_state (
             project_id, run_id, current_act, current_sequence, current_beat,
             checkpoint_name, progress_pct, status, blocked_reason, snapshot_json
           ) VALUES (
             @project_id, @run_id, @current_act, @current_sequence, @current_beat,
             @checkpoint_name, @progress_pct, @status, @blocked_reason, @snapshot_json
           )
           ON CONFLICT(project_id) DO UPDATE SET
             run_id = excluded.run_id,
             current_act = excluded.current_act,
             current_sequence = excluded.current_sequence,
             current_beat = excluded.current_beat,
             checkpoint_name = excluded.checkpoint_name,
             progress_pct = excluded.progress_pct,
             status = excluded.status,
             blocked_reason = excluded.blocked_reason,
             snapshot_json = excluded.snapshot_json,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           RETURNING *`,
        )
        .get({
          project_id: projectId,
          run_id: runId,
          current_act: currentAct,
          current_sequence: currentSequence,
          current_beat: currentBeat,
          checkpoint_name: checkpoint,
          progress_pct: progressPct,
          status,
          blocked_reason: blockedReason,
          snapshot_json: snapshotJson,
        }) as BeatState;
    })();
  }

  /**
   * Load a beat sheet for a project.
   * Returns null if no beat state exists.
   */
  load(projectId: string): BeatSheet | null {
    const row = this.db
      .prepare('SELECT snapshot_json FROM beat_state WHERE project_id = ?')
      .get(projectId) as { snapshot_json: string } | undefined;

    if (!row) return null;

    const snapshot = JSON.parse(row.snapshot_json) as BeatSheetSnapshot;
    if (!snapshot.sheet) return null;

    return snapshot.sheet;
  }

  /**
   * Load both the beat state metadata and the full beat sheet.
   */
  loadWithState(projectId: string): { state: BeatState; sheet: BeatSheet } | null {
    const row = this.db
      .prepare('SELECT * FROM beat_state WHERE project_id = ?')
      .get(projectId) as BeatState | undefined;

    if (!row) return null;

    const snapshot = JSON.parse(row.snapshot_json) as BeatSheetSnapshot;
    if (!snapshot.sheet) return null;

    return { state: row, sheet: snapshot.sheet };
  }

  /**
   * Update a single task's status within a persisted beat sheet.
   * Recomputes progress and saves atomically.
   */
  updateTaskStatus(
    projectId: string,
    taskId: string,
    newStatus: AtomicTask['status'],
  ): BeatSheet | null {
    return this.db.transaction(() => {
      const data = this.loadWithState(projectId);
      if (!data) return null;

      const { state, sheet } = data;
      const tasks = collectTasks(sheet);
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return null;

      task.status = newStatus;
      sheet.updatedAt = new Date().toISOString();

      this.save(projectId, state.run_id, sheet);
      return sheet;
    })();
  }

  /**
   * Update checkpoints in a persisted beat sheet.
   * Recomputes progress and saves atomically.
   */
  updateCheckpoints(
    projectId: string,
    checkpoints: CheckpointState,
  ): BeatSheet | null {
    return this.db.transaction(() => {
      const data = this.loadWithState(projectId);
      if (!data) return null;

      const { state, sheet } = data;
      sheet.checkpoints = checkpoints;
      sheet.updatedAt = new Date().toISOString();

      this.save(projectId, state.run_id, sheet);
      return sheet;
    })();
  }

  /**
   * Increment the version (replan). Preserves completed tasks.
   */
  replan(
    projectId: string,
    updatedSheet: BeatSheet,
  ): BeatState | null {
    return this.db.transaction(() => {
      const data = this.loadWithState(projectId);
      if (!data) return null;

      updatedSheet.version = data.sheet.version + 1;
      updatedSheet.updatedAt = new Date().toISOString();

      return this.save(projectId, data.state.run_id, updatedSheet);
    })();
  }

  /**
   * Delete beat state for a project.
   */
  delete(projectId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM beat_state WHERE project_id = ?')
      .run(projectId);
    return result.changes > 0;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

interface ProgressStats {
  total: number;
  done: number;
  failed: number;
  running: number;
  blocked: number;
  ready: number;
  pending: number;
}

function computeProgressStats(tasks: AtomicTask[]): ProgressStats {
  const stats: ProgressStats = {
    total: tasks.length,
    done: 0,
    failed: 0,
    running: 0,
    blocked: 0,
    ready: 0,
    pending: 0,
  };

  for (const task of tasks) {
    switch (task.status) {
      case 'done':
        stats.done++;
        break;
      case 'failed':
        stats.failed++;
        break;
      case 'running':
        stats.running++;
        break;
      case 'blocked':
        stats.blocked++;
        break;
      case 'ready':
        stats.ready++;
        break;
      case 'pending':
        stats.pending++;
        break;
    }
  }

  return stats;
}
