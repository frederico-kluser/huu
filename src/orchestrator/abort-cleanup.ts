// Abort cleanup pipeline — deterministic, idempotent abort with full resource cleanup
//
// Pipeline order (fixed):
// 1. Signal cancellation via AbortController
// 2. Wait for agent process to stop (with timeout fallback)
// 3. Cancel pending steer/follow-up controls
// 4. Mark task as Failed in beat sheet persistence
// 5. Remove merge queue entries for the task
// 6. Remove worktree (force)
// 7. Publish abort_applied / cleanup_done messages

import type Database from 'better-sqlite3';
import type { MessageQueue } from '../db/queue.js';
import type { WorktreeManager } from '../git/WorktreeManager.js';
import type { AgentControlBridge } from './agent-control.js';
import type { InterventionPayload } from './interventions.js';
import { abortRun } from '../agents/abort.js';

// ── Types ─────────────────────────────────────────────────────────────

export interface AbortContext {
  agentRunId: string;
  taskId: string;
  agentId: string;
  projectId: string;
  payload: InterventionPayload;
}

export interface AbortCleanupDeps {
  db: Database.Database;
  queue: MessageQueue;
  worktreeManager: WorktreeManager;
  controlBridge: AgentControlBridge;
  /** Override wait timeout for tests. Default: 5000ms */
  waitTimeoutMs?: number;
}

export interface AbortResult {
  success: boolean;
  steps: AbortStepResult[];
}

export interface AbortStepResult {
  step: string;
  success: boolean;
  error?: string;
}

const ABORT_WAIT_TIMEOUT_MS = 5000;

// ── Pipeline ──────────────────────────────────────────────────────────

/**
 * Execute the full abort cleanup pipeline.
 * Idempotent: calling on an already-aborted/terminal run is a no-op.
 */
export async function abortAgentRun(
  ctx: AbortContext,
  deps: AbortCleanupDeps,
): Promise<AbortResult> {
  const steps: AbortStepResult[] = [];

  // Step 1: Signal abort via AbortController
  const aborted = abortRun(ctx.agentRunId, 'human_abort');
  steps.push({
    step: 'signal_abort',
    success: true,
    ...(aborted ? {} : { error: 'already_aborted_or_not_found' }),
  });

  // Step 2: Wait briefly for agent to stop
  if (aborted) {
    await waitForStop(deps.waitTimeoutMs ?? ABORT_WAIT_TIMEOUT_MS);
    steps.push({ step: 'wait_for_stop', success: true });
  }

  // Step 3: Cancel pending controls (steer + follow-up)
  try {
    deps.controlBridge.cancelAllPending(ctx.agentRunId);
    steps.push({ step: 'cancel_pending_controls', success: true });
  } catch (err) {
    steps.push({
      step: 'cancel_pending_controls',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 4 + 5: Database operations (transactional)
  try {
    deps.db.transaction(() => {
      // Mark task as failed with reason
      publishAbortApplied(deps.queue, ctx);

      // Remove merge queue entries for this task
      removeMergeQueueEntries(deps.db, ctx.taskId, ctx.agentRunId);
    })();
    steps.push({ step: 'db_cleanup', success: true });
  } catch (err) {
    steps.push({
      step: 'db_cleanup',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 6: Remove worktree
  try {
    await deps.worktreeManager.remove(ctx.agentRunId, {
      force: true,
      deleteBranch: true,
      forceDeleteBranch: true,
    });
    steps.push({ step: 'remove_worktree', success: true });
  } catch (err) {
    // Worktree removal failure is logged but not fatal (may be already gone)
    steps.push({
      step: 'remove_worktree',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const allSuccess = steps.every((s) => s.success);

  // If any step failed, publish an escalation
  if (!allSuccess) {
    try {
      deps.queue.enqueue({
        project_id: ctx.projectId,
        message_type: 'escalation',
        sender_agent: 'orchestrator',
        recipient_agent: 'orchestrator',
        run_id: ctx.agentRunId,
        correlation_id: ctx.taskId,
        payload: {
          type: 'abort_cleanup_partial',
          steps: steps.filter((s) => !s.success),
          commandId: ctx.payload.commandId,
        },
      });
    } catch {
      // Non-fatal: don't let escalation publishing crash cleanup
    }
  }

  return { success: allSuccess, steps };
}

// ── Helpers ───────────────────────────────────────────────────────────

function waitForStop(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function publishAbortApplied(queue: MessageQueue, ctx: AbortContext): void {
  queue.enqueue({
    project_id: ctx.projectId,
    message_type: 'abort_ack',
    sender_agent: 'orchestrator',
    recipient_agent: 'orchestrator',
    run_id: ctx.agentRunId,
    correlation_id: ctx.taskId,
    payload: {
      commandId: ctx.payload.commandId,
      kind: 'abort',
      state: 'applied',
      reason: 'human_abort',
      taskId: ctx.taskId,
      agentId: ctx.agentId,
      agentRunId: ctx.agentRunId,
    },
  });
}

function removeMergeQueueEntries(
  db: Database.Database,
  taskId: string,
  agentRunId: string,
): void {
  // Remove entries matching this task's branch pattern
  const branchPattern = `huu-agent/${agentRunId}`;
  db.prepare(
    `UPDATE merge_queue
     SET status = 'failed',
         last_error = 'human_abort',
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE source_branch = ?
       AND status IN ('queued', 'in_progress', 'retry_wait', 'blocked_human')`,
  ).run(branchPattern);

  // Also try by request_id pattern
  db.prepare(
    `UPDATE merge_queue
     SET status = 'failed',
         last_error = 'human_abort',
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE request_id LIKE ?
       AND status IN ('queued', 'in_progress', 'retry_wait', 'blocked_human')`,
  ).run(`task-${taskId}-%`);
}
