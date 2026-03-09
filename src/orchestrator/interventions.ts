// Intervention contract and dispatch — human control commands for running agents
//
// Provides typed intervention payloads, validation, and dispatch via the
// SQLite message queue. All four intervention kinds (steer, follow_up, abort,
// promote) flow through this module before reaching agent-control or promote.

import crypto from 'node:crypto';
import type { MessageQueue } from '../db/queue.js';

// ── Types ─────────────────────────────────────────────────────────────

export type InterventionKind = 'steer' | 'follow_up' | 'abort' | 'promote';

export type InterventionState =
  | 'queued'
  | 'accepted'
  | 'applied'
  | 'rejected'
  | 'canceled'
  | 'failed';

export interface InterventionPayload {
  commandId: string;
  kind: InterventionKind;
  taskId: string;
  agentId: string;
  agentRunId: string;
  requestedBy: 'human';
  text?: string | undefined;
  requestedAt: string;
  state: InterventionState;
  reason?: string | undefined;
  meta?: {
    replacesCommandId?: string | undefined;
    followUpPosition?: number | undefined;
    promotedInstinctId?: string | undefined;
  } | undefined;
}

export interface DispatchInterventionInput {
  kind: InterventionKind;
  taskId: string;
  agentId: string;
  agentRunId: string;
  projectId: string;
  text?: string;
}

export interface DispatchResult {
  commandId: string;
  messageId: number;
  state: InterventionState;
}

// ── Validation ────────────────────────────────────────────────────────

export type TaskStatus = 'backlog' | 'running' | 'review' | 'done' | 'failed';

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['done', 'failed']);

export interface ValidationContext {
  taskStatus: TaskStatus;
}

export function validateIntervention(
  kind: InterventionKind,
  ctx: ValidationContext,
): { valid: boolean; reason?: string | undefined } {
  // Promote requires task to be Done
  if (kind === 'promote') {
    if (ctx.taskStatus !== 'done') {
      return { valid: false, reason: `promote requires task in Done, got ${ctx.taskStatus}` };
    }
    return { valid: true };
  }

  // Steer and follow_up require task to be Running
  if (kind === 'steer' || kind === 'follow_up') {
    if (ctx.taskStatus !== 'running') {
      return { valid: false, reason: `${kind} requires task in Running, got ${ctx.taskStatus}` };
    }
    return { valid: true };
  }

  // Abort requires task to NOT be terminal
  if (kind === 'abort') {
    if (TERMINAL_STATUSES.has(ctx.taskStatus)) {
      return { valid: false, reason: `abort not allowed for terminal task (${ctx.taskStatus})` };
    }
    return { valid: true };
  }

  return { valid: false, reason: `unknown intervention kind: ${kind}` };
}

// ── Dispatch ──────────────────────────────────────────────────────────

/**
 * Dispatch an intervention command through the message queue.
 * Returns the commandId and messageId for tracking.
 */
export function dispatchIntervention(
  queue: MessageQueue,
  input: DispatchInterventionInput,
): DispatchResult {
  const commandId = crypto.randomUUID();
  const now = new Date().toISOString();

  const payload: InterventionPayload = {
    commandId,
    kind: input.kind,
    taskId: input.taskId,
    agentId: input.agentId,
    agentRunId: input.agentRunId,
    requestedBy: 'human',
    text: input.text,
    requestedAt: now,
    state: 'queued',
  };

  const messageType =
    input.kind === 'abort' ? 'abort_requested' as const :
    input.kind === 'promote' ? 'promote_instinct' as const :
    input.kind as 'steer' | 'follow_up';

  // Abort gets highest priority (1), steer gets 10, follow_up gets 50
  const priority =
    input.kind === 'abort' ? 1 :
    input.kind === 'steer' ? 10 :
    input.kind === 'follow_up' ? 50 : 100;

  const msg = queue.enqueue({
    project_id: input.projectId,
    message_type: messageType,
    sender_agent: 'human',
    recipient_agent: input.agentId,
    run_id: input.agentRunId,
    correlation_id: input.taskId,
    priority,
    payload,
  });

  return {
    commandId,
    messageId: msg.id,
    state: 'queued',
  };
}

// ── Transition helpers ────────────────────────────────────────────────

/**
 * Update an intervention's state by publishing an ack/applied/rejected message.
 */
export function publishInterventionTransition(
  queue: MessageQueue,
  original: InterventionPayload,
  newState: InterventionState,
  projectId: string,
  reason?: string,
): void {
  const transitioned: InterventionPayload = {
    ...original,
    state: newState,
    reason: reason ?? original.reason,
  };

  const messageType =
    newState === 'accepted' ? 'steer' as const :
    newState === 'applied' ? 'abort_ack' as const :
    newState === 'rejected' ? 'steer' as const :
    newState === 'failed' ? 'abort_ack' as const :
    'steer' as const;

  queue.enqueue({
    project_id: projectId,
    message_type: messageType,
    sender_agent: original.agentId,
    recipient_agent: 'orchestrator',
    run_id: original.agentRunId,
    correlation_id: original.taskId,
    payload: transitioned,
  });
}
