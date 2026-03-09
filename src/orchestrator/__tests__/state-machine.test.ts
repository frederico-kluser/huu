import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../db/migrator.js';
import {
  RunStateMachine,
  InvalidTransitionError,
  isValidTransition,
  isTerminal,
  getAllowedTransitions,
} from '../state-machine.js';
import type { RunStatus } from '../state-machine.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('isValidTransition', () => {
  it('allows running -> draining', () => {
    expect(isValidTransition('running', 'draining')).toBe(true);
  });

  it('allows running -> recovering', () => {
    expect(isValidTransition('running', 'recovering')).toBe(true);
  });

  it('allows running -> done', () => {
    expect(isValidTransition('running', 'done')).toBe(true);
  });

  it('allows running -> failed', () => {
    expect(isValidTransition('running', 'failed')).toBe(true);
  });

  it('disallows done -> running', () => {
    expect(isValidTransition('done', 'running')).toBe(false);
  });

  it('disallows failed -> running', () => {
    expect(isValidTransition('failed', 'running')).toBe(false);
  });

  it('allows recovering -> running', () => {
    expect(isValidTransition('recovering', 'running')).toBe(true);
  });

  it('allows draining -> done', () => {
    expect(isValidTransition('draining', 'done')).toBe(true);
  });

  it('disallows draining -> running', () => {
    expect(isValidTransition('draining', 'running')).toBe(false);
  });
});

describe('isTerminal', () => {
  it('done is terminal', () => {
    expect(isTerminal('done')).toBe(true);
  });

  it('failed is terminal', () => {
    expect(isTerminal('failed')).toBe(true);
  });

  it('running is not terminal', () => {
    expect(isTerminal('running')).toBe(false);
  });
});

describe('getAllowedTransitions', () => {
  it('returns transitions for running', () => {
    const transitions = getAllowedTransitions('running');
    expect(transitions).toContain('draining');
    expect(transitions).toContain('recovering');
    expect(transitions).toContain('done');
    expect(transitions).toContain('failed');
  });

  it('returns empty for done', () => {
    expect(getAllowedTransitions('done')).toHaveLength(0);
  });
});

describe('RunStateMachine', () => {
  let db: Database.Database;
  let sm: RunStateMachine;

  beforeEach(() => {
    db = createDb();
    sm = new RunStateMachine(db);
  });

  it('creates a run in running state', () => {
    const run = sm.createRun('run-1', 'proj-1');
    expect(run.run_id).toBe('run-1');
    expect(run.status).toBe('running');
    expect(run.state_version).toBe(0);
    expect(run.last_applied_event_id).toBe(0);
  });

  it('retrieves a run by ID', () => {
    sm.createRun('run-1', 'proj-1');
    const run = sm.getRun('run-1');
    expect(run).toBeDefined();
    expect(run!.project_id).toBe('proj-1');
  });

  it('returns undefined for unknown run', () => {
    expect(sm.getRun('unknown')).toBeUndefined();
  });

  it('transitions to valid state', () => {
    sm.createRun('run-1', 'proj-1');
    const updated = sm.transition('run-1', 'draining', 'shutdown');
    expect(updated.status).toBe('draining');
    expect(updated.state_version).toBe(1);
  });

  it('rejects invalid transition', () => {
    sm.createRun('run-1', 'proj-1');
    sm.transition('run-1', 'done', 'complete');
    expect(() => sm.transition('run-1', 'running', 'invalid')).toThrow(InvalidTransitionError);
  });

  it('no-ops on same state transition', () => {
    sm.createRun('run-1', 'proj-1');
    const original = sm.getRun('run-1')!;
    const result = sm.transition('run-1', 'running');
    expect(result.state_version).toBe(original.state_version);
  });

  it('records transition history', () => {
    sm.createRun('run-1', 'proj-1');
    sm.transition('run-1', 'draining', 'shutdown');
    sm.transition('run-1', 'done', 'all_complete');

    const transitions = sm.getTransitions('run-1');
    expect(transitions.length).toBe(3); // init->running, running->draining, draining->done
    expect(transitions[0]!.from_state).toBe('init');
    expect(transitions[0]!.to_state).toBe('running');
    expect(transitions[1]!.from_state).toBe('running');
    expect(transitions[1]!.to_state).toBe('draining');
    expect(transitions[2]!.from_state).toBe('draining');
    expect(transitions[2]!.to_state).toBe('done');
  });

  it('requestShutdown transitions to draining', () => {
    sm.createRun('run-1', 'proj-1');
    const result = sm.requestShutdown('run-1');
    expect(result.status).toBe('draining');
    expect(result.shutdown_requested_at).not.toBeNull();
  });

  it('updateHighWatermark advances monotonically', () => {
    sm.createRun('run-1', 'proj-1');
    sm.updateHighWatermark('run-1', 5);
    let run = sm.getRun('run-1')!;
    expect(run.last_applied_event_id).toBe(5);

    // Won't go backwards
    sm.updateHighWatermark('run-1', 3);
    run = sm.getRun('run-1')!;
    expect(run.last_applied_event_id).toBe(5);

    // Advances forward
    sm.updateHighWatermark('run-1', 10);
    run = sm.getRun('run-1')!;
    expect(run.last_applied_event_id).toBe(10);
  });

  it('findInterruptedRuns returns non-terminal runs', () => {
    sm.createRun('run-1', 'proj-1');
    sm.createRun('run-2', 'proj-1');
    sm.transition('run-1', 'done', 'complete');

    const interrupted = sm.findInterruptedRuns('proj-1');
    expect(interrupted.length).toBe(1);
    expect(interrupted[0]!.run_id).toBe('run-2');
  });

  it('full recovery lifecycle: running -> recovering -> running -> done', () => {
    sm.createRun('run-1', 'proj-1');
    sm.transition('run-1', 'recovering', 'crash_recovery');
    sm.transition('run-1', 'running', 'recovery_complete');
    sm.transition('run-1', 'done', 'all_tasks_done');

    const run = sm.getRun('run-1')!;
    expect(run.status).toBe('done');

    const transitions = sm.getTransitions('run-1');
    expect(transitions.length).toBe(4);
  });
});
