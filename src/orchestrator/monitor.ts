// Monitor — SQLite polling with watermark for incremental message consumption
//
// Responsible for:
// - Polling messages incrementally by monotonic id (watermark)
// - Classifying messages by type for the orchestrator
// - Batched consumption with configurable limits
// - Idempotent: same watermark always returns same result set

import type Database from 'better-sqlite3';
import type { Message, MessageType } from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────

export interface PollResult {
  messages: Message[];
  newWatermark: number;
}

export interface MonitorOptions {
  batchSize?: number | undefined;
  /** Message types to listen for. If empty, listens to all. */
  messageTypes?: MessageType[] | undefined;
}

/** Classified batch of polled messages. */
export interface ClassifiedMessages {
  taskProgress: Message[];
  taskDone: Message[];
  mergeResult: Message[];
  escalation: Message[];
  healthCheck: Message[];
  other: Message[];
  all: Message[];
}

// ── Monitor class ────────────────────────────────────────────────────

export class OrchestratorMonitor {
  private watermark: number;
  private readonly batchSize: number;
  private readonly messageTypes: MessageType[];
  private readonly pollStmt: Database.Statement;
  private readonly pollAllStmt: Database.Statement;

  constructor(
    private readonly db: Database.Database,
    options?: MonitorOptions,
  ) {
    this.watermark = 0;
    this.batchSize = options?.batchSize ?? 200;
    this.messageTypes = options?.messageTypes ?? [];

    // Prepared statements for polling
    this.pollStmt = db.prepare(`
      SELECT * FROM messages
      WHERE id > @lastSeen
        AND message_type IN (SELECT value FROM json_each(@types))
      ORDER BY id ASC
      LIMIT @limit
    `);

    this.pollAllStmt = db.prepare(`
      SELECT * FROM messages
      WHERE id > @lastSeen
      ORDER BY id ASC
      LIMIT @limit
    `);
  }

  /**
   * Get current watermark.
   */
  getWatermark(): number {
    return this.watermark;
  }

  /**
   * Set watermark explicitly (e.g., for crash recovery from persisted state).
   */
  setWatermark(value: number): void {
    if (value < 0) throw new Error('Watermark must be non-negative');
    this.watermark = value;
  }

  /**
   * Poll for new messages since last watermark.
   * Advances watermark to the highest id seen.
   */
  poll(): PollResult {
    let rows: Message[];

    if (this.messageTypes.length > 0) {
      rows = this.pollStmt.all({
        lastSeen: this.watermark,
        types: JSON.stringify(this.messageTypes),
        limit: this.batchSize,
      }) as Message[];
    } else {
      rows = this.pollAllStmt.all({
        lastSeen: this.watermark,
        limit: this.batchSize,
      }) as Message[];
    }

    let newWatermark = this.watermark;
    if (rows.length > 0) {
      const lastMsg = rows[rows.length - 1]!;
      newWatermark = lastMsg.id;
      this.watermark = newWatermark;
    }

    return { messages: rows, newWatermark };
  }

  /**
   * Poll and classify messages by type.
   */
  pollAndClassify(): ClassifiedMessages {
    const { messages } = this.poll();
    return classifyMessages(messages);
  }

  /**
   * Check if there are pending messages without advancing watermark.
   */
  hasPending(): boolean {
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM messages
      WHERE id > @lastSeen
      LIMIT 1
    `);
    const row = countStmt.get({ lastSeen: this.watermark }) as { cnt: number };
    return row.cnt > 0;
  }
}

// ── Classification ───────────────────────────────────────────────────

export function classifyMessages(messages: Message[]): ClassifiedMessages {
  const result: ClassifiedMessages = {
    taskProgress: [],
    taskDone: [],
    mergeResult: [],
    escalation: [],
    healthCheck: [],
    other: [],
    all: messages,
  };

  for (const msg of messages) {
    switch (msg.message_type) {
      case 'task_progress':
        result.taskProgress.push(msg);
        break;
      case 'task_done':
        result.taskDone.push(msg);
        break;
      case 'merge_result':
        result.mergeResult.push(msg);
        break;
      case 'escalation':
        result.escalation.push(msg);
        break;
      case 'health_check':
        result.healthCheck.push(msg);
        break;
      default:
        result.other.push(msg);
        break;
    }
  }

  return result;
}

/**
 * Parse payload JSON from a message safely.
 */
export function parsePayload(msg: Message): Record<string, unknown> {
  try {
    return JSON.parse(msg.payload_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
