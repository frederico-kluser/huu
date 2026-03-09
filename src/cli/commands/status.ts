import path from 'node:path';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import type { Message, MessageType } from '../../types/index.js';
import type { MergeQueueItem } from '../../types/index.js';
import { renderStatusScreen } from '../render.js';

// ── Constants ────────────────────────────────────────────────────────

const DB_PATH = '.huu/huu.db';

// ── Status derivation ────────────────────────────────────────────────

export type AggregateStatus =
  | 'idle'
  | 'running'
  | 'merge_pending'
  | 'merged'
  | 'failed'
  | 'escalated'
  | 'aborted'
  | 'conflict';

export interface StatusSnapshot {
  status: AggregateStatus;
  runId: string | null;
  agentName: string | null;
  lastEventType: MessageType | null;
  lastEventTime: string | null;
  lastEventPayload: Record<string, unknown> | null;
  mergeSummary: MergeSummary | null;
  messageStats: Record<string, number>;
}

interface MergeSummary {
  status: string;
  sourceBranch: string | null;
  targetBranch: string | null;
  lastError: string | null;
}

/** Derive an aggregate status from recent messages. */
export function deriveStatus(db: Database.Database): StatusSnapshot {
  // Get the most recent run_id from messages
  const latestMsg = db
    .prepare(
      `SELECT * FROM messages
       WHERE run_id IS NOT NULL
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get() as Message | undefined;

  if (!latestMsg) {
    return {
      status: 'idle',
      runId: null,
      agentName: null,
      lastEventType: null,
      lastEventTime: null,
      lastEventPayload: null,
      mergeSummary: null,
      messageStats: {},
    };
  }

  const runId = latestMsg.run_id;

  // Get all messages for this run, ordered by time
  const runMessages = db
    .prepare(
      `SELECT * FROM messages
       WHERE run_id = ?
       ORDER BY id DESC`,
    )
    .all(runId) as Message[];

  // Get the latest event
  const lastEvent = runMessages[0]!;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(lastEvent.payload_json) as Record<string, unknown>;
  } catch {
    // ignore parse errors
  }

  // Derive aggregate status based on message history
  const typeSet = new Set(runMessages.map((m) => m.message_type));
  let status: AggregateStatus;

  if (typeSet.has('abort_ack')) {
    status = 'aborted';
  } else if (typeSet.has('escalation')) {
    const lastEscalation = runMessages.find(
      (m) => m.message_type === 'escalation',
    );
    if (lastEscalation) {
      try {
        const p = JSON.parse(lastEscalation.payload_json) as Record<string, unknown>;
        status = p['state'] === 'failed' ? 'failed' : 'escalated';
      } catch {
        status = 'escalated';
      }
    } else {
      status = 'escalated';
    }
  } else if (typeSet.has('merge_result')) {
    const mergeMsg = runMessages.find((m) => m.message_type === 'merge_result');
    if (mergeMsg) {
      try {
        const p = JSON.parse(mergeMsg.payload_json) as Record<string, unknown>;
        status = p['outcome'] === 'merged'
          ? 'merged'
          : p['outcome'] === 'conflict'
            ? 'conflict'
            : 'failed';
      } catch {
        status = 'merged';
      }
    } else {
      status = 'merged';
    }
  } else if (typeSet.has('merge_ready')) {
    status = 'merge_pending';
  } else if (typeSet.has('task_done')) {
    status = 'merge_pending';
  } else if (typeSet.has('task_progress')) {
    status = 'running';
  } else if (typeSet.has('task_assigned')) {
    status = 'running';
  } else {
    status = 'idle';
  }

  // Message stats
  const messageStats: Record<string, number> = {};
  for (const msg of runMessages) {
    messageStats[msg.message_type] = (messageStats[msg.message_type] ?? 0) + 1;
  }

  // Merge summary from merge_queue table
  let mergeSummary: MergeSummary | null = null;
  try {
    const mergeItem = db
      .prepare(
        `SELECT * FROM merge_queue
         WHERE request_id LIKE ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(`run-${runId}%`) as MergeQueueItem | undefined;

    if (mergeItem) {
      mergeSummary = {
        status: mergeItem.status,
        sourceBranch: mergeItem.source_branch,
        targetBranch: mergeItem.target_branch,
        lastError: mergeItem.last_error,
      };
    }
  } catch {
    // merge_queue table may not exist yet
  }

  return {
    status,
    runId,
    agentName: lastEvent.sender_agent,
    lastEventType: lastEvent.message_type,
    lastEventTime: lastEvent.created_at,
    lastEventPayload: payload,
    mergeSummary,
    messageStats,
  };
}

// ── CLI action ───────────────────────────────────────────────────────

export async function statusAction(): Promise<void> {
  const cwd = process.cwd();
  const dbPath = path.join(cwd, DB_PATH);

  if (!fs.existsSync(dbPath)) {
    const idleSnapshot: StatusSnapshot = {
      status: 'idle',
      runId: null,
      agentName: null,
      lastEventType: null,
      lastEventTime: null,
      lastEventPayload: null,
      mergeSummary: null,
      messageStats: {},
    };
    await renderStatusScreen(idleSnapshot);
    return;
  }

  const db = openDatabase(dbPath);
  try {
    migrate(db);
    const snapshot = deriveStatus(db);
    await renderStatusScreen(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read status: ${message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
