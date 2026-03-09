import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import {
  buildCompactSummary,
  partitionEntities,
  strategicCompact,
  CompactSnapshotStore,
} from '../strategic-compact.js';
import { EntityRepository } from '../../db/repositories/entities.js';
import type { BeatSheet } from '../beatsheet.js';
import type { Entity } from '../../types/index.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
});

afterEach(() => {
  db?.close();
});

function makeSheet(overrides?: Partial<BeatSheet>): BeatSheet {
  return {
    id: 'bs-test',
    objective: 'Build the feature',
    successCriteria: ['Tests pass', 'Feature works'],
    constraints: ['Use TypeScript'],
    acts: [
      {
        id: 'act-1',
        type: 'setup',
        name: 'Setup',
        objective: 'Set up',
        sequences: [
          {
            id: 'seq-1',
            actId: 'act-1',
            name: 'Main',
            objective: 'Main sequence',
            tasks: [
              {
                id: 'task-1',
                actId: 'act-1',
                sequenceId: 'seq-1',
                title: 'Task 1',
                precondition: 'none',
                action: 'implement',
                postcondition: 'done',
                verification: 'tests',
                dependencies: [],
                critical: false,
                estimatedEffort: 'small',
                status: 'done',
              },
              {
                id: 'task-2',
                actId: 'act-1',
                sequenceId: 'seq-1',
                title: 'Task 2',
                precondition: 'task-1 done',
                action: 'test',
                postcondition: 'tested',
                verification: 'tests pass',
                dependencies: ['task-1'],
                critical: false,
                estimatedEffort: 'small',
                status: 'pending',
              },
            ],
          },
        ],
      },
    ],
    checkpoints: {
      catalyst: 'passed',
      midpoint: 'pending',
      allIsLost: 'pending',
      breakIntoThree: 'pending',
      finalImage: 'pending',
    },
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEntity(db: Database.Database, overrides: Partial<{ type: string; key: string; name: string; confidence: number }>): Entity {
  const repo = new EntityRepository(db);
  return repo.upsert({
    project_id: 'p1',
    entity_type: overrides.type ?? 'task_outcome',
    canonical_key: overrides.key ?? `key-${Date.now()}-${Math.random()}`,
    display_name: overrides.name ?? 'Test Entity',
    confidence: overrides.confidence ?? 0.7,
  });
}

describe('CompactSnapshotStore', () => {
  it('should save and retrieve snapshots', () => {
    const store = new CompactSnapshotStore(db);
    store.save({
      id: 'snap-1',
      projectId: 'p1',
      checkpoint: 'catalyst',
      trigger: 'checkpoint',
      timestamp: new Date().toISOString(),
      summary: {
        objective: 'test',
        currentBeat: 'catalyst',
        decisions: ['decided X'],
        blockers: [],
        openTasks: ['task-2'],
        evidence: [],
        nextActions: [],
        risks: [],
        lessonsLearned: [],
      },
      archivedEntityIds: [1, 2],
      retainedEntityIds: [3, 4],
    });

    const retrieved = store.getByCheckpoint('p1', 'catalyst');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('snap-1');
    expect(retrieved!.summary.decisions).toContain('decided X');
    expect(retrieved!.archivedEntityIds).toEqual([1, 2]);
  });

  it('should list all snapshots for a project', () => {
    const store = new CompactSnapshotStore(db);
    store.save({
      id: 'snap-1',
      projectId: 'p1',
      checkpoint: 'catalyst',
      trigger: 'checkpoint',
      timestamp: new Date().toISOString(),
      summary: { objective: '', currentBeat: '', decisions: [], blockers: [], openTasks: [], evidence: [], nextActions: [], risks: [], lessonsLearned: [] },
      archivedEntityIds: [],
      retainedEntityIds: [],
    });
    store.save({
      id: 'snap-2',
      projectId: 'p1',
      checkpoint: 'midpoint',
      trigger: 'checkpoint',
      timestamp: new Date().toISOString(),
      summary: { objective: '', currentBeat: '', decisions: [], blockers: [], openTasks: [], evidence: [], nextActions: [], risks: [], lessonsLearned: [] },
      archivedEntityIds: [],
      retainedEntityIds: [],
    });

    const all = store.listByProject('p1');
    expect(all).toHaveLength(2);
  });
});

describe('buildCompactSummary', () => {
  it('should include objective and checkpoint', () => {
    const sheet = makeSheet();
    const entities: Entity[] = [];
    const summary = buildCompactSummary(entities, sheet, 'catalyst');

    expect(summary.objective).toBe('Build the feature');
    expect(summary.currentBeat).toBe('catalyst');
  });

  it('should list open tasks', () => {
    const sheet = makeSheet();
    const summary = buildCompactSummary([], sheet, 'midpoint');

    expect(summary.openTasks.length).toBeGreaterThan(0);
    expect(summary.openTasks[0]).toContain('task-2');
  });

  it('should categorize entities by type', () => {
    const e1 = makeEntity(db, { type: 'task_outcome', key: 'to-1', name: 'Outcome 1' });
    const e2 = makeEntity(db, { type: 'quarantine', key: 'q-1', name: 'Risk 1' });
    const e3 = makeEntity(db, { type: 'file_change', key: 'fc-1', name: 'File change 1' });

    const sheet = makeSheet();
    const summary = buildCompactSummary([e1, e2, e3], sheet, 'midpoint');

    expect(summary.decisions.length).toBeGreaterThan(0);
    expect(summary.risks.length).toBeGreaterThan(0);
    expect(summary.evidence.length).toBeGreaterThan(0);
  });
});

describe('partitionEntities', () => {
  it('should retain high-confidence entities', () => {
    const e1 = makeEntity(db, { confidence: 0.9, key: 'high-1' });
    const e2 = makeEntity(db, { confidence: 0.3, type: 'execution_metric', key: 'low-1' });

    const { retain, archive } = partitionEntities([e1, e2], 'midpoint');
    expect(retain.map((e) => e.id)).toContain(e1.id);
    expect(archive.map((e) => e.id)).toContain(e2.id);
  });

  it('should always retain quarantined entities', () => {
    const e1 = makeEntity(db, { type: 'quarantine', confidence: 0.3, key: 'q-1' });

    const { retain } = partitionEntities([e1], 'finalImage');
    expect(retain.map((e) => e.id)).toContain(e1.id);
  });

  it('should be more aggressive at finalImage checkpoint', () => {
    const e1 = makeEntity(db, { confidence: 0.4, type: 'file_change', key: 'fc-1' });

    const { archive } = partitionEntities([e1], 'finalImage');
    expect(archive.map((e) => e.id)).toContain(e1.id);
  });

  it('should retain task outcomes regardless of confidence', () => {
    const e1 = makeEntity(db, { type: 'task_outcome', confidence: 0.3, key: 'to-1' });

    const { retain } = partitionEntities([e1], 'midpoint');
    expect(retain.map((e) => e.id)).toContain(e1.id);
  });
});

describe('strategicCompact', () => {
  it('should create a versioned snapshot at checkpoint', () => {
    // Seed some entities
    makeEntity(db, { type: 'task_outcome', key: 'to-1', name: 'Outcome 1', confidence: 0.9 });
    makeEntity(db, { type: 'execution_metric', key: 'em-1', name: 'Metric 1', confidence: 0.3 });
    makeEntity(db, { type: 'file_change', key: 'fc-1', name: 'File 1', confidence: 0.8 });

    const sheet = makeSheet();
    const snapshot = strategicCompact(db, 'p1', 'catalyst', sheet);

    expect(snapshot.checkpoint).toBe('catalyst');
    expect(snapshot.retainedEntityIds.length).toBeGreaterThan(0);
    expect(snapshot.summary.objective).toBe('Build the feature');
  });

  it('should archive low-signal entities', () => {
    makeEntity(db, { type: 'execution_metric', key: 'em-1', name: 'Metric 1', confidence: 0.3 });

    const sheet = makeSheet();
    const snapshot = strategicCompact(db, 'p1', 'catalyst', sheet);

    expect(snapshot.archivedEntityIds.length).toBeGreaterThan(0);
  });

  it('should be retrievable after creation', () => {
    makeEntity(db, { type: 'task_outcome', key: 'to-1', confidence: 0.9 });

    const sheet = makeSheet();
    strategicCompact(db, 'p1', 'midpoint', sheet);

    const store = new CompactSnapshotStore(db);
    const retrieved = store.getByCheckpoint('p1', 'midpoint');
    expect(retrieved).toBeDefined();
    expect(retrieved!.checkpoint).toBe('midpoint');
  });
});
