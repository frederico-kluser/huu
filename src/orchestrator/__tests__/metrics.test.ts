import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetricsRecorder, MetricsQuery, overheadLevel } from '../metrics.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create the task_runtime_metrics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_runtime_metrics (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT    NOT NULL,
      task_id       TEXT    NOT NULL,
      agent_id      TEXT    NOT NULL,
      run_id        TEXT    NOT NULL,
      task_queued_at      INTEGER,
      task_dispatched_at  INTEGER,
      agent_started_at    INTEGER,
      agent_done_at       INTEGER,
      merge_queued_at     INTEGER,
      merge_started_at    INTEGER,
      merge_done_at       INTEGER,
      lock_wait_ms        INTEGER DEFAULT 0,
      queue_wait_ms       INTEGER GENERATED ALWAYS AS (
        CASE WHEN agent_started_at IS NOT NULL AND task_dispatched_at IS NOT NULL
             THEN agent_started_at - task_dispatched_at ELSE NULL END
      ) STORED,
      execution_ms        INTEGER GENERATED ALWAYS AS (
        CASE WHEN agent_done_at IS NOT NULL AND agent_started_at IS NOT NULL
             THEN agent_done_at - agent_started_at ELSE NULL END
      ) STORED,
      merge_wait_ms       INTEGER GENERATED ALWAYS AS (
        CASE WHEN merge_started_at IS NOT NULL AND merge_queued_at IS NOT NULL
             THEN merge_started_at - merge_queued_at ELSE NULL END
      ) STORED,
      merge_exec_ms       INTEGER GENERATED ALWAYS AS (
        CASE WHEN merge_done_at IS NOT NULL AND merge_started_at IS NOT NULL
             THEN merge_done_at - merge_started_at ELSE NULL END
      ) STORED,
      coordination_ms     INTEGER GENERATED ALWAYS AS (
        COALESCE(
          CASE WHEN agent_started_at IS NOT NULL AND task_dispatched_at IS NOT NULL
               THEN agent_started_at - task_dispatched_at ELSE 0 END, 0
        ) +
        COALESCE(
          CASE WHEN merge_started_at IS NOT NULL AND merge_queued_at IS NOT NULL
               THEN merge_started_at - merge_queued_at ELSE 0 END, 0
        ) +
        COALESCE(lock_wait_ms, 0)
      ) STORED,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
});

afterEach(() => {
  db?.close();
});

describe('overheadLevel', () => {
  it('returns green for < 0.25', () => {
    expect(overheadLevel(0)).toBe('green');
    expect(overheadLevel(0.24)).toBe('green');
  });

  it('returns yellow for 0.25..0.40', () => {
    expect(overheadLevel(0.25)).toBe('yellow');
    expect(overheadLevel(0.40)).toBe('yellow');
  });

  it('returns red for > 0.40', () => {
    expect(overheadLevel(0.41)).toBe('red');
    expect(overheadLevel(1.0)).toBe('red');
  });
});

describe('MetricsRecorder', () => {
  it('records task lifecycle events', () => {
    const recorder = new MetricsRecorder(db);

    recorder.recordQueued(
      { sessionId: 'sess1', taskId: 'task1', agentId: 'builder', runId: 'run1' },
      1000,
    );

    recorder.recordAgentStarted('task1', 'run1', 1200);
    recorder.recordAgentDone('task1', 'run1', 2200);
    recorder.recordMergeQueued('task1', 'run1', 2300);
    recorder.recordMergeStarted('task1', 'run1', 2500);
    recorder.recordMergeDone('task1', 'run1', 2700);

    const row = db
      .prepare('SELECT * FROM task_runtime_metrics WHERE task_id = ?')
      .get('task1') as Record<string, unknown>;

    expect(row['agent_started_at']).toBe(1200);
    expect(row['agent_done_at']).toBe(2200);
    expect(row['queue_wait_ms']).toBe(200); // 1200 - 1000
    expect(row['execution_ms']).toBe(1000); // 2200 - 1200
    expect(row['merge_wait_ms']).toBe(200); // 2500 - 2300
    expect(row['merge_exec_ms']).toBe(200); // 2700 - 2500
    expect(row['coordination_ms']).toBe(200 + 200); // queue_wait + merge_wait
  });

  it('records lock wait time', () => {
    const recorder = new MetricsRecorder(db);

    recorder.recordQueued(
      { sessionId: 'sess1', taskId: 'task2', agentId: 'builder', runId: 'run2' },
      1000,
    );
    recorder.recordAgentStarted('task2', 'run2', 1100);
    recorder.recordLockWait('task2', 'run2', 50);
    recorder.recordAgentDone('task2', 'run2', 2100);

    const row = db
      .prepare('SELECT * FROM task_runtime_metrics WHERE task_id = ?')
      .get('task2') as Record<string, unknown>;

    expect(row['lock_wait_ms']).toBe(50);
    // coordination_ms = queue_wait(100) + lock_wait(50) = 150
    expect(row['coordination_ms']).toBe(150);
  });
});

