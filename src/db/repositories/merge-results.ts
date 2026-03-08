import type Database from 'better-sqlite3';
import type {
  MergeResult,
  PremergeStatus,
  MergeTier,
  MergeMode,
  MergeOutcome,
} from '../../types/index.js';

export interface InsertMergeResultParams {
  request_id: string;
  queue_id: number;
  source_branch: string;
  source_head_sha: string;
  target_branch: string;
  target_head_before: string | null;
  target_head_after: string | null;
  premerge_status: PremergeStatus;
  tier_selected: MergeTier;
  merge_mode: MergeMode | null;
  outcome: MergeOutcome;
  conflicts?: string[] | undefined;
  error_code?: string | undefined;
  error_message?: string | undefined;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  attempt: number;
}

export class MergeResultsRepository {
  private readonly insertStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO merge_results (
        request_id, queue_id, source_branch, source_head_sha, target_branch,
        target_head_before, target_head_after, premerge_status, tier_selected,
        merge_mode, outcome, conflicts_json, error_code, error_message,
        started_at, finished_at, duration_ms, attempt
      ) VALUES (
        @request_id, @queue_id, @source_branch, @source_head_sha, @target_branch,
        @target_head_before, @target_head_after, @premerge_status, @tier_selected,
        @merge_mode, @outcome, @conflicts_json, @error_code, @error_message,
        @started_at, @finished_at, @duration_ms, @attempt
      )
      RETURNING *
    `);

    this.getByIdStmt = db.prepare('SELECT * FROM merge_results WHERE id = ?');
  }

  insert(params: InsertMergeResultParams): MergeResult {
    return this.insertStmt.get({
      request_id: params.request_id,
      queue_id: params.queue_id,
      source_branch: params.source_branch,
      source_head_sha: params.source_head_sha,
      target_branch: params.target_branch,
      target_head_before: params.target_head_before,
      target_head_after: params.target_head_after,
      premerge_status: params.premerge_status,
      tier_selected: params.tier_selected,
      merge_mode: params.merge_mode ?? null,
      outcome: params.outcome,
      conflicts_json: JSON.stringify(params.conflicts ?? []),
      error_code: params.error_code ?? null,
      error_message: params.error_message ?? null,
      started_at: params.started_at,
      finished_at: params.finished_at,
      duration_ms: params.duration_ms,
      attempt: params.attempt,
    }) as MergeResult;
  }

  getById(id: number): MergeResult | undefined {
    return this.getByIdStmt.get(id) as MergeResult | undefined;
  }

  listByQueueId(queueId: number): MergeResult[] {
    return this.db
      .prepare('SELECT * FROM merge_results WHERE queue_id = ? ORDER BY attempt ASC')
      .all(queueId) as MergeResult[];
  }

  listByRequestId(requestId: string): MergeResult[] {
    return this.db
      .prepare('SELECT * FROM merge_results WHERE request_id = ? ORDER BY created_at ASC')
      .all(requestId) as MergeResult[];
  }

  listRecent(limit: number = 50): MergeResult[] {
    return this.db
      .prepare('SELECT * FROM merge_results ORDER BY created_at DESC LIMIT ?')
      .all(limit) as MergeResult[];
  }
}
