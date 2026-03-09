import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import { deriveStatus } from '../commands/status.js';
import type { AggregateStatus } from '../commands/status.js';

describe('deriveStatus', () => {
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

  it('should return idle when no messages exist', () => {
    const snapshot = deriveStatus(db);
    expect(snapshot.status).toBe('idle');
    expect(snapshot.runId).toBeNull();
    expect(snapshot.agentName).toBeNull();
    expect(snapshot.lastEventType).toBeNull();
  });

  it('should return running when task_assigned is the latest event', () => {
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_assigned',
      sender_agent: 'orchestrator',
      recipient_agent: 'builder',
      run_id: 'run-001',
      payload: { task: 'implement feature' },
    });

    const snapshot = deriveStatus(db);
    expect(snapshot.status).toBe('running');
    expect(snapshot.runId).toBe('run-001');
  });

  it('should return running when task_progress is present', () => {
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_assigned',
      sender_agent: 'orchestrator',
      recipient_agent: 'builder',
      run_id: 'run-002',
      payload: { task: 'implement feature' },
    });
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_progress',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-002',
      payload: { state: 'running', turn: 3 },
    });

    const snapshot = deriveStatus(db);
    expect(snapshot.status).toBe('running');
    expect(snapshot.runId).toBe('run-002');
    expect(snapshot.lastEventPayload).toEqual({ state: 'running', turn: 3 });
  });

  it('should return merge_pending when task_done is present', () => {
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_progress',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-003',
      payload: { state: 'running' },
    });
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_done',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-003',
      payload: { state: 'completed', commitSha: 'abc123' },
    });

    const snapshot = deriveStatus(db);
    expect(snapshot.status).toBe('merge_pending');
  });

  it('should return merged when merge_result with outcome=merged is present', () => {
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_done',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-004',
      payload: { state: 'completed' },
    });
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'merge_result',
      sender_agent: 'merger',
      recipient_agent: 'orchestrator',
      run_id: 'run-004',
      payload: { outcome: 'merged', tier: 'tier1' },
    });

    const snapshot = deriveStatus(db);
    expect(snapshot.status).toBe('merged');
  });

  it('should return conflict when merge_result with outcome=conflict', () => {
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'merge_result',
      sender_agent: 'merger',
      recipient_agent: 'orchestrator',
      run_id: 'run-005',
      payload: { outcome: 'conflict', files: ['README.md'] },
    });

    const snapshot = deriveStatus(db);
    expect(snapshot.status).toBe('conflict');
  });

  it('should return failed when escalation with state=failed', () => {
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'escalation',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-006',
      payload: { state: 'failed', error: 'something broke' },
    });

    const snapshot = deriveStatus(db);
    expect(snapshot.status).toBe('failed');
  });

  it('should return aborted when abort_ack is present', () => {
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_progress',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-007',
      payload: { state: 'running' },
    });
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'abort_ack',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-007',
      payload: { state: 'aborted' },
    });

    const snapshot = deriveStatus(db);
    expect(snapshot.status).toBe('aborted');
  });

  it('should track message statistics', () => {
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_progress',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-008',
      payload: { turn: 1 },
    });
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_progress',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-008',
      payload: { turn: 2 },
    });
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_done',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-008',
      payload: { state: 'completed' },
    });

    const snapshot = deriveStatus(db);
    expect(snapshot.messageStats['task_progress']).toBe(2);
    expect(snapshot.messageStats['task_done']).toBe(1);
  });

  it('should use the latest run for status', () => {
    // Old run
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_done',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-old',
      payload: { state: 'completed' },
    });

    // New run
    queue.enqueue({
      project_id: 'proj-1',
      message_type: 'task_progress',
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: 'run-new',
      payload: { state: 'running', turn: 1 },
    });

    const snapshot = deriveStatus(db);
    expect(snapshot.runId).toBe('run-new');
    expect(snapshot.status).toBe('running');
  });
});
