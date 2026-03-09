import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../db/migrator.js';
import {
  EventLog,
  TaskAttemptTracker,
  RecoveryEngine,
  persistTaskTransition,
} from '../recovery.js';
import { RunStateMachine } from '../state-machine.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('EventLog', () => {
  let db: Database.Database;
  let log: EventLog;

  beforeEach(() => {
    db = createDb();
    log = new EventLog(db);
  });

  it('appends events and returns ID', () => {
    const id = log.append({
      runId: 'run-1',
      taskId: 'task-1',
      eventType: 'task_state_change',
      payload: { from: 'assigned', to: 'running' },
    });
    expect(id).toBeGreaterThan(0);
  });

  it('deduplicates by idempotency key', () => {
    const id1 = log.append({
      runId: 'run-1',
      eventType: 'test',
      payload: {},
      idempotencyKey: 'key-1',
    });
    const id2 = log.append({
      runId: 'run-1',
      eventType: 'test',
      payload: { different: true },
      idempotencyKey: 'key-1',
    });
    expect(id1).not.toBeNull();
    expect(id2).toBeNull();
  });

  it('getEventsAfter returns events after watermark', () => {
    log.append({ runId: 'run-1', eventType: 'a', payload: {} });
    log.append({ runId: 'run-1', eventType: 'b', payload: {} });
    log.append({ runId: 'run-1', eventType: 'c', payload: {} });

    const events = log.getEventsAfter('run-1', 1);
    expect(events.length).toBe(2);
    expect(events[0]!.event_type).toBe('b');
    expect(events[1]!.event_type).toBe('c');
  });

  it('hasIdempotencyKey checks existence', () => {
    log.append({ runId: 'run-1', eventType: 'test', payload: {}, idempotencyKey: 'key-1' });
    expect(log.hasIdempotencyKey('run-1', 'key-1')).toBe(true);
    expect(log.hasIdempotencyKey('run-1', 'key-2')).toBe(false);
  });

  it('getMaxEventId returns highest ID', () => {
    expect(log.getMaxEventId('run-1')).toBe(0);
    log.append({ runId: 'run-1', eventType: 'a', payload: {} });
    log.append({ runId: 'run-1', eventType: 'b', payload: {} });
    expect(log.getMaxEventId('run-1')).toBe(2);
  });
});

describe('TaskAttemptTracker', () => {
  let db: Database.Database;
  let tracker: TaskAttemptTracker;

  beforeEach(() => {
    db = createDb();
    tracker = new TaskAttemptTracker(db);
  });

  it('records and retrieves attempts', () => {
    tracker.recordAttempt({
      runId: 'run-1',
      taskId: 'task-1',
      attempt: 1,
      state: 'assigned',
      agentName: 'builder',
    });

    const latest = tracker.getLatestAttempt('run-1', 'task-1');
    expect(latest).toBeDefined();
    expect(latest!.state).toBe('assigned');
    expect(latest!.agent_name).toBe('builder');
  });

  it('updates state', () => {
    tracker.recordAttempt({
      runId: 'run-1',
      taskId: 'task-1',
      attempt: 1,
      state: 'assigned',
    });

    tracker.updateState('run-1', 'task-1', 1, 'running');
    const latest = tracker.getLatestAttempt('run-1', 'task-1');
    expect(latest!.state).toBe('running');
  });

  it('sets finished_at on terminal states', () => {
    tracker.recordAttempt({
      runId: 'run-1',
      taskId: 'task-1',
      attempt: 1,
      state: 'running',
    });

    tracker.updateState('run-1', 'task-1', 1, 'done');
    const latest = tracker.getLatestAttempt('run-1', 'task-1');
    expect(latest!.finished_at).not.toBeNull();
  });

  it('updates heartbeat', () => {
    tracker.recordAttempt({
      runId: 'run-1',
      taskId: 'task-1',
      attempt: 1,
      state: 'running',
    });

    const before = tracker.getLatestAttempt('run-1', 'task-1')!.heartbeat_at;
    // Small delay to ensure timestamp changes
    tracker.updateHeartbeat('run-1', 'task-1', 1);
    const after = tracker.getLatestAttempt('run-1', 'task-1')!.heartbeat_at;
    expect(after).toBeDefined();
    // Heartbeat should be same or newer (could be same ms)
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('getActiveAttempts returns only running/assigned', () => {
    tracker.recordAttempt({ runId: 'run-1', taskId: 'task-1', attempt: 1, state: 'running' });
    tracker.recordAttempt({ runId: 'run-1', taskId: 'task-2', attempt: 1, state: 'done' });
    tracker.recordAttempt({ runId: 'run-1', taskId: 'task-3', attempt: 1, state: 'assigned' });

    const active = tracker.getActiveAttempts('run-1');
    expect(active.length).toBe(2);
    expect(active.map(a => a.task_id).sort()).toEqual(['task-1', 'task-3']);
  });

  it('getAttemptCount counts attempts', () => {
    tracker.recordAttempt({ runId: 'run-1', taskId: 'task-1', attempt: 1, state: 'failed' });
    tracker.recordAttempt({ runId: 'run-1', taskId: 'task-1', attempt: 2, state: 'running' });

    expect(tracker.getAttemptCount('run-1', 'task-1')).toBe(2);
  });
});

describe('persistTaskTransition', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
    const sm = new RunStateMachine(db);
    sm.createRun('run-1', 'proj-1');
    const tracker = new TaskAttemptTracker(db);
    tracker.recordAttempt({ runId: 'run-1', taskId: 'task-1', attempt: 1, state: 'assigned' });
  });

  it('atomically updates task state and appends event', () => {
    persistTaskTransition(db, {
      runId: 'run-1',
      taskId: 'task-1',
      attempt: 1,
      nextState: 'running',
      eventType: 'task_state_change',
      payload: { from: 'assigned', to: 'running' },
      idempotencyKey: 'task-1-running-1',
    });

    const tracker = new TaskAttemptTracker(db);
    const attempt = tracker.getLatestAttempt('run-1', 'task-1')!;
    expect(attempt.state).toBe('running');

    const log = new EventLog(db);
    expect(log.hasIdempotencyKey('run-1', 'task-1-running-1')).toBe(true);
  });

  it('is idempotent — second call does not duplicate', () => {
    persistTaskTransition(db, {
      runId: 'run-1',
      taskId: 'task-1',
      attempt: 1,
      nextState: 'running',
      eventType: 'task_state_change',
      payload: {},
      idempotencyKey: 'unique-key',
    });

    // Second call with same key — should not throw
    persistTaskTransition(db, {
      runId: 'run-1',
      taskId: 'task-1',
      attempt: 1,
      nextState: 'running',
      eventType: 'task_state_change',
      payload: {},
      idempotencyKey: 'unique-key',
    });

    const log = new EventLog(db);
    const events = log.getEventsAfter('run-1', 0);
    // Only one event with this idempotency key (plus the create run event)
    const matching = events.filter(e => e.idempotency_key === 'unique-key');
    expect(matching.length).toBe(1);
  });
});

