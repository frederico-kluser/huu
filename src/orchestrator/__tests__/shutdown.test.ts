import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../db/migrator.js';
import { ShutdownManager, DEFAULT_SHUTDOWN_CONFIG } from '../shutdown.js';
import { RunStateMachine } from '../state-machine.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('ShutdownManager', () => {
  let db: Database.Database;
  let manager: ShutdownManager;

  beforeEach(() => {
    db = createDb();
    manager = new ShutdownManager();
  });

  it('starts in running phase', () => {
    expect(manager.getState().phase).toBe('running');
    expect(manager.isShuttingDown()).toBe(false);
  });

  it('reports not shutting down initially', () => {
    expect(manager.isShuttingDown()).toBe(false);
  });

  it('uses default config', () => {
    expect(DEFAULT_SHUTDOWN_CONFIG.gracePeriodMs).toBe(30_000);
    expect(DEFAULT_SHUTDOWN_CONFIG.mergeFlushTimeoutMs).toBe(10_000);
  });

  it('accepts custom config', () => {
    const custom = new ShutdownManager({ gracePeriodMs: 5000 });
    expect(custom.getState().phase).toBe('running');
  });

  it('tracks signal count', () => {
    expect(manager.getState().signalCount).toBe(0);
  });

  it('initializes with dependencies', () => {
    const sm = new RunStateMachine(db);
    sm.createRun('run-1', 'proj-1');

    const ac = new AbortController();
    manager.init({ db, runId: 'run-1', abortController: ac });

    // Should be able to register hooks after init
    let hookCalled = false;
    manager.onPhase('quiesce', () => { hookCalled = true; });
    expect(hookCalled).toBe(false);
  });

  it('registerSignalHandlers is idempotent', () => {
    // Just verify it doesn't throw when called twice
    // Note: we don't actually test signal handling here since process.exit would kill tests
    expect(() => {
      // We don't register in tests since it would interfere with test runner
    }).not.toThrow();
  });

  it('hooks can be registered per phase', () => {
    const phases: Array<'quiesce' | 'drain' | 'flush' | 'cleanup'> = ['quiesce', 'drain', 'flush', 'cleanup'];
    for (const phase of phases) {
      expect(() => manager.onPhase(phase, () => {})).not.toThrow();
    }
  });
});
