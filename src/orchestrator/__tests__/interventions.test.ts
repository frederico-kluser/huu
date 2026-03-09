import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import {
  validateIntervention,
  dispatchIntervention,
  publishInterventionTransition,
} from '../interventions.js';
import type { InterventionPayload, TaskStatus } from '../interventions.js';

let db: Database.Database;
let queue: MessageQueue;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  queue = new MessageQueue(db);
});

afterEach(() => {
  db?.close();
});

describe('validateIntervention', () => {
  it('allows steer for running task', () => {
    const result = validateIntervention('steer', { taskStatus: 'running' });
    expect(result.valid).toBe(true);
  });

  it('rejects steer for done task', () => {
    const result = validateIntervention('steer', { taskStatus: 'done' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Running');
  });

  it('rejects steer for failed task', () => {
    const result = validateIntervention('steer', { taskStatus: 'failed' });
    expect(result.valid).toBe(false);
  });

  it('allows follow_up for running task', () => {
    const result = validateIntervention('follow_up', { taskStatus: 'running' });
    expect(result.valid).toBe(true);
  });

  it('rejects follow_up for backlog task', () => {
    const result = validateIntervention('follow_up', { taskStatus: 'backlog' });
    expect(result.valid).toBe(false);
  });

  it('allows abort for running task', () => {
    const result = validateIntervention('abort', { taskStatus: 'running' });
    expect(result.valid).toBe(true);
  });

  it('rejects abort for done task', () => {
    const result = validateIntervention('abort', { taskStatus: 'done' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('terminal');
  });

  it('rejects abort for failed task', () => {
    const result = validateIntervention('abort', { taskStatus: 'failed' });
    expect(result.valid).toBe(false);
  });

  it('allows promote for done task', () => {
    const result = validateIntervention('promote', { taskStatus: 'done' });
    expect(result.valid).toBe(true);
  });

  it('rejects promote for running task', () => {
    const result = validateIntervention('promote', { taskStatus: 'running' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Done');
  });
});

describe('dispatchIntervention', () => {
  it('dispatches steer with correct priority', () => {
    const result = dispatchIntervention(queue, {
      kind: 'steer',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      projectId: 'proj-1',
      text: 'focus on the API endpoint',
    });

    expect(result.commandId).toBeTruthy();
    expect(result.messageId).toBeGreaterThan(0);
    expect(result.state).toBe('queued');

    const msg = queue.getById(result.messageId);
    expect(msg).toBeDefined();
    expect(msg!.message_type).toBe('steer');
    expect(msg!.priority).toBe(10);

    const payload = JSON.parse(msg!.payload_json);
    expect(payload.kind).toBe('steer');
    expect(payload.text).toBe('focus on the API endpoint');
    expect(payload.commandId).toBe(result.commandId);
  });

  it('dispatches follow_up with correct priority', () => {
    const result = dispatchIntervention(queue, {
      kind: 'follow_up',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      projectId: 'proj-1',
      text: 'add tests after',
    });

    const msg = queue.getById(result.messageId);
    expect(msg!.message_type).toBe('follow_up');
    expect(msg!.priority).toBe(50);
  });

  it('dispatches abort with highest priority', () => {
    const result = dispatchIntervention(queue, {
      kind: 'abort',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      projectId: 'proj-1',
    });

    const msg = queue.getById(result.messageId);
    expect(msg!.message_type).toBe('abort_requested');
    expect(msg!.priority).toBe(1);
  });

  it('dispatches promote', () => {
    const result = dispatchIntervention(queue, {
      kind: 'promote',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      projectId: 'proj-1',
    });

    const msg = queue.getById(result.messageId);
    expect(msg!.message_type).toBe('promote_instinct');
    expect(msg!.priority).toBe(100);
  });

  it('generates unique commandIds', () => {
    const r1 = dispatchIntervention(queue, {
      kind: 'steer',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      projectId: 'proj-1',
      text: 'a',
    });
    const r2 = dispatchIntervention(queue, {
      kind: 'steer',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      projectId: 'proj-1',
      text: 'b',
    });
    expect(r1.commandId).not.toBe(r2.commandId);
  });
});

describe('publishInterventionTransition', () => {
  it('publishes state transitions', () => {
    const payload: InterventionPayload = {
      commandId: 'cmd-1',
      kind: 'steer',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      requestedBy: 'human',
      text: 'redirect',
      requestedAt: new Date().toISOString(),
      state: 'queued',
    };

    publishInterventionTransition(queue, payload, 'applied', 'proj-1');

    // Should have enqueued a transition message
    const msg = queue.dequeue({ recipient: 'orchestrator' });
    expect(msg).toBeDefined();
    const p = JSON.parse(msg!.payload_json);
    expect(p.state).toBe('applied');
    expect(p.commandId).toBe('cmd-1');
  });
});
