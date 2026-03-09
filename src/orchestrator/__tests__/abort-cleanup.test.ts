import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import { AgentControlBridge } from '../agent-control.js';
import { abortAgentRun } from '../abort-cleanup.js';
import type { AbortContext } from '../abort-cleanup.js';
import type { InterventionPayload } from '../interventions.js';
import { createRunAbortController, cleanupRunController } from '../../agents/abort.js';

let db: Database.Database;
let queue: MessageQueue;
let bridge: AgentControlBridge;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  queue = new MessageQueue(db);
  bridge = new AgentControlBridge({ queue, projectId: 'proj-1' });
});

afterEach(() => {
  db?.close();
});

function makeAbortContext(overrides: Partial<AbortContext> = {}): AbortContext {
  return {
    agentRunId: 'run-1',
    taskId: 'task-1',
    agentId: 'builder',
    projectId: 'proj-1',
    payload: {
      commandId: 'cmd-1',
      kind: 'abort',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      requestedBy: 'human',
      requestedAt: new Date().toISOString(),
      state: 'queued',
    },
    ...overrides,
  };
}

describe('abortAgentRun', () => {
  it('signals abort and performs cleanup', async () => {
    // Create a controller so abort can find it
    createRunAbortController('run-1');

    // Add pending controls
    bridge.handleSteer({
      commandId: 'steer-1',
      kind: 'steer',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      requestedBy: 'human',
      text: 'redirect',
      requestedAt: new Date().toISOString(),
      state: 'accepted',
    });

    const mockWorktreeManager = {
      remove: vi.fn().mockResolvedValue(undefined),
    } as any;

    const result = await abortAgentRun(makeAbortContext(), {
      db,
      queue,
      worktreeManager: mockWorktreeManager,
      controlBridge: bridge,
      waitTimeoutMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.steps.find((s) => s.step === 'signal_abort')?.success).toBe(true);
    expect(result.steps.find((s) => s.step === 'cancel_pending_controls')?.success).toBe(true);
    expect(result.steps.find((s) => s.step === 'db_cleanup')?.success).toBe(true);
    expect(result.steps.find((s) => s.step === 'remove_worktree')?.success).toBe(true);

    // Verify controls were canceled
    expect(bridge.consumeSteer('run-1')).toBeUndefined();

    // Verify worktree removal was called
    expect(mockWorktreeManager.remove).toHaveBeenCalledWith('run-1', {
      force: true,
      deleteBranch: true,
      forceDeleteBranch: true,
    });

    cleanupRunController('run-1');
  });

  it('is idempotent — second abort succeeds without error', async () => {
    createRunAbortController('run-1');

    const mockWorktreeManager = {
      remove: vi.fn().mockResolvedValue(undefined),
    } as any;

    const deps = { db, queue, worktreeManager: mockWorktreeManager, controlBridge: bridge, waitTimeoutMs: 0 };

    const r1 = await abortAgentRun(makeAbortContext(), deps);
    expect(r1.success).toBe(true);

    // Second abort — controller already aborted
    const r2 = await abortAgentRun(makeAbortContext(), deps);
    expect(r2.success).toBe(true);
    // signal_abort step should note it was already aborted
    const step = r2.steps.find((s) => s.step === 'signal_abort');
    expect(step?.error).toBe('already_aborted_or_not_found');

    cleanupRunController('run-1');
  });

  it('removes merge queue entries for the task', async () => {
    createRunAbortController('run-1');

    // Insert a merge queue entry for this task
    db.prepare(
      `INSERT INTO merge_queue (request_id, source_branch, source_head_sha, target_branch)
       VALUES ('task-task-1-run-1', 'huu-agent/run-1', 'abc123', 'main')`,
    ).run();

    const mockWorktreeManager = {
      remove: vi.fn().mockResolvedValue(undefined),
    } as any;

    await abortAgentRun(makeAbortContext(), {
      db,
      queue,
      worktreeManager: mockWorktreeManager,
      controlBridge: bridge,
      waitTimeoutMs: 0,
    });

    // Verify merge queue entry was marked as failed
    const item = db.prepare('SELECT * FROM merge_queue WHERE request_id = ?')
      .get('task-task-1-run-1') as any;
    expect(item.status).toBe('failed');
    expect(item.last_error).toBe('human_abort');

    cleanupRunController('run-1');
  });

  it('handles worktree removal failure gracefully', async () => {
    createRunAbortController('run-1');

    const mockWorktreeManager = {
      remove: vi.fn().mockRejectedValue(new Error('worktree not found')),
    } as any;

    const result = await abortAgentRun(makeAbortContext(), {
      db,
      queue,
      worktreeManager: mockWorktreeManager,
      controlBridge: bridge,
      waitTimeoutMs: 0,
    });

    // Overall failure because worktree removal failed, but not catastrophic
    expect(result.success).toBe(false);
    const worktreeStep = result.steps.find((s) => s.step === 'remove_worktree');
    expect(worktreeStep?.success).toBe(false);
    expect(worktreeStep?.error).toContain('worktree not found');

    cleanupRunController('run-1');
  });
});
