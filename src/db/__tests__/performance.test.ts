import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  openDatabase,
  getDatabaseHealth,
  walCheckpoint,
  optimizeDatabase,
  monitorWalSize,
} from '../connection.js';

let db: Database.Database;

afterEach(() => {
  db?.close();
});

describe('openDatabase — performance optimizations', () => {
  it('applies default cache_size pragma (~64MB)', () => {
    db = openDatabase(':memory:');
    const cacheSize = db.pragma('cache_size', { simple: true }) as number;
    expect(cacheSize).toBe(-65536);
  });

  it('accepts custom cache_size', () => {
    db = openDatabase(':memory:', { cacheSizeKb: -32768 });
    const cacheSize = db.pragma('cache_size', { simple: true }) as number;
    expect(cacheSize).toBe(-32768);
  });

  it('applies temp_store = MEMORY', () => {
    db = openDatabase(':memory:');
    const tempStore = db.pragma('temp_store', { simple: true }) as number;
    expect(tempStore).toBe(2); // 2 = MEMORY
  });

  it('applies custom synchronous mode', () => {
    db = openDatabase(':memory:', { synchronous: 'FULL' });
    const sync = db.pragma('synchronous', { simple: true }) as number;
    expect(sync).toBe(2); // FULL = 2
  });

  it('applies custom busy_timeout', () => {
    db = openDatabase(':memory:', { busyTimeoutMs: 10000 });
    const timeout = db.pragma('busy_timeout', { simple: true }) as number;
    expect(timeout).toBe(10000);
  });
});

describe('getDatabaseHealth — extended fields', () => {
  it('returns cacheSize and synchronous', () => {
    db = openDatabase(':memory:');
    const health = getDatabaseHealth(db);
    expect(health).toHaveProperty('cacheSize');
    expect(health).toHaveProperty('synchronous');
    expect(health.cacheSize).toBe(-65536);
    expect(health.synchronous).toBe(1); // NORMAL = 1
  });
});

describe('optimizeDatabase', () => {
  it('runs PRAGMA optimize without error', () => {
    db = openDatabase(':memory:');
    expect(() => optimizeDatabase(db)).not.toThrow();
  });
});

describe('monitorWalSize', () => {
  it('returns -1 for in-memory db (no WAL file)', () => {
    db = openDatabase(':memory:');
    const result = monitorWalSize(db, ':memory:');
    expect(result.walSizeBytes).toBe(-1);
    expect(result.checkpointed).toBe(false);
  });
});

describe('SQLite query optimization with indices', () => {
  it('creates indices on task_runtime_metrics', () => {
    db = openDatabase(':memory:');

    // Create the table and indices from migration
    db.exec(`
      CREATE TABLE task_runtime_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        task_queued_at INTEGER,
        task_dispatched_at INTEGER,
        agent_started_at INTEGER,
        agent_done_at INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_trm_session ON task_runtime_metrics(session_id);
      CREATE INDEX idx_trm_task ON task_runtime_metrics(task_id);
      CREATE INDEX idx_trm_session_created ON task_runtime_metrics(session_id, created_at);
    `);

    // Verify indices exist
    const indices = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_runtime_metrics'",
      )
      .all() as Array<{ name: string }>;

    const indexNames = indices.map((i) => i.name);
    expect(indexNames).toContain('idx_trm_session');
    expect(indexNames).toContain('idx_trm_task');
    expect(indexNames).toContain('idx_trm_session_created');
  });

  it('uses index for session-based queries (EXPLAIN QUERY PLAN)', () => {
    db = openDatabase(':memory:');

    db.exec(`
      CREATE TABLE task_runtime_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        task_queued_at INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_trm_session ON task_runtime_metrics(session_id);
    `);

    // Insert some data so the planner has stats
    for (let i = 0; i < 100; i++) {
      db.prepare(
        'INSERT INTO task_runtime_metrics (session_id, task_id, agent_id, run_id, task_queued_at) VALUES (?, ?, ?, ?, ?)',
      ).run(`sess-${i % 5}`, `task-${i}`, 'builder', `run-${i}`, i * 10);
    }

    // Run EXPLAIN QUERY PLAN
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM task_runtime_metrics WHERE session_id = ?',
      )
      .all('sess-0') as Array<{ detail: string }>;

    const planText = plan.map((p) => p.detail).join(' ');
    // Should use the index (SEARCH ... USING INDEX)
    expect(planText).toMatch(/USING INDEX|SEARCH/i);
  });

  it('composite indices handle common query patterns', () => {
    db = openDatabase(':memory:');

    // Simulate messages table with composite index
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        message_type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_messages_project_type_created ON messages(project_id, message_type, created_at);
      CREATE INDEX idx_messages_project_created ON messages(project_id, created_at);
    `);

    // Insert data
    for (let i = 0; i < 200; i++) {
      db.prepare(
        'INSERT INTO messages (project_id, message_type) VALUES (?, ?)',
      ).run('proj1', i % 2 === 0 ? 'task_done' : 'task_progress');
    }

    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM messages WHERE project_id = ? AND message_type = ? ORDER BY created_at DESC",
      )
      .all('proj1', 'task_done') as Array<{ detail: string }>;

    const planText = plan.map((p) => p.detail).join(' ');
    expect(planText).toMatch(/USING INDEX|SEARCH/i);
  });
});