describe('RecoveryEngine', () => {
  let db: Database.Database;
  let engine: RecoveryEngine;

  beforeEach(() => {
    db = createDb();
    engine = new RecoveryEngine(db);
  });

  it('validates database integrity', () => {
    const result = engine.validateIntegrity();
    expect(result.ok).toBe(true);
  });

  it('recovers an interrupted run', () => {
    const sm = new RunStateMachine(db);
    sm.createRun('run-1', 'proj-1');

    // Simulate some work
    const tracker = new TaskAttemptTracker(db);
    tracker.recordAttempt({ runId: 'run-1', taskId: 'task-1', attempt: 1, state: 'done' });
    tracker.recordAttempt({ runId: 'run-1', taskId: 'task-2', attempt: 1, state: 'running' });

    const log = new EventLog(db);
    log.append({ runId: 'run-1', taskId: 'task-1', eventType: 'task_done', payload: {} });
    log.append({ runId: 'run-1', taskId: 'task-2', eventType: 'task_started', payload: {} });

    // Recover
    const result = engine.recover('run-1');
    expect(result.runId).toBe('run-1');
    expect(result.previousStatus).toBe('running');
    expect(result.eventsReplayed).toBe(2);
    expect(result.recoveryDurationMs).toBeGreaterThanOrEqual(0);

    // Run should be back to running
    const run = sm.getRun('run-1')!;
    expect(run.status).toBe('running');
  });

  it('findAndRecover finds the most recent interrupted run', () => {
    const sm = new RunStateMachine(db);
    sm.createRun('run-1', 'proj-1');
    sm.transition('run-1', 'done', 'complete');
    sm.createRun('run-2', 'proj-1');

    const result = engine.findAndRecover('proj-1');
    expect(result).toBeDefined();
    expect(result!.runId).toBe('run-2');
  });

  it('returns undefined when no interrupted runs exist', () => {
    const sm = new RunStateMachine(db);
    sm.createRun('run-1', 'proj-1');
    sm.transition('run-1', 'done', 'complete');

    const result = engine.findAndRecover('proj-1');
    expect(result).toBeUndefined();
  });

  it('buildSnapshot returns run state', () => {
    const sm = new RunStateMachine(db);
    sm.createRun('run-1', 'proj-1');

    const snapshot = engine.buildSnapshot('run-1');
    expect(snapshot).toBeDefined();
    expect(snapshot!.run.status).toBe('running');
    expect(snapshot!.highWatermark).toBe(0);
  });

  it('performs WAL checkpoint without error', () => {
    expect(() => engine.checkpoint('PASSIVE')).not.toThrow();
  });
});
