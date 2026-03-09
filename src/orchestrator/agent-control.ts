// Agent control bridge — orchestrator ↔ runtime for steer/follow-up/abort
//
// Manages pending steer commands (last-write-wins) and follow-up queues
// (FIFO per agentRunId). Provides the interface for the runtime to poll
// for pending interventions at safe interrupt points.

import type { MessageQueue } from '../db/queue.js';
import type { InterventionPayload } from './interventions.js';
import { publishInterventionTransition } from './interventions.js';

// ── Follow-up queue ───────────────────────────────────────────────────

export const MAX_FOLLOW_UP_QUEUE = 10;

interface FollowUpEntry {
  commandId: string;
  text: string;
  createdAt: string;
  position: number;
}

/** FIFO follow-up queue per agent run. */
export class FollowUpQueue {
  private readonly queues = new Map<string, FollowUpEntry[]>();

  /** Enqueue a follow-up instruction. Returns position or null if limit reached. */
  enqueue(agentRunId: string, entry: Omit<FollowUpEntry, 'position'>): number | null {
    let queue = this.queues.get(agentRunId);
    if (!queue) {
      queue = [];
      this.queues.set(agentRunId, queue);
    }

    if (queue.length >= MAX_FOLLOW_UP_QUEUE) {
      return null; // queue_limit_reached
    }

    const position = queue.length + 1;
    queue.push({ ...entry, position });
    return position;
  }

  /** Dequeue the next follow-up (FIFO). Returns undefined if empty. */
  dequeue(agentRunId: string): FollowUpEntry | undefined {
    const queue = this.queues.get(agentRunId);
    if (!queue || queue.length === 0) return undefined;
    return queue.shift();
  }

  /** Get pending count for an agent run. */
  pendingCount(agentRunId: string): number {
    return this.queues.get(agentRunId)?.length ?? 0;
  }

  /** Cancel all pending follow-ups for an agent run. Returns canceled entries. */
  cancelAll(agentRunId: string): FollowUpEntry[] {
    const queue = this.queues.get(agentRunId);
    if (!queue) return [];
    const canceled = [...queue];
    queue.length = 0;
    this.queues.delete(agentRunId);
    return canceled;
  }

  /** Check if there are pending follow-ups. */
  hasPending(agentRunId: string): boolean {
    const queue = this.queues.get(agentRunId);
    return queue !== undefined && queue.length > 0;
  }
}

// ── Steer registry (last-write-wins) ──────────────────────────────────

interface PendingSteer {
  commandId: string;
  text: string;
  requestedAt: string;
}

/** Pending steer commands per agent run. Last-write-wins semantics. */
export class SteerRegistry {
  private readonly pending = new Map<string, PendingSteer>();

  /** Set a steer command. Returns the previous commandId if superseded. */
  set(agentRunId: string, steer: PendingSteer): string | null {
    const previous = this.pending.get(agentRunId);
    this.pending.set(agentRunId, steer);
    return previous?.commandId ?? null;
  }

  /** Consume the pending steer (removes it). Returns undefined if none. */
  consume(agentRunId: string): PendingSteer | undefined {
    const steer = this.pending.get(agentRunId);
    if (steer) {
      this.pending.delete(agentRunId);
    }
    return steer;
  }

  /** Check if there's a pending steer. */
  hasPending(agentRunId: string): boolean {
    return this.pending.has(agentRunId);
  }

  /** Clear pending steer (e.g., on abort). */
  clear(agentRunId: string): void {
    this.pending.delete(agentRunId);
  }
}

// ── AgentControlBridge ────────────────────────────────────────────────

export interface AgentControlDeps {
  queue: MessageQueue;
  projectId: string;
}

/**
 * Central bridge between the orchestrator and agent runtimes for
 * intervention commands. Manages steer (last-write-wins) and follow-up
 * (FIFO) queues.
 */
export class AgentControlBridge {
  readonly steers = new SteerRegistry();
  readonly followUps = new FollowUpQueue();
  private readonly deps: AgentControlDeps;

  constructor(deps: AgentControlDeps) {
    this.deps = deps;
  }

  /**
   * Handle a steer intervention: store for next safe point.
   * If a previous steer is pending, it gets superseded (canceled).
   */
  handleSteer(payload: InterventionPayload): void {
    const supersededId = this.steers.set(payload.agentRunId, {
      commandId: payload.commandId,
      text: payload.text ?? '',
      requestedAt: payload.requestedAt,
    });

    // Cancel superseded steer
    if (supersededId) {
      const superseded: InterventionPayload = {
        ...payload,
        commandId: supersededId,
      };
      publishInterventionTransition(
        this.deps.queue,
        superseded,
        'canceled',
        this.deps.projectId,
        'superseded_by_newer_steer',
      );
    }

    // ACK the new steer
    publishInterventionTransition(
      this.deps.queue,
      payload,
      'accepted',
      this.deps.projectId,
    );
  }

  /**
   * Handle a follow-up intervention: enqueue for after current turn.
   */
  handleFollowUp(payload: InterventionPayload): void {
    const position = this.followUps.enqueue(payload.agentRunId, {
      commandId: payload.commandId,
      text: payload.text ?? '',
      createdAt: payload.requestedAt,
    });

    if (position === null) {
      publishInterventionTransition(
        this.deps.queue,
        payload,
        'rejected',
        this.deps.projectId,
        'queue_limit_reached',
      );
      return;
    }

    payload.meta = { ...payload.meta, followUpPosition: position };
    publishInterventionTransition(
      this.deps.queue,
      payload,
      'accepted',
      this.deps.projectId,
    );
  }

  /**
   * Called at turn_end to drain the follow-up queue (one per turn).
   * Returns the text to inject as the next user message, or undefined.
   */
  drainFollowUp(agentRunId: string): { commandId: string; text: string } | undefined {
    const entry = this.followUps.dequeue(agentRunId);
    if (!entry) return undefined;
    return { commandId: entry.commandId, text: entry.text };
  }

  /**
   * Called at safe interrupt point to check for pending steer.
   * Returns the steer text to inject, or undefined.
   */
  consumeSteer(agentRunId: string): { commandId: string; text: string } | undefined {
    const steer = this.steers.consume(agentRunId);
    if (!steer) return undefined;
    return { commandId: steer.commandId, text: steer.text };
  }

  /**
   * Cancel all pending controls for an agent run (used by abort).
   */
  cancelAllPending(agentRunId: string): void {
    this.steers.clear(agentRunId);
    this.followUps.cancelAll(agentRunId);
  }

  /**
   * Get pending follow-up count for display in UI.
   */
  getPendingFollowUpCount(agentRunId: string): number {
    return this.followUps.pendingCount(agentRunId);
  }
}
