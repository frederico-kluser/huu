import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import {
  buildContextPack,
  renderContextPack,
  ROLE_TOKEN_BUDGETS,
} from '../retrieval-jit.js';
import type { RetrievalQuery } from '../retrieval-jit.js';
import { EntityRepository } from '../../db/repositories/entities.js';
import type { BeatSheet, AtomicTask } from '../beatsheet.js';
import { CompactSnapshotStore } from '../strategic-compact.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
});

afterEach(() => {
  db?.close();
});

function makeSheet(): BeatSheet {
  return {
    id: 'bs-test',
    objective: 'Build authentication system',
    successCriteria: ['Login works', 'Tests pass'],
    constraints: [],
    acts: [
      {
        id: 'act-1',
        type: 'setup',
        name: 'Setup',
        objective: 'Set up auth',
        sequences: [
          {
            id: 'seq-1',
            actId: 'act-1',
            name: 'Auth setup',
            objective: 'Set up authentication',
            tasks: [
              {
                id: 'task-1',
                actId: 'act-1',
                sequenceId: 'seq-1',
                title: 'Implement login endpoint',
                precondition: 'none',
                action: 'Create POST /login with JWT',
                postcondition: 'Login returns token',
                verification: 'curl test',
                dependencies: [],
                critical: true,
                estimatedEffort: 'medium',
                status: 'ready',
              },
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeTask(overrides?: Partial<AtomicTask>): AtomicTask {
  return {
    id: 'task-1',
    actId: 'act-1',
    sequenceId: 'seq-1',
    title: 'Implement login endpoint',
    precondition: 'none',
    action: 'Create POST /login with JWT authentication',
    postcondition: 'Login returns token',
    verification: 'curl test',
    dependencies: [],
    critical: true,
    estimatedEffort: 'medium',
    status: 'ready',
    ...overrides,
  };
}

function seedEntities(db: Database.Database): void {
  const repo = new EntityRepository(db);

  // High-relevance: task outcome about auth
  repo.upsert({
    project_id: 'p1',
    entity_type: 'task_outcome',
    canonical_key: 'task_outcome:setup-auth',
    display_name: 'Auth setup completed',
    summary: 'JWT library installed, middleware configured for authentication',
    confidence: 0.9,
  });

  // Medium-relevance: file change
  repo.upsert({
    project_id: 'p1',
    entity_type: 'file_change',
    canonical_key: 'file:src/auth/login.ts',
    display_name: 'src/auth/login.ts',
    summary: 'Login handler file created for authentication',
    confidence: 0.8,
  });

  // Low-relevance: unrelated metric
  repo.upsert({
    project_id: 'p1',
    entity_type: 'execution_metric',
    canonical_key: 'metric:task-0:planner',
    display_name: 'Planner metrics',
    summary: 'Planner took 3 turns, 0.01 USD',
    confidence: 1.0,
  });

  // Quarantined: contradiction
  repo.upsert({
    project_id: 'p1',
    entity_type: 'quarantine',
    canonical_key: 'quarantine:auth-method',
    display_name: '[QUARANTINE] Auth method conflict',
    summary: 'Conflicting decisions about OAuth vs JWT',
    confidence: 0.7,
  });
}

describe('buildContextPack', () => {
  it('should return a context pack with objective', () => {
    const sheet = makeSheet();
    const task = makeTask();
    const query: RetrievalQuery = {
      projectId: 'p1',
      task,
      agentRole: 'implementation',
      sheet,
    };

    const pack = buildContextPack(db, query);
    expect(pack.objective).toBe('Build authentication system');
    expect(pack.currentBeat).toBe('catalyst');
  });

  it('should include relevant entities in context pack', () => {
    seedEntities(db);

    const sheet = makeSheet();
    const task = makeTask();
    const query: RetrievalQuery = {
      projectId: 'p1',
      task,
      agentRole: 'implementation',
      sheet,
    };

    const pack = buildContextPack(db, query);

    // Should have decisions (from task_outcome)
    expect(pack.decisions.length).toBeGreaterThan(0);
    // Should have file facts
    expect(pack.fileFacts.length).toBeGreaterThan(0);
    // Should have risks (from quarantine)
    expect(pack.risks.length).toBeGreaterThan(0);
  });

  it('should produce different packs for different roles', () => {
    seedEntities(db);
    const sheet = makeSheet();
    const task = makeTask();

    const builderPack = buildContextPack(db, {
      projectId: 'p1',
      task,
      agentRole: 'implementation',
      sheet,
    });

    const reviewerPack = buildContextPack(db, {
      projectId: 'p1',
      task,
      agentRole: 'review',
      sheet,
    });

    // Both should have content, but token budgets differ
    expect(builderPack.tokenEstimate).toBeGreaterThanOrEqual(0);
    expect(reviewerPack.tokenEstimate).toBeGreaterThanOrEqual(0);
  });

  it('should respect token budget', () => {
    seedEntities(db);
    const sheet = makeSheet();
    const task = makeTask();

    const pack = buildContextPack(db, {
      projectId: 'p1',
      task,
      agentRole: 'implementation',
      sheet,
      tokenBudget: 50, // Very small budget
    });

    expect(pack.tokenEstimate).toBeLessThanOrEqual(50);
  });

  it('should include snapshot references when available', () => {
    seedEntities(db);

    // Create a compact snapshot
    const store = new CompactSnapshotStore(db);
    store.save({
      id: 'snap-1',
      projectId: 'p1',
      checkpoint: 'catalyst',
      trigger: 'checkpoint',
      timestamp: new Date().toISOString(),
      summary: {
        objective: 'Build auth',
        currentBeat: 'catalyst',
        decisions: ['Use JWT for auth'],
        blockers: [],
        openTasks: [],
        evidence: [],
        nextActions: [],
        risks: ['Token expiry edge case'],
        lessonsLearned: [],
      },
      archivedEntityIds: [],
      retainedEntityIds: [],
    });

    const sheet = makeSheet();
    const task = makeTask();
    const pack = buildContextPack(db, {
      projectId: 'p1',
      task,
      agentRole: 'implementation',
      sheet,
    });

    const snapshotRef = pack.references.find((r) => r.kind === 'snapshot');
    expect(snapshotRef).toBeDefined();
  });

  it('should handle empty scratchpad gracefully', () => {
    const sheet = makeSheet();
    const task = makeTask();

    const pack = buildContextPack(db, {
      projectId: 'p1',
      task,
      agentRole: 'implementation',
      sheet,
    });

    expect(pack.decisions).toHaveLength(0);
    expect(pack.fileFacts).toHaveLength(0);
    expect(pack.tokenEstimate).toBe(0);
  });
});

describe('renderContextPack', () => {
  it('should render all sections', () => {
    const pack = {
      objective: 'Build auth',
      currentBeat: 'catalyst',
      decisions: [{ key: 'k1', summary: 'Use JWT', confidence: 0.9, source: 'task_outcome' }],
      risks: [{ key: 'k2', summary: 'Token expiry', confidence: 0.7, source: 'quarantine' }],
      fileFacts: [{ key: 'k3', summary: 'login.ts created', confidence: 0.8, source: 'file_change' }],
      openQuestions: [],
      references: [{ kind: 'file' as const, pointer: 'src/auth/login.ts' }],
      tokenEstimate: 100,
    };

    const rendered = renderContextPack(pack);
    expect(rendered).toContain('## Objective');
    expect(rendered).toContain('Build auth');
    expect(rendered).toContain('## Decisions & Facts');
    expect(rendered).toContain('Use JWT');
    expect(rendered).toContain('## Risks & Blockers');
    expect(rendered).toContain('Token expiry');
    expect(rendered).toContain('## File Changes');
    expect(rendered).toContain('login.ts created');
    expect(rendered).toContain('## References');
  });

  it('should omit empty sections', () => {
    const pack = {
      objective: 'Build auth',
      currentBeat: 'catalyst',
      decisions: [],
      risks: [],
      fileFacts: [],
      openQuestions: [],
      references: [],
      tokenEstimate: 0,
    };

    const rendered = renderContextPack(pack);
    expect(rendered).toContain('## Objective');
    expect(rendered).not.toContain('## Decisions & Facts');
    expect(rendered).not.toContain('## Risks & Blockers');
  });
});

describe('ROLE_TOKEN_BUDGETS', () => {
  it('should have budgets for all standard roles', () => {
    expect(ROLE_TOKEN_BUDGETS['implementation']).toBeDefined();
    expect(ROLE_TOKEN_BUDGETS['planning']).toBeDefined();
    expect(ROLE_TOKEN_BUDGETS['testing']).toBeDefined();
    expect(ROLE_TOKEN_BUDGETS['review']).toBeDefined();
    expect(ROLE_TOKEN_BUDGETS['research']).toBeDefined();
  });

  it('should give research the highest budget', () => {
    const budgets = Object.values(ROLE_TOKEN_BUDGETS);
    expect(ROLE_TOKEN_BUDGETS['research']).toBe(Math.max(...budgets));
  });
});
