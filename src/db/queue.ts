import type Database from 'better-sqlite3';
import type { Message, MessageType } from '../types/index.js';

export interface EnqueueParams {
  project_id: string;
  message_type: MessageType;
  sender_agent: string;
  recipient_agent: string;
  payload: unknown;
  run_id?: string;
  correlation_id?: string;
  causation_id?: number;
  priority?: number;
  max_attempts?: number;
  available_at?: string;
}

export interface DequeueOptions {
  recipient: string;
  lockTimeoutSeconds?: number;
}

/**
 * Message queue with SQLite-backed persistence.
 * Provides enqueue, atomic dequeue, ack, nack (retry), and DLQ semantics.
 */
export class MessageQueue {
  private readonly enqueueStmt: Database.Statement;
  private readonly dequeueStmt: Database.Statement;
  private readonly ackStmt: Database.Statement;
  private readonly nackStmt: Database.Statement;
  private readonly deadLetterStmt: Database.Statement;
  private readonly recoverStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.enqueueStmt = db.prepare(`
      INSERT INTO messages (
        project_id, run_id, correlation_id, causation_id,
        message_type, sender_agent, recipient_agent,
        priority, payload_json, max_attempts, available_at
      ) VALUES (
        @project_id, @run_id, @correlation_id, @causation_id,
        @message_type, @sender_agent, @recipient_agent,
        @priority, @payload_json, @max_attempts, @available_at
      )
      RETURNING *
    `);

    this.dequeueStmt = db.prepare(`
      UPDATE messages
      SET status = 'processing',
          locked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          lock_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || @lock_seconds || ' seconds'),
          attempt_count = attempt_count + 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = (
        SELECT id
        FROM messages
        WHERE recipient_agent = @recipient
          AND status = 'pending'
          AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
        ORDER BY priority ASC, id ASC
        LIMIT 1
      )
      RETURNING *
    `);

    this.ackStmt = db.prepare(`
      UPDATE messages
      SET status = 'acked',
          acked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status = 'processing'
    `);

    this.nackStmt = db.prepare(`
      UPDATE messages
      SET status = 'pending',
          locked_at = NULL,
          lock_expires_at = NULL,
          error_text = @error_text,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status = 'processing' AND attempt_count < max_attempts
    `);

    this.deadLetterStmt = db.prepare(`
      UPDATE messages
      SET status = 'dead_letter',
          error_text = @error_text,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND status = 'processing'
    `);

    this.recoverStmt = db.prepare(`
      UPDATE messages
      SET status = CASE
            WHEN attempt_count >= max_attempts THEN 'dead_letter'
            ELSE 'pending'
          END,
          locked_at = NULL,
          lock_expires_at = NULL,
          error_text = 'lock timeout expired',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE status = 'processing'
        AND lock_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `);
  }

  /** Add a message to the queue. */
  enqueue(params: EnqueueParams): Message {
    return this.enqueueStmt.get({
      project_id: params.project_id,
      run_id: params.run_id ?? null,
      correlation_id: params.correlation_id ?? null,
      causation_id: params.causation_id ?? null,
      message_type: params.message_type,
      sender_agent: params.sender_agent,
      recipient_agent: params.recipient_agent,
      priority: params.priority ?? 100,
      payload_json: JSON.stringify(params.payload),
      max_attempts: params.max_attempts ?? 5,
      available_at: params.available_at ?? new Date().toISOString(),
    }) as Message;
  }

  /** Atomically dequeue the next available message for a recipient. */
  dequeue(options: DequeueOptions): Message | undefined {
    const recoverAndDequeue = this.db.transaction(() => {
      // First recover any expired locks
      this.recoverStmt.run();
      // Then try to dequeue
      return this.dequeueStmt.get({
        recipient: options.recipient,
        lock_seconds: options.lockTimeoutSeconds ?? 30,
      }) as Message | undefined;
    });
    return recoverAndDequeue.immediate();
  }

  /** Acknowledge successful processing of a message. */
  ack(id: number): boolean {
    const result = this.ackStmt.run({ id });
    return result.changes > 0;
  }

  /**
   * Negative-acknowledge: return message to pending for retry,
   * or move to dead_letter if max_attempts exceeded.
   */
  nack(id: number, errorText: string): boolean {
    const nackTx = this.db.transaction(() => {
      const result = this.nackStmt.run({ id, error_text: errorText });
      if (result.changes === 0) {
        // Max attempts exceeded — move to DLQ
        const dlqResult = this.deadLetterStmt.run({
          id,
          error_text: errorText,
        });
        return dlqResult.changes > 0;
      }
      return true;
    });
    return nackTx.immediate();
  }

  /** Recover messages with expired locks (timed out processing). */
  recoverTimedOut(): number {
    const result = this.recoverStmt.run();
    return result.changes;
  }

  /** Get a message by ID. */
  getById(id: number): Message | undefined {
    return this.db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(id) as Message | undefined;
  }

  /** Count messages by status for a recipient. */
  countByStatus(
    recipient: string,
  ): Record<string, number> {
    const rows = this.db
      .prepare(
        'SELECT status, COUNT(*) as count FROM messages WHERE recipient_agent = ? GROUP BY status',
      )
      .all(recipient) as Array<{ status: string; count: number }>;
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.status] = row.count;
    }
    return result;
  }
}
