import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import {
  onTaskDone,
  buildTaskDelta,
  classifyDelta,
  CuratorStore,
} from '../curator.js';
import type { TaskDoneEvent } from '../curator.js';
import { EntityRepository } from '../../db/repositories/entities.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
});

afterEach(() => {
  db?.close();
});

function makeEvent(overrides?: Partial<TaskDoneEvent>): TaskDoneEvent {
  return {
    taskId: 'task-1',
    agentId: 'builder',
    runId: 'run-1',
    projectId: 'p1',
    summary: 'Implemented feature X',
    commitSha: 'abc12345',
    filesChanged: ['src/foo.ts', 'src/bar.ts'],
    fileChangeSummary: {
      added: ['src/foo.ts'],
      modified: ['src/bar.ts'],
    },
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      totalCost: 0.02,
      turns: 3,
    },
    durationMs: 5000,
    ...overrides,
  };
}

describe('CuratorStore', () => {
  it('should track processed keys idempotently', () => {
    const store = new CuratorStore(db);
    const key = 'task-1:builder:run-1';

    expect(store.alreadyProcessed(key)).toBe(false);
    store.markProcessed(key, { kept: 1, summarized: 0, discarded: 0, quarantined: 0, superseded: 0 });
    expect(store.alreadyProcessed(key)).toBe(true);
  });

  it('should not duplicate on re-insert', () => {
    const store = new CuratorStore(db);
    const key = 'task-1:builder:run-1';
    const result = { kept: 1, summarized: 0, discarded: 0, quarantined: 0, superseded: 0 };

    store.markProcessed(key, result);
    store.markProcessed(key, result); // Should not throw

    expect(store.alreadyProcessed(key)).toBe(true);
  });
});

describe('buildTaskDelta', () => {
  it('should extract file changes from event', () => {
    const evt = makeEvent();
    const delta = buildTaskDelta(evt);

    expect(delta.fileChanges).toHaveLength(2);
    expect(delta.fileChanges[0]!.key).toBe('file:src/foo.ts');
    expect(delta.fileChanges[1]!.key).toBe('file:src/bar.ts');
  });

  it('should extract task outcome from summary', () => {
    const evt = makeEvent();
    const delta = buildTaskDelta(evt);

    expect(delta.decisions).toHaveLength(2); // task_outcome + commit_ref
    expect(delta.decisions[0]!.type).toBe('task_outcome');
    expect(delta.decisions[0]!.description).toBe('Implemented feature X');
  });

  it('should extract commit reference', () => {
    const evt = makeEvent();
    const delta = buildTaskDelta(evt);

    const commitItem = delta.decisions.find((d) => d.type === 'commit_ref');
    expect(commitItem).toBeDefined();
    expect(commitItem!.key).toBe('commit:abc12345');
  });

  it('should extract execution metrics', () => {
    const evt = makeEvent();
    const delta = buildTaskDelta(evt);

    expect(delta.metrics).toHaveLength(1);
    expect(delta.metrics[0]!.type).toBe('execution_metric');
  });

  it('should handle event without optional fields', () => {
    const evt: TaskDoneEvent = {
      taskId: 'task-1',
      agentId: 'builder',
      runId: 'run-1',
      projectId: 'p1',
    };

    const delta = buildTaskDelta(evt);
    expect(delta.fileChanges).toHaveLength(0);
    expect(delta.decisions).toHaveLength(0);
    expect(delta.metrics).toHaveLength(0);
  });
});

describe('classifyDelta', () => {
  it('should classify all delta items with decisions', () => {
    const evt = makeEvent();
    const delta = buildTaskDelta(evt);
    const items = classifyDelta(delta, 'task-1', 'builder');

    // file changes (2) + decisions (2) + metrics (1)
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(['keep', 'summarize', 'discard', 'quarantine']).toContain(item.decision);
    }
  });

  it('should keep high-signal items', () => {
    const evt = makeEvent();
    const delta = buildTaskDelta(evt);
    const items = classifyDelta(delta, 'task-1', 'builder');

    const taskOutcome = items.find((i) => i.entityType === 'task_outcome');
    expect(taskOutcome?.decision).toBe('keep');
  });

  it('should discard low-signal metrics', () => {
    const evt = makeEvent();
    const delta = buildTaskDelta(evt);
    const items = classifyDelta(delta, 'task-1', 'builder');

    const metric = items.find((i) => i.entityType === 'execution_metric');
    expect(metric?.decision).toBe('discard');
  });
});

describe('onTaskDone', () => {
  it('should curate task output into entities', async () => {
    const evt = makeEvent();
    const result = await onTaskDone(db, evt);

    expect(result.skipped).toBe(false);
    expect(result.applied.kept).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);

    // Verify entities were created
    const entityRepo = new EntityRepository(db);
    const taskOutcome = entityRepo.getByCanonicalKey('p1', 'task_outcome:task-1');
    expect(taskOutcome).toBeDefined();
    expect(taskOutcome!.summary).toBe('Implemented feature X');
  });

  it('should be idempotent — second call is skipped', async () => {
    const evt = makeEvent();

    const first = await onTaskDone(db, evt);
    expect(first.skipped).toBe(false);

    const second = await onTaskDone(db, evt);
    expect(second.skipped).toBe(true);
    expect(second.applied.kept).toBe(0);
  });

  it('should handle different tasks independently', async () => {
    const evt1 = makeEvent({ taskId: 'task-1' });
    const evt2 = makeEvent({ taskId: 'task-2', summary: 'Different task' });

    const r1 = await onTaskDone(db, evt1);
    const r2 = await onTaskDone(db, evt2);

    expect(r1.skipped).toBe(false);
    expect(r2.skipped).toBe(false);
  });

  it('should not duplicate memory on retry with same run_id', async () => {
    const evt = makeEvent();
    await onTaskDone(db, evt);
    await onTaskDone(db, evt);

    const entityRepo = new EntityRepository(db);
    const entities = entityRepo.listByType('p1', 'task_outcome');
    // Should have exactly 1 task_outcome, not 2
    expect(entities.filter((e) => e.canonical_key === 'task_outcome:task-1')).toHaveLength(1);
  });
});
