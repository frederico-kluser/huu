import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MergeConflict, MergeResolutionAttempt } from '../../types/index.js';

export interface InsertConflictParams {
  queue_item_id: string;
  file_path: string;
  conflict_fingerprint: string;
  conflict_type: string;
  merge_base_sha: string;
  ours_sha: string;
  theirs_sha: string;
}

export interface InsertAttemptParams {
  conflict_id: string;
  tier: 3 | 4;
  strategy: string;
  selected_side?: string | null;
  confidence?: number | null;
  outcome: 'success' | 'failed' | 'escalated';
  model_id?: string | null;
  prompt_hash?: string | null;
  applied_commit_sha?: string | null;
}

export interface FileStrategyStats {
  file_path: string;
  strategy: string;
  attempts: number;
  success_rate: number;
}

export class ConflictHistoryRepository {
  private readonly insertConflictStmt: Database.Statement;
  private readonly insertAttemptStmt: Database.Statement;
  private readonly getConflictByIdStmt: Database.Statement;
  private readonly getAttemptsByConflictStmt: Database.Statement;
  private readonly listConflictsByQueueItemStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertConflictStmt = db.prepare(`
      INSERT INTO merge_conflicts (
        id, queue_item_id, file_path, conflict_fingerprint, conflict_type,
        merge_base_sha, ours_sha, theirs_sha
      ) VALUES (
        @id, @queue_item_id, @file_path, @conflict_fingerprint, @conflict_type,
        @merge_base_sha, @ours_sha, @theirs_sha
      )
      RETURNING *
    `);

    this.insertAttemptStmt = db.prepare(`
      INSERT INTO merge_resolution_attempts (
        id, conflict_id, tier, strategy, selected_side, confidence,
        outcome, model_id, prompt_hash, applied_commit_sha
      ) VALUES (
        @id, @conflict_id, @tier, @strategy, @selected_side, @confidence,
        @outcome, @model_id, @prompt_hash, @applied_commit_sha
      )
      RETURNING *
    `);

    this.getConflictByIdStmt = db.prepare(
      'SELECT * FROM merge_conflicts WHERE id = ?',
    );

    this.getAttemptsByConflictStmt = db.prepare(
      'SELECT * FROM merge_resolution_attempts WHERE conflict_id = ? ORDER BY created_at ASC',
    );

    this.listConflictsByQueueItemStmt = db.prepare(
      'SELECT * FROM merge_conflicts WHERE queue_item_id = ? ORDER BY file_path ASC',
    );
  }

  insertConflict(params: InsertConflictParams): MergeConflict {
    return this.insertConflictStmt.get({
      id: randomUUID(),
      queue_item_id: params.queue_item_id,
      file_path: params.file_path,
      conflict_fingerprint: params.conflict_fingerprint,
      conflict_type: params.conflict_type,
      merge_base_sha: params.merge_base_sha,
      ours_sha: params.ours_sha,
      theirs_sha: params.theirs_sha,
    }) as MergeConflict;
  }

  insertAttempt(params: InsertAttemptParams): MergeResolutionAttempt {
    return this.insertAttemptStmt.get({
      id: randomUUID(),
      conflict_id: params.conflict_id,
      tier: params.tier,
      strategy: params.strategy,
      selected_side: params.selected_side ?? null,
      confidence: params.confidence ?? null,
      outcome: params.outcome,
      model_id: params.model_id ?? null,
      prompt_hash: params.prompt_hash ?? null,
      applied_commit_sha: params.applied_commit_sha ?? null,
    }) as MergeResolutionAttempt;
  }

  getConflictById(id: string): MergeConflict | undefined {
    return this.getConflictByIdStmt.get(id) as MergeConflict | undefined;
  }

  getAttemptsByConflict(conflictId: string): MergeResolutionAttempt[] {
    return this.getAttemptsByConflictStmt.all(conflictId) as MergeResolutionAttempt[];
  }

  listConflictsByQueueItem(queueItemId: string): MergeConflict[] {
    return this.listConflictsByQueueItemStmt.all(queueItemId) as MergeConflict[];
  }

  /**
   * Query success rates by file path and strategy.
   * Only returns results with >= minSamples attempts.
   */
  getStrategyStats(filePath: string, minSamples: number = 3): FileStrategyStats[] {
    return this.db.prepare(`
      SELECT
        mc.file_path,
        mra.strategy,
        COUNT(*) AS attempts,
        SUM(CASE WHEN mra.outcome = 'success' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS success_rate
      FROM merge_conflicts mc
      JOIN merge_resolution_attempts mra ON mc.id = mra.conflict_id
      WHERE mc.file_path = ?
      GROUP BY mc.file_path, mra.strategy
      HAVING attempts >= ?
      ORDER BY success_rate DESC, attempts DESC
    `).all(filePath, minSamples) as FileStrategyStats[];
  }

  /**
   * Get the top N most frequently conflicting files.
   */
  getHotspotFiles(limit: number = 10): Array<{ file_path: string; conflict_count: number }> {
    return this.db.prepare(`
      SELECT file_path, COUNT(*) AS conflict_count
      FROM merge_conflicts
      GROUP BY file_path
      ORDER BY conflict_count DESC
      LIMIT ?
    `).all(limit) as Array<{ file_path: string; conflict_count: number }>;
  }

  /**
   * Get history scores for a file path (ours vs theirs success rates).
   * Used by Tier 3 heuristics.
   */
  getHistoryScores(filePath: string): { ours: number; theirs: number } {
    const rows = this.db.prepare(`
      SELECT
        mra.selected_side,
        COUNT(*) AS total,
        SUM(CASE WHEN mra.outcome = 'success' THEN 1 ELSE 0 END) AS successes
      FROM merge_conflicts mc
      JOIN merge_resolution_attempts mra ON mc.id = mra.conflict_id
      WHERE mc.file_path = ? AND mra.selected_side IS NOT NULL
      GROUP BY mra.selected_side
    `).all(filePath) as Array<{ selected_side: string; total: number; successes: number }>;

    let oursScore = 0.5;
    let theirsScore = 0.5;

    for (const row of rows) {
      const rate = row.total > 0 ? row.successes / row.total : 0.5;
      if (row.selected_side === 'ours') oursScore = rate;
      if (row.selected_side === 'theirs') theirsScore = rate;
    }

    return { ours: oursScore, theirs: theirsScore };
  }
}