describe('MetricsQuery', () => {
  it('returns null for unknown session', () => {
    const query = new MetricsQuery(db);
    expect(query.getSessionSummary('nonexistent')).toBeNull();
  });

  it('computes session summary correctly', () => {
    const recorder = new MetricsRecorder(db);

    // Task 1: 200ms queue wait, 1000ms execution
    recorder.recordQueued(
      { sessionId: 'sess1', taskId: 't1', agentId: 'builder', runId: 'r1' },
      1000,
    );
    recorder.recordAgentStarted('t1', 'r1', 1200);
    recorder.recordAgentDone('t1', 'r1', 2200);

    // Task 2: 100ms queue wait, 500ms execution
    recorder.recordQueued(
      { sessionId: 'sess1', taskId: 't2', agentId: 'tester', runId: 'r2' },
      2000,
    );
    recorder.recordAgentStarted('t2', 'r2', 2100);
    recorder.recordAgentDone('t2', 'r2', 2600);

    const query = new MetricsQuery(db);
    const summary = query.getSessionSummary('sess1');

    expect(summary).not.toBeNull();
    expect(summary!.taskCount).toBe(2);
    expect(summary!.coordinationMs).toBe(300); // 200 + 100
    expect(summary!.executionMs).toBe(1500); // 1000 + 500
    // ratio = 300 / (300 + 1500) = 300 / 1800 = 0.1667
    expect(summary!.ratio).toBeCloseTo(0.1667, 3);
    expect(summary!.p50QueueWaitMs).toBeGreaterThanOrEqual(100);
    expect(summary!.p95QueueWaitMs).toBeGreaterThanOrEqual(100);
  });

  it('handles session with merge metrics', () => {
    const recorder = new MetricsRecorder(db);

    recorder.recordQueued(
      { sessionId: 'sess2', taskId: 't1', agentId: 'builder', runId: 'r1' },
      1000,
    );
    recorder.recordAgentStarted('t1', 'r1', 1100);
    recorder.recordAgentDone('t1', 'r1', 2100);
    recorder.recordMergeQueued('t1', 'r1', 2200);
    recorder.recordMergeStarted('t1', 'r1', 2400);
    recorder.recordMergeDone('t1', 'r1', 2600);

    const query = new MetricsQuery(db);
    const summary = query.getSessionSummary('sess2');

    expect(summary).not.toBeNull();
    // coordination = queue_wait(100) + merge_wait(200) = 300
    expect(summary!.coordinationMs).toBe(300);
    expect(summary!.avgMergeWaitMs).toBe(200);
  });

  it('returns task metrics list', () => {
    const recorder = new MetricsRecorder(db);

    recorder.recordQueued(
      { sessionId: 'sess3', taskId: 't1', agentId: 'a1', runId: 'r1' },
      1000,
    );
    recorder.recordAgentStarted('t1', 'r1', 1050);
    recorder.recordAgentDone('t1', 'r1', 2050);

    recorder.recordQueued(
      { sessionId: 'sess3', taskId: 't2', agentId: 'a2', runId: 'r2' },
      1100,
    );

    const query = new MetricsQuery(db);
    const metrics = query.getTaskMetrics('sess3');

    expect(metrics).toHaveLength(2);
  });

  it('handles 10k+ events for performance', () => {
    const recorder = new MetricsRecorder(db);

    // Batch insert 10k events
    const insert = db.transaction(() => {
      for (let i = 0; i < 10000; i++) {
        recorder.recordQueued(
          {
            sessionId: 'perf-session',
            taskId: `task-${i}`,
            agentId: 'builder',
            runId: `run-${i}`,
          },
          i * 10,
        );
        recorder.recordAgentStarted(`task-${i}`, `run-${i}`, i * 10 + 5);
        recorder.recordAgentDone(`task-${i}`, `run-${i}`, i * 10 + 100);
      }
    });
    insert();

    const query = new MetricsQuery(db);
    const start = performance.now();
    const summary = query.getSessionSummary('perf-session');
    const elapsed = performance.now() - start;

    expect(summary).not.toBeNull();
    expect(summary!.taskCount).toBe(10000);
    // Should complete in reasonable time (<2s for in-memory)
    expect(elapsed).toBeLessThan(2000);
  });
});
