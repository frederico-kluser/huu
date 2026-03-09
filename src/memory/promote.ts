// Promote — human-driven promotion of task learnings to instincts
//
// Transforms a Done task's outcomes into an explicit instinct record
// with full provenance. Includes deduplication by content hash.

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MessageQueue } from '../db/queue.js';
import { InstinctRepository } from '../db/repositories/instincts.js';

// ── Types ─────────────────────────────────────────────────────────────

export interface PromoteInput {
  taskId: string;
  agentId: string;
  projectId: string;
  title: string;
  content: string;
  tags: string[];
  confidence: number; // 0.3..0.85
}

export interface PromoteResult {
  success: boolean;
  instinctId?: number | undefined;
  duplicate?: boolean | undefined;
  error?: string | undefined;
}

// ── Validation ────────────────────────────────────────────────────────

const MIN_CONFIDENCE = 0.3;
const MAX_CONFIDENCE = 0.85;

export function validatePromoteInput(input: PromoteInput): { valid: boolean; reason?: string | undefined } {
  if (!input.title || input.title.trim().length === 0) {
    return { valid: false, reason: 'title is required' };
  }
  if (!input.content || input.content.trim().length === 0) {
    return { valid: false, reason: 'content is required' };
  }
  if (input.confidence < MIN_CONFIDENCE || input.confidence > MAX_CONFIDENCE) {
    return { valid: false, reason: `confidence must be between ${MIN_CONFIDENCE} and ${MAX_CONFIDENCE}` };
  }
  return { valid: true };
}

// ── Deduplication ─────────────────────────────────────────────────────

/**
 * Compute a deduplication hash from title + normalized content + source task.
 */
export function computeDedupeHash(title: string, content: string, taskId: string): string {
  const normalized = `${title.trim().toLowerCase()}|${content.trim().toLowerCase()}|${taskId}`;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Check if a duplicate instinct already exists.
 */
export function checkDuplicate(db: Database.Database, projectId: string, hash: string): number | null {
  const row = db.prepare(
    `SELECT id FROM instincts
     WHERE project_id = ?
       AND json_extract(metadata_json, '$.dedupe_hash') = ?
       AND state != 'deprecated'`,
  ).get(projectId, hash) as { id: number } | undefined;
  return row?.id ?? null;
}

// ── Promote flow ──────────────────────────────────────────────────────

/**
 * Promote a task's learning to an instinct record.
 *
 * Steps:
 * 1. Validate input
 * 2. Check for duplicates
 * 3. Insert into instincts table with provenance
 * 4. Publish intervention_applied message
 */
export function promoteToInstinct(
  db: Database.Database,
  queue: MessageQueue,
  input: PromoteInput,
): PromoteResult {
  // 1. Validate
  const validation = validatePromoteInput(input);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  // 2. Deduplication
  const hash = computeDedupeHash(input.title, input.content, input.taskId);
  const existingId = checkDuplicate(db, input.projectId, hash);
  if (existingId !== null) {
    return { success: false, duplicate: true, instinctId: existingId, error: 'duplicate instinct detected' };
  }

  // 3. Insert
  const repo = new InstinctRepository(db);
  const metadata = {
    source_task_id: input.taskId,
    source_agent_id: input.agentId,
    created_by: 'human',
    tags: input.tags,
    dedupe_hash: hash,
  };

  const instinct = repo.create({
    project_id: input.projectId,
    title: input.title,
    instinct_text: input.content,
    confidence: input.confidence,
    state: 'candidate',
    metadata_json: JSON.stringify(metadata),
  });

  // 4. Publish message
  try {
    queue.enqueue({
      project_id: input.projectId,
      message_type: 'promote_instinct',
      sender_agent: 'human',
      recipient_agent: 'orchestrator',
      correlation_id: input.taskId,
      payload: {
        kind: 'promote',
        state: 'applied',
        instinctId: instinct.id,
        taskId: input.taskId,
        title: input.title,
      },
    });
  } catch {
    // Non-fatal: instinct was already persisted
  }

  return { success: true, instinctId: instinct.id };
}
