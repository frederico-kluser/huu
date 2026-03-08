import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../db/migrator.js';
import { BeatSheetPersistence } from '../beatsheet-persistence.js';
import type { BeatSheet, AtomicTask } from '../beatsheet.js';

// ── Fixtures ────────────────────────────────────────────────────────

function makeTask(overrides: Partial<AtomicTask> = {}): AtomicTask {
  return {
    id: 'task-1',
    actId: 'act-setup',
    sequenceId: 'seq-1',
    title: 'Test task',
    precondition: 'pre',
    action: 'act',
    postcondition: 'post',
    verification: 'verify',
    dependencies: [],
    critical: false,
    estimatedEffort: 'small',
    status: 'pending',
    ...overrides,
  };
}

function makeSheet(): BeatSheet {
  return {
    id: 'beatsheet-test',
    objective: 'Build test feature',
    successCriteria: ['Tests pass'],
    constraints: ['Use TypeScript'],
    acts: [
      {
        id: 'act-setup',
        type: 'setup',
        name: 'Setup',
        objective: 'Set up foundation',
        sequences: [
          {
            id: 'seq-1',
            actId: 'act-setup',
            name: 'Init',
            objective: 'Initialize',
            tasks: [
              makeTask({ id: 'task-1' }),
              makeTask({ id: 'task-2', dependencies: ['task-1'] }),
            ],
          },
        ],
      },
      {
        id: 'act-confrontation',
        type: 'confrontation',
        name: 'Build',
        objective: 'Build core',
        sequences: [
          {
            id: 'seq-2',
            actId: 'act-confrontation',
            name: 'Core',
            objective: 'Core logic',
            tasks: [
              makeTask({
                id: 'task-3',
                actId: 'act-confrontation',
                sequenceId: 'seq-2',
                dependencies: ['task-2'],
                critical: true,
              }),
            ],
          },
        ],
      },
    ],
    checkpoints: {
      catalyst: 'pending',
      midpoint: 'pending',
      allIsLost: 'pending',
      breakIntoThree: 'pending',
      finalImage: 'pending',
    },
    version: 1,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('BeatSheetPersistence', () => {
  let db: Database.Database;
  let persistence: BeatSheetPersistence;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    persistence = new BeatSheetPersistence(db);
  });

  afterEach(() => {
    db?.close();
  });

  describe('save and load', () => {
    it('saves and loads a beat sheet', () => {
      const sheet = makeSheet();
      persistence.save('project-1', 'run-1', sheet);

      const loaded = persistence.load('project-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('beatsheet-test');
      expect(loaded!.objective).toBe('Build test feature');
      expect(loaded!.acts).toHaveLength(2);
    });

    it('returns null when no sheet exists', () => {
      const loaded = persistence.load('nonexistent');
      expect(loaded).toBeNull();
    });

    it('preserves all task fields through save/load cycle', () => {
      const sheet = makeSheet();
      persistence.save('project-1', 'run-1', sheet);

      const loaded = persistence.load('project-1');
      const task = loaded!.acts[0]!.sequences[0]!.tasks[0]!;
      expect(task.precondition).toBe('pre');
      expect(task.action).toBe('act');
      expect(task.postcondition).toBe('post');
      expect(task.verification).toBe('verify');
      expect(task.dependencies).toEqual([]);
      expect(task.critical).toBe(false);
      expect(task.estimatedEffort).toBe('small');
    });

    it('overwrites previous state on re-save', () => {
      const sheet1 = makeSheet();
      persistence.save('project-1', 'run-1', sheet1);

      const sheet2 = makeSheet();
      sheet2.objective = 'Updated objective';
      persistence.save('project-1', 'run-2', sheet2);

      const loaded = persistence.load('project-1');
      expect(loaded!.objective).toBe('Updated objective');
    });
  });

  describe('loadWithState', () => {
    it('returns both state metadata and sheet', () => {
      persistence.save('project-1', 'run-1', makeSheet());

      const result = persistence.loadWithState('project-1');
      expect(result).not.toBeNull();
      expect(result!.state.project_id).toBe('project-1');
      expect(result!.state.run_id).toBe('run-1');
      expect(result!.sheet.id).toBe('beatsheet-test');
    });

    it('returns null when no state exists', () => {
      const result = persistence.loadWithState('nonexistent');
      expect(result).toBeNull();
    });

    it('computes correct progress metrics', () => {
      const sheet = makeSheet();
      sheet.acts[0]!.sequences[0]!.tasks[0]!.status = 'done';
      persistence.save('project-1', 'run-1', sheet);

      const result = persistence.loadWithState('project-1');
      expect(result!.state.status).toBe('running');
      // 1 out of 3 done = ~33%
      expect(result!.state.progress_pct).toBeGreaterThanOrEqual(33);
    });

    it('sets status to completed when all tasks done', () => {
      const sheet = makeSheet();
      for (const act of sheet.acts) {
        for (const seq of act.sequences) {
          for (const task of seq.tasks) {
            task.status = 'done';
          }
        }
      }
      persistence.save('project-1', 'run-1', sheet);

      const result = persistence.loadWithState('project-1');
      expect(result!.state.status).toBe('completed');
      expect(result!.state.progress_pct).toBe(100);
    });

    it('sets status to blocked when tasks blocked and nothing running', () => {
      const sheet = makeSheet();
      sheet.acts[0]!.sequences[0]!.tasks[0]!.status = 'done';
      sheet.acts[0]!.sequences[0]!.tasks[1]!.status = 'blocked';
      sheet.acts[1]!.sequences[0]!.tasks[0]!.status = 'blocked';
      persistence.save('project-1', 'run-1', sheet);

      const result = persistence.loadWithState('project-1');
      expect(result!.state.status).toBe('blocked');
      expect(result!.state.blocked_reason).toContain('blocked');
    });
  });

  describe('updateTaskStatus', () => {
    it('updates a task status and recomputes progress', () => {
      persistence.save('project-1', 'run-1', makeSheet());

      const updated = persistence.updateTaskStatus('project-1', 'task-1', 'done');
      expect(updated).not.toBeNull();

      const task = updated!.acts[0]!.sequences[0]!.tasks[0]!;
      expect(task.status).toBe('done');
    });

    it('returns null for unknown project', () => {
      const result = persistence.updateTaskStatus('nonexistent', 'task-1', 'done');
      expect(result).toBeNull();
    });

    it('returns null for unknown task', () => {
      persistence.save('project-1', 'run-1', makeSheet());
      const result = persistence.updateTaskStatus('project-1', 'nonexistent', 'done');
      expect(result).toBeNull();
    });
  });

  describe('updateCheckpoints', () => {
    it('updates checkpoint state', () => {
      persistence.save('project-1', 'run-1', makeSheet());

      const updated = persistence.updateCheckpoints('project-1', {
        catalyst: 'passed',
        midpoint: 'pending',
        allIsLost: 'pending',
        breakIntoThree: 'pending',
        finalImage: 'pending',
      });
      expect(updated!.checkpoints.catalyst).toBe('passed');
    });
  });

  describe('replan', () => {
    it('increments version on replan', () => {
      persistence.save('project-1', 'run-1', makeSheet());

      const updated = makeSheet();
      updated.objective = 'Revised objective';
      const state = persistence.replan('project-1', updated);

      expect(state).not.toBeNull();
      const loaded = persistence.load('project-1');
      expect(loaded!.version).toBe(2);
      expect(loaded!.objective).toBe('Revised objective');
    });

    it('returns null for unknown project', () => {
      const result = persistence.replan('nonexistent', makeSheet());
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes beat state', () => {
      persistence.save('project-1', 'run-1', makeSheet());
      expect(persistence.delete('project-1')).toBe(true);
      expect(persistence.load('project-1')).toBeNull();
    });

    it('returns false for unknown project', () => {
      expect(persistence.delete('nonexistent')).toBe(false);
    });
  });
});
