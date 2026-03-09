// Escalation handler — classification, workflow, and persistence
//
// Responsible for:
// - Classifying escalations by severity and category
// - Tracking escalation lifecycle (open → acked → resolved/failed)
// - Rate limiting and deduplication
// - Deciding scope of impact (pause task, sequence, or entire loop)

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MessageQueue } from '../db/queue.js';
import type {
  EscalationSeverity,
  EscalationCategory,
  EscalationStatus,
  EscalationRecord,
} from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────

export interface EscalationInput {
  taskId?: string | undefined;
  agentName?: string | undefined;
  runId: string;
  error: Error | string;
  context?: Record<string, unknown> | undefined;
}

export interface EscalationAction {
  action: 'retry' | 'reroute' | 'pause_scope' | 'fail';
  targetAgent?: string | undefined;
  reason: string;
}

// ── Classification ───────────────────────────────────────────────────

/**
 * Classify an error into a severity and category.
 * Uses heuristics based on error message content.
 */
export function classifyEscalation(
  error: Error | string,
  retryCount: number,
): { severity: EscalationSeverity; category: EscalationCategory } {
  const message = (error instanceof Error ? error.message : error).toLowerCase();

  // Category detection
  let category: EscalationCategory = 'unknown';
  if (message.includes('conflict') || message.includes('merge')) {
    category = 'merge_conflict';
  } else if (message.includes('context') || message.includes('not found') || message.includes('missing')) {
    category = 'missing_context';
  } else if (message.includes('tool') || message.includes('execute') || message.includes('permission')) {
    category = 'tool_failure';
  } else if (message.includes('deadlock') || message.includes('cycle') || message.includes('circular')) {
    category = 'dependency_deadlock';
  } else if (message.includes('timeout') || message.includes('timed out') || message.includes('stuck')) {
    category = 'timeout';
  } else if (message.includes('crash') || message.includes('abort') || message.includes('killed')) {
    category = 'agent_crash_loop';
  }

  // Severity based on category + retry count
  let severity: EscalationSeverity;
  if (category === 'dependency_deadlock') {
    severity = 'critical';
  } else if (category === 'agent_crash_loop' && retryCount >= 2) {
    severity = 'critical';
  } else if (retryCount >= 3) {
    severity = 'high';
  } else if (category === 'merge_conflict' || category === 'tool_failure') {
    severity = 'medium';
  } else if (retryCount >= 1) {
    severity = 'medium';
  } else {
    severity = 'low';
  }

  return { severity, category };
}

/**
 * Determine the action to take for a given escalation.
 */
export function determineAction(
  severity: EscalationSeverity,
  category: EscalationCategory,
  retryCount: number,
  maxRetries: number,
): EscalationAction {
  // Low severity: retry locally
  if (severity === 'low' && retryCount < maxRetries) {
    return { action: 'retry', reason: `Low severity, retry ${retryCount + 1}/${maxRetries}` };
  }

  // Medium: try reroute to debugger/researcher, or retry
  if (severity === 'medium') {
    if (category === 'missing_context') {
      return { action: 'reroute', targetAgent: 'researcher', reason: 'Missing context — rerouting to researcher' };
    }
    if (category === 'tool_failure' && retryCount < maxRetries) {
      return { action: 'retry', reason: `Tool failure, retry ${retryCount + 1}/${maxRetries}` };
    }
    if (category === 'merge_conflict') {
      return { action: 'reroute', targetAgent: 'merger', reason: 'Merge conflict — rerouting to merger agent' };
    }
    if (retryCount < maxRetries) {
      return { action: 'retry', reason: `Medium severity, retry ${retryCount + 1}/${maxRetries}` };
    }
    return { action: 'pause_scope', reason: 'Medium severity, retries exhausted' };
  }

  // High: pause affected scope
  if (severity === 'high') {
    return { action: 'pause_scope', reason: `High severity: ${category}` };
  }

  // Critical: fail the task
  return { action: 'fail', reason: `Critical escalation: ${category}` };
}

// ── Escalation Manager ───────────────────────────────────────────────

export class EscalationManager {
  private readonly records: Map<string, EscalationRecord> = new Map();
  /** Deduplication window: signature → timestamp */
  private readonly recentSignatures: Map<string, number> = new Map();
  private readonly dedupeWindowMs: number;

