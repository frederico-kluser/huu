import type Database from 'better-sqlite3';
import type { MergeQueueItem } from '../../types/index.js';

export interface EnqueueMergeParams {
  request_id: string;
  source_branch: string;
  source_head_sha: string;
  target_branch?: string;
  max_attempts?: number;
}

export class MergeQueueRepository {
  private readonly enqueueStmt: Database.Statement;
  private readonly claimStmt: Database.Statement;
  private readonly heartbeatStmt: Database.Statement;
  private readonly completeStmt: Database.Statement;
  private readonly failStmt: Database.Statement;
  private readonly conflictStmt: Database.Statement;
  private readonly requeueStmt: Database.Statement;
  private readonly recoverStmt: Database.Statement;
  private readonly blockHumanStmt: Database.Statement;
  private readonly resumeFromBlockStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly getByRequestIdStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.enqueueStmt = db.prepare(`
      INSERT INTO merge_queue (
        request_id, source_branch, source_head_sha, target_branch, max_attempts
      ) VALUES (
        @request_id, @source_branch, @source_head_sha, @target_branch, @max_attempts
      )
      RETURNING *
    `);

    // Atomic FIFO claim: picks next available item and locks it
    this.claimStmt = db.prepare(`
      UPDATE merge_queue
      SET status = 'in_progress',
          lease_owner = @worker_id,
          lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || @lease_seconds || ' seconds'),
          attempts = attempts + 1,
          started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = (
        SELECT id
        FROM merge_queue
        WHERE status IN ('queued','retry_wait')
          AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      )
      RETURNING *
    `);

    this.heartbeatStmt = db.prepare(`
      UPDATE merge_queue
      SET lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || @lease_seconds || ' seconds'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status = 'in_progress' AND lease_owner = @worker_id
    `);

    this.completeStmt = db.prepare(`
      UPDATE merge_queue
      SET status = 'merged',
          finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status = 'in_progress'
    `);

    this.failStmt = db.prepare(`
      UPDATE merge_queue
      SET status = 'failed',
          last_error = @error,
          finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status IN ('in_progress', 'blocked_human')
    `);

    this.conflictStmt = db.prepare(`
      UPDATE merge_queue
      SET status = 'conflict',
          last_error = @error,
          finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status = 'in_progress'
    `);

    this.requeueStmt = db.prepare(`
      UPDATE merge_queue
      SET status = 'retry_wait',
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = @error,
          available_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || @backoff_seconds || ' seconds'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status = 'in_progress' AND attempts < max_attempts
    `);

    this.recoverStmt = db.prepare(`
      UPDATE merge_queue
      SET status = CASE
            WHEN attempts >= max_attempts THEN 'failed'
            ELSE 'retry_wait'
          END,
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = 'lease expired (worker crash recovery)',
          available_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE status = 'in_progress'
        AND lease_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `);

    this.blockHumanStmt = db.prepare(`
      UPDATE merge_queue
      SET status = 'blocked_human',
          last_error = @error,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status = 'in_progress'
    `);

    this.resumeFromBlockStmt = db.prepare(`
      UPDATE merge_queue
      SET status = 'in_progress',
          lease_owner = @worker_id,
          lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || @lease_seconds || ' seconds'),
          last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status = 'blocked_human'
    `);

    this.getByIdStmt = db.prepare('SELECT * FROM merge_queue WHERE id = ?');
    this.getByRequestIdStmt = db.prepare('SELECT * FROM merge_queue WHERE request_id = ?');
  }

  enqueue(params: EnqueueMergeParams): MergeQueueItem {
    return this.enqueueStmt.get({
      request_id: params.request_id,
      source_branch: params.source_branch,
      source_head_sha: params.source_head_sha,
      target_branch: params.target_branch ?? 'main',
      max_attempts: params.max_attempts ?? 3,
    }) as MergeQueueItem;
  }

  /** Atomically claim the next FIFO item. Returns undefined if queue is empty. */
  claim(workerId: string, leaseSeconds: number = 120): MergeQueueItem | undefined {
    const claimTx = this.db.transaction(() => {
      this.recoverStmt.run();
      return this.claimStmt.get({
        worker_id: workerId,
        lease_seconds: leaseSeconds,
      }) as MergeQueueItem | undefined;
    });
    return claimTx.immediate();
  }

  heartbeat(id: number, workerId: string, leaseSeconds: number = 120): boolean {
    const result = this.heartbeatStmt.run({
      id,
      worker_id: workerId,
      lease_seconds: leaseSeconds,
    });
    return result.changes > 0;
  }

  complete(id: number): boolean {
    const result = this.completeStmt.run({ id });
    return result.changes > 0;
  }

  fail(id: number, error: string): boolean {
    const result = this.failStmt.run({ id, error });
    return result.changes > 0;
  }

  markConflict(id: number, error: string): boolean {
    const result = this.conflictStmt.run({ id, error });
    return result.changes > 0;
  }

  requeue(id: number, error: string, backoffSeconds: number = 30): boolean {
    const result = this.requeueStmt.run({
      id,
      error,
      backoff_seconds: backoffSeconds,
    });
    return result.changes > 0;
  }

  recoverExpiredLeases(): number {
    const result = this.recoverStmt.run();
    return result.changes;
  }

  getById(id: number): MergeQueueItem | undefined {
    return this.getByIdStmt.get(id) as MergeQueueItem | undefined;
  }

  getByRequestId(requestId: string): MergeQueueItem | undefined {
    return this.getByRequestIdStmt.get(requestId) as MergeQueueItem | undefined;
  }

  listPending(): MergeQueueItem[] {
    return this.db
      .prepare(
        `SELECT * FROM merge_queue
         WHERE status IN ('queued','retry_wait')
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as MergeQueueItem[];
  }

  blockHuman(id: number, error: string): boolean {
    const result = this.blockHumanStmt.run({ id, error });
    return result.changes > 0;
  }

  resumeFromBlock(id: number, workerId: string, leaseSeconds: number = 120): boolean {
    const result = this.resumeFromBlockStmt.run({
      id,
      worker_id: workerId,
      lease_seconds: leaseSeconds,
    });
    return result.changes > 0;
  }

  listBlockedHuman(): MergeQueueItem[] {
    return this.db
      .prepare(
        `SELECT * FROM merge_queue
         WHERE status = 'blocked_human'
         ORDER BY updated_at ASC`,
      )
      .all() as MergeQueueItem[];
  }

  countByStatus(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM merge_queue GROUP BY status')
      .all() as Array<{ status: string; count: number }>;
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.status] = row.count;
    }
    return result;
  }
}
