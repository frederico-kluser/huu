import type Database from 'better-sqlite3';
import type { BeatState, BeatStatus } from '../../types/index.js';

export interface UpsertBeatStateParams {
  project_id: string;
  run_id: string;
  current_act: number;
  current_sequence?: string;
  current_beat?: string;
  checkpoint_name?: string;
  progress_pct: number;
  status: BeatStatus;
  blocked_reason?: string;
  snapshot_json?: string;
}

export class BeatStateRepository {
  constructor(private readonly db: Database.Database) {}

  /** Upsert beat state (1 row per project). */
  upsert(params: UpsertBeatStateParams): BeatState {
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
        project_id: params.project_id,
        run_id: params.run_id,
        current_act: params.current_act,
        current_sequence: params.current_sequence ?? null,
        current_beat: params.current_beat ?? null,
        checkpoint_name: params.checkpoint_name ?? null,
        progress_pct: params.progress_pct,
        status: params.status,
        blocked_reason: params.blocked_reason ?? null,
        snapshot_json: params.snapshot_json ?? '{}',
      }) as BeatState;
  }

  /** Get current beat state by project. O(1) via PK. */
  get(projectId: string): BeatState | undefined {
    return this.db
      .prepare('SELECT * FROM beat_state WHERE project_id = ?')
      .get(projectId) as BeatState | undefined;
  }

  /** Set blocked status with reason. */
  block(projectId: string, reason: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE beat_state
         SET status = 'blocked',
             blocked_reason = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE project_id = ?`,
      )
      .run(reason, projectId);
    return result.changes > 0;
  }

  /** Clear blocked status. */
  unblock(projectId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE beat_state
         SET status = 'running',
             blocked_reason = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE project_id = ? AND status = 'blocked'`,
      )
      .run(projectId);
    return result.changes > 0;
  }
}
