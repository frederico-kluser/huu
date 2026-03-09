import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteKanbanProvider } from '../kanban-provider.js';
import { openDatabase } from '../connection.js';
import { migrate } from '../migrator.js';

describe('SqliteKanbanProvider', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db?.close();
  });

  it('returns empty snapshot when no data exists', () => {
    const provider = new SqliteKanbanProvider(db, 'test-project');
    const snapshot = provider.getSnapshot();

    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.act).toBe(0);
    expect(snapshot.beat).toBeNull();
    expect(snapshot.totalCostUsd).toBe(0);
    expect(typeof snapshot.watermark).toBe('string');
  });

  it('returns beat state data when available', () => {
    db.prepare(
      `INSERT INTO beat_state (project_id, run_id, current_act, current_beat, progress_pct, status, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('test-project', 'run-1', 2, 'implement-auth', 50, 'running', '{}');

    const provider = new SqliteKanbanProvider(db, 'test-project');
    const snapshot = provider.getSnapshot();

    expect(snapshot.act).toBe(2);
    expect(snapshot.beat).toBe('implement-auth');
  });

  it('extracts tasks from beat sheet snapshot', () => {
    const beatSheet = {
      acts: [
        {
          sequences: [
            {
              tasks: [
                { id: 'task-1', title: 'Setup DB', status: 'done' },
                { id: 'task-2', title: 'Build API', status: 'running' },
                { id: 'task-3', title: 'Write Tests', status: 'pending' },
                { id: 'task-4', title: 'Fix Bug', status: 'failed' },
                { id: 'task-5', title: 'Review PR', status: 'blocked' },
              ],
            },
          ],
        },
      ],
    };

    db.prepare(
      `INSERT INTO beat_state (project_id, run_id, current_act, progress_pct, status, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('test-project', 'run-1', 1, 40, 'running', JSON.stringify(beatSheet));

    const provider = new SqliteKanbanProvider(db, 'test-project');
    const snapshot = provider.getSnapshot();

    expect(snapshot.tasks).toHaveLength(5);

    const byColumn = new Map<string, string[]>();
    for (const task of snapshot.tasks) {
      const existing = byColumn.get(task.column) ?? [];
      existing.push(task.id);
      byColumn.set(task.column, existing);
    }

    expect(byColumn.get('done')).toEqual(['task-1']);
    expect(byColumn.get('running')).toEqual(['task-2']);
    expect(byColumn.get('backlog')).toEqual(['task-3']);
    expect(byColumn.get('failed')).toEqual(['task-4']);
    expect(byColumn.get('review')).toEqual(['task-5']);
  });

  it('returns total cost from sessions', () => {
    db.prepare(
      `INSERT INTO sessions (id, project_id, status, total_cost_usd, summary_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('session-1', 'test-project', 'completed', 1.5, '{}');

    db.prepare(
      `INSERT INTO sessions (id, project_id, status, total_cost_usd, summary_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('session-2', 'test-project', 'running', 0.75, '{}');

    const provider = new SqliteKanbanProvider(db, 'test-project');
    const snapshot = provider.getSnapshot();

    expect(snapshot.totalCostUsd).toBe(2.25);
  });

  it('watermark changes when data updates', () => {
    const provider = new SqliteKanbanProvider(db, 'test-project');
    const wm1 = provider.getWatermark();

    db.prepare(
      `INSERT INTO beat_state (project_id, run_id, current_act, progress_pct, status, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('test-project', 'run-1', 1, 0, 'running', '{}');

    const wm2 = provider.getWatermark();
    expect(wm2).not.toBe(wm1);
  });

  it('handles empty snapshot JSON gracefully', () => {
    db.prepare(
      `INSERT INTO beat_state (project_id, run_id, current_act, progress_pct, status, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('test-project', 'run-1', 1, 0, 'running', '{}');

    const provider = new SqliteKanbanProvider(db, 'test-project');
    const snapshot = provider.getSnapshot();

    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.act).toBe(1);
  });

  it('handles snapshot with no tasks array', () => {
    db.prepare(
      `INSERT INTO beat_state (project_id, run_id, current_act, progress_pct, status, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('test-project', 'run-1', 1, 0, 'running', JSON.stringify({ acts: [{ sequences: [{}] }] }));

    const provider = new SqliteKanbanProvider(db, 'test-project');
    const snapshot = provider.getSnapshot();

    expect(snapshot.tasks).toEqual([]);
  });
});