  constructor(
    private readonly queue: MessageQueue,
    private readonly projectId: string,
    options?: { dedupeWindowMs?: number | undefined },
  ) {
    this.dedupeWindowMs = options?.dedupeWindowMs ?? 30_000;
  }

  /**
   * Raise an escalation. Returns the record if created, or null if deduped.
   */
  raise(input: EscalationInput, retryCount: number, maxRetries: number): EscalationRecord | null {
    const errorMsg = input.error instanceof Error ? input.error.message : input.error;

    // Deduplication by signature
    const signature = `${input.taskId ?? ''}:${input.agentName ?? ''}:${errorMsg.slice(0, 100)}`;
    const now = Date.now();
    const lastSeen = this.recentSignatures.get(signature);
    if (lastSeen !== undefined && now - lastSeen < this.dedupeWindowMs) {
      return null; // deduplicated
    }
    this.recentSignatures.set(signature, now);

    // Clean old signatures
    for (const [sig, ts] of this.recentSignatures) {
      if (now - ts > this.dedupeWindowMs) {
        this.recentSignatures.delete(sig);
      }
    }

    const { severity, category } = classifyEscalation(input.error, retryCount);

    const record: EscalationRecord = {
      id: crypto.randomUUID(),
      taskId: input.taskId ?? null,
      agentName: input.agentName ?? null,
      runId: input.runId,
      severity,
      category,
      status: 'open',
      message: errorMsg,
      context: input.context ?? {},
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };

    this.records.set(record.id, record);

    // Publish to message queue
    try {
      const enqueueParams: Parameters<typeof this.queue.enqueue>[0] = {
        project_id: this.projectId,
        message_type: 'escalation',
        sender_agent: 'orchestrator',
        recipient_agent: 'orchestrator',
        run_id: input.runId,
        payload: {
          escalationId: record.id,
          severity,
          category,
          state: severity === 'critical' ? 'failed' : 'escalated',
          error: errorMsg,
          action: determineAction(severity, category, retryCount, maxRetries),
        },
      };
      if (input.taskId) {
        enqueueParams.correlation_id = input.taskId;
      }
      this.queue.enqueue(enqueueParams);
    } catch {
      // Non-critical: don't let publishing failure break escalation
    }

    return record;
  }

  /**
   * Raise a loop-level error (not tied to a specific task).
   */
  raiseLoopError(err: unknown, runId: string): EscalationRecord | null {
    const error = err instanceof Error ? err : new Error(String(err));
    return this.raise(
      { runId, error, context: { source: 'loop' } },
      0,
      0,
    );
  }

  /**
   * Acknowledge an escalation.
   */
  acknowledge(escalationId: string): boolean {
    const record = this.records.get(escalationId);
    if (!record || record.status !== 'open') return false;
    record.status = 'acked';
    return true;
  }

  /**
   * Resolve an escalation.
   */
  resolve(escalationId: string): boolean {
    const record = this.records.get(escalationId);
    if (!record || (record.status !== 'open' && record.status !== 'acked')) return false;
    record.status = 'resolved';
    record.resolvedAt = new Date().toISOString();
    return true;
  }

  /**
   * Mark an escalation as failed (unresolvable).
   */
  markFailed(escalationId: string): boolean {
    const record = this.records.get(escalationId);
    if (!record) return false;
    record.status = 'failed';
    record.resolvedAt = new Date().toISOString();
    return true;
  }

  /**
   * Get open escalations (optionally filtered by task).
   */
  getOpen(taskId?: string): EscalationRecord[] {
    const open: EscalationRecord[] = [];
    for (const record of this.records.values()) {
      if (record.status !== 'open' && record.status !== 'acked') continue;
      if (taskId !== undefined && record.taskId !== taskId) continue;
      open.push(record);
    }
    return open;
  }

  /**
   * Check if there are any critical open escalations.
   */
  hasCriticalOpen(): boolean {
    for (const record of this.records.values()) {
      if (
        (record.status === 'open' || record.status === 'acked') &&
        record.severity === 'critical'
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all records (for testing/debugging).
   */
  getAllRecords(): EscalationRecord[] {
    return [...this.records.values()];
  }
}
