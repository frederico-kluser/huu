import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import {
  classifyEscalation,
  determineAction,
  EscalationManager,
} from '../escalations.js';

// ── Classification tests ────────────────────────────────────────────

describe('classifyEscalation', () => {
  it('should classify merge conflicts as medium severity', () => {
    const result = classifyEscalation('Merge conflict in README.md', 0);
    expect(result.category).toBe('merge_conflict');
    expect(result.severity).toBe('medium');
  });

  it('should classify timeouts', () => {
    const result = classifyEscalation('Operation timed out', 0);
    expect(result.category).toBe('timeout');
    expect(result.severity).toBe('low');
  });

  it('should classify missing context', () => {
    const result = classifyEscalation('File not found: src/foo.ts', 0);
    expect(result.category).toBe('missing_context');
    expect(result.severity).toBe('low');
  });

  it('should classify tool failures', () => {
    const result = classifyEscalation('Tool execution failed: permission denied', 0);
    expect(result.category).toBe('tool_failure');
    expect(result.severity).toBe('medium');
  });

  it('should classify dependency deadlocks as critical', () => {
    const result = classifyEscalation('Dependency cycle detected', 0);
    expect(result.category).toBe('dependency_deadlock');
    expect(result.severity).toBe('critical');
  });

  it('should classify agent crash loops', () => {
    const result = classifyEscalation('Agent crash detected', 2);
    expect(result.category).toBe('agent_crash_loop');
    expect(result.severity).toBe('critical');
  });

  it('should escalate severity with retries', () => {
    const r0 = classifyEscalation('unknown error', 0);
    const r3 = classifyEscalation('unknown error', 3);
    expect(r0.severity).toBe('low');
    expect(r3.severity).toBe('high');
  });

  it('should handle Error objects', () => {
    const result = classifyEscalation(new Error('Merge conflict'), 0);
    expect(result.category).toBe('merge_conflict');
  });
});

describe('determineAction', () => {
  it('should retry on low severity', () => {
    const action = determineAction('low', 'timeout', 0, 3);
    expect(action.action).toBe('retry');
  });

  it('should reroute missing_context to researcher', () => {
    const action = determineAction('medium', 'missing_context', 0, 3);
    expect(action.action).toBe('reroute');
    expect(action.targetAgent).toBe('researcher');
  });

  it('should reroute merge_conflict to merger', () => {
    const action = determineAction('medium', 'merge_conflict', 0, 3);
    expect(action.action).toBe('reroute');
    expect(action.targetAgent).toBe('merger');
  });

  it('should pause scope on high severity', () => {
    const action = determineAction('high', 'agent_crash_loop', 3, 3);
    expect(action.action).toBe('pause_scope');
  });

  it('should fail on critical severity', () => {
    const action = determineAction('critical', 'dependency_deadlock', 0, 3);
    expect(action.action).toBe('fail');
  });

  it('should retry medium tool_failure when retries available', () => {
    const action = determineAction('medium', 'tool_failure', 0, 3);
    expect(action.action).toBe('retry');
  });

  it('should pause scope when medium retries exhausted', () => {
    const action = determineAction('medium', 'tool_failure', 3, 3);
    expect(action.action).toBe('pause_scope');
  });
});

// ── EscalationManager tests ─────────────────────────────────────────

describe('EscalationManager', () => {
  let db: Database.Database;
  let queue: MessageQueue;
  let manager: EscalationManager;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
    queue = new MessageQueue(db);
    manager = new EscalationManager(queue, 'proj-1');
  });

  afterEach(() => {
    db?.close();
  });

  it('should raise and track escalation', () => {
    const record = manager.raise(
      { runId: 'run-1', taskId: 'task-1', error: 'Something failed' },
      0,
      3,
    );

    expect(record).not.toBeNull();
    expect(record!.status).toBe('open');
    expect(record!.taskId).toBe('task-1');
    expect(record!.runId).toBe('run-1');
  });

  it('should deduplicate identical escalations within window', () => {
    const r1 = manager.raise(
      { runId: 'run-1', taskId: 'task-1', error: 'Same error' },
      0,
      3,
    );
    const r2 = manager.raise(
      { runId: 'run-1', taskId: 'task-1', error: 'Same error' },
      0,
      3,
    );

    expect(r1).not.toBeNull();
    expect(r2).toBeNull(); // deduplicated
  });

  it('should allow different errors from same task', () => {
    const r1 = manager.raise(
      { runId: 'run-1', taskId: 'task-1', error: 'Error A' },
      0,
      3,
    );
    const r2 = manager.raise(
      { runId: 'run-1', taskId: 'task-1', error: 'Error B' },
      0,
      3,
    );

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
  });

  it('should acknowledge escalation', () => {
    const record = manager.raise(
      { runId: 'run-1', error: 'test' },
      0,
      3,
    );
    expect(manager.acknowledge(record!.id)).toBe(true);
    expect(manager.getOpen()).toHaveLength(1); // acked is still "open"
  });

  it('should resolve escalation', () => {
    const record = manager.raise(
      { runId: 'run-1', error: 'test' },
      0,
      3,
    );
    expect(manager.resolve(record!.id)).toBe(true);
    expect(manager.getOpen()).toHaveLength(0);
  });

  it('should mark escalation as failed', () => {
    const record = manager.raise(
      { runId: 'run-1', error: 'test' },
      0,
      3,
    );
    expect(manager.markFailed(record!.id)).toBe(true);
    expect(manager.getOpen()).toHaveLength(0);
  });

  it('should track critical escalations', () => {
    manager.raise(
      { runId: 'run-1', error: 'Dependency cycle detected' },
      0,
      3,
    );
    expect(manager.hasCriticalOpen()).toBe(true);
  });

  it('should not report critical after resolution', () => {
    const record = manager.raise(
      { runId: 'run-1', error: 'Dependency cycle detected' },
      0,
      3,
    );
    manager.resolve(record!.id);
    expect(manager.hasCriticalOpen()).toBe(false);
  });

  it('should raise loop errors', () => {
    const record = manager.raiseLoopError(new Error('tick failed'), 'run-1');
    expect(record).not.toBeNull();
    expect(record!.agentName).toBeNull();
    expect(record!.context).toEqual({ source: 'loop' });
  });

  it('should publish escalation to message queue', () => {
    manager.raise(
      { runId: 'run-1', taskId: 'task-1', error: 'Some error' },
      0,
      3,
    );

    // Check that an escalation message was published
    const msg = queue.dequeue({ recipient: 'orchestrator' });
    expect(msg).toBeDefined();
    expect(msg!.message_type).toBe('escalation');
  });

  it('should filter open escalations by taskId', () => {
    manager.raise({ runId: 'run-1', taskId: 'task-1', error: 'Error 1' }, 0, 3);
    manager.raise({ runId: 'run-1', taskId: 'task-2', error: 'Error 2' }, 0, 3);

    expect(manager.getOpen('task-1')).toHaveLength(1);
    expect(manager.getOpen('task-2')).toHaveLength(1);
    expect(manager.getOpen()).toHaveLength(2);
  });
});
