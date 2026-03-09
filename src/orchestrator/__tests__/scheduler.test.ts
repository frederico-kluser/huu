import { describe, it, expect } from 'vitest';
import type { AtomicTask } from '../beatsheet.js';
import type { AgentDefinition } from '../../agents/types.js';
import type { AgentSlot, OrchestratorConfig } from '../../types/index.js';
import {
  inferTaskRole,
  scoreAssignment,
  schedule,
  hasCapacity,
  hasRoleCapacity,
  updateReadySince,
} from '../scheduler.js';
import type { SchedulerContext } from '../scheduler.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<AtomicTask> & { id: string }): AtomicTask {
  return {
    actId: 'act-1',
    sequenceId: 'seq-1',
    title: 'Test task',
    precondition: 'none',
    action: 'implement something',
    postcondition: 'done',
    verification: 'tests pass',
    dependencies: [],
    critical: false,
    estimatedEffort: 'medium',
    status: 'pending',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentDefinition> & { name: string }): AgentDefinition {
  return {
    role: 'implementation',
    description: 'Test agent',
    model: 'sonnet',
    tools: ['read_file', 'write_file'],
    systemPrompt: 'You are a test agent.',
    ...overrides,
  };
}

const defaultConfig: OrchestratorConfig = {
  projectId: 'test',
  maxConcurrentAgents: 5,
  roleCaps: { implementation: 3, testing: 1 },
  pollIntervalActiveMs: 500,
  pollIntervalIdleMs: 2000,
  stuckTimeoutMs: 45000,
  maxRetries: 3,
  backpressure: { minDelayMs: 250, maxDelayMs: 2000, loadFactor: 0.1 },
};

function makeContext(overrides: Partial<SchedulerContext> = {}): SchedulerContext {
  return {
    allTasks: [],
    doneTaskIds: new Set(),
    runningTaskIds: new Set(),
    activeSlots: new Map(),
    availableAgents: [makeAgent({ name: 'builder' })],
    config: defaultConfig,
    readySince: new Map(),
    retryCounts: new Map(),
    now: Date.now(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('inferTaskRole', () => {
  it('should infer implementation role for build/create tasks', () => {
    expect(inferTaskRole(makeTask({ id: 't1', title: 'Implement feature', action: 'create module' }))).toBe('implementation');
  });

  it('should infer testing role for test tasks', () => {
    expect(inferTaskRole(makeTask({ id: 't1', title: 'Test auth module', action: 'verify endpoints' }))).toBe('testing');
  });

  it('should infer review role for review tasks', () => {
    expect(inferTaskRole(makeTask({ id: 't1', title: 'Review PR', action: 'audit code changes' }))).toBe('review');
  });

  it('should infer debugging role for fix tasks', () => {
    expect(inferTaskRole(makeTask({ id: 't1', title: 'Fix bug', action: 'debug the issue' }))).toBe('debugging');
  });

  it('should default to implementation for ambiguous tasks', () => {
    expect(inferTaskRole(makeTask({ id: 't1', title: 'Something', action: 'do stuff' }))).toBe('implementation');
  });
});

describe('scoreAssignment', () => {
  it('should score higher for role-matching agent', () => {
    const task = makeTask({ id: 't1', action: 'implement feature' });
    const matchAgent = makeAgent({ name: 'builder', role: 'implementation' });
    const noMatchAgent = makeAgent({ name: 'tester', role: 'testing' });

    const ctx = makeContext();
    const matchScore = scoreAssignment(task, matchAgent, ctx);
    const noMatchScore = scoreAssignment(task, noMatchAgent, ctx);

    expect(matchScore).toBeGreaterThan(noMatchScore);
  });

  it('should score higher for critical tasks', () => {
    const critical = makeTask({ id: 't1', critical: true });
    const normal = makeTask({ id: 't2', critical: false });
    const agent = makeAgent({ name: 'builder' });
    const ctx = makeContext();

    expect(scoreAssignment(critical, agent, ctx)).toBeGreaterThan(
      scoreAssignment(normal, agent, ctx),
    );
  });

  it('should apply aging bonus', () => {
    const task = makeTask({ id: 't1' });
    const agent = makeAgent({ name: 'builder' });
    const now = Date.now();

    const ctxRecent = makeContext({ readySince: new Map([['t1', now]]), now });
    const ctxOld = makeContext({ readySince: new Map([['t1', now - 300_000]]), now }); // 5 min

    expect(scoreAssignment(task, agent, ctxOld)).toBeGreaterThan(
      scoreAssignment(task, agent, ctxRecent),
    );
  });

  it('should penalize retries', () => {
    const task = makeTask({ id: 't1' });
    const agent = makeAgent({ name: 'builder' });

    const ctxNoRetry = makeContext({ retryCounts: new Map() });
    const ctxRetried = makeContext({ retryCounts: new Map([['t1', 3]]) });

    expect(scoreAssignment(task, agent, ctxNoRetry)).toBeGreaterThan(
      scoreAssignment(task, agent, ctxRetried),
    );
  });

  it('should prefer small effort tasks', () => {
    const small = makeTask({ id: 't1', estimatedEffort: 'small' });
    const large = makeTask({ id: 't2', estimatedEffort: 'large' });
    const agent = makeAgent({ name: 'builder' });
    const ctx = makeContext();

    expect(scoreAssignment(small, agent, ctx)).toBeGreaterThan(
      scoreAssignment(large, agent, ctx),
    );
  });
});

describe('hasCapacity', () => {
  it('should return true when below limit', () => {
    const ctx = makeContext({ activeSlots: new Map() });
    expect(hasCapacity(ctx)).toBe(true);
  });

  it('should return false when at limit', () => {
    const slots = new Map<string, AgentSlot>();
    for (let i = 0; i < 5; i++) {
      slots.set(`run-${i}`, {
        runId: `run-${i}`,
        taskId: `t-${i}`,
        agentName: 'builder',
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        abortController: new AbortController(),
        retryCount: 0,
      });
    }
    const ctx = makeContext({ activeSlots: slots });
    expect(hasCapacity(ctx)).toBe(false);
  });
});

describe('schedule', () => {
  it('should return empty when no tasks are ready', () => {
    const ctx = makeContext({
      allTasks: [makeTask({ id: 't1', dependencies: ['t0'] })],
    });
    expect(schedule(ctx)).toHaveLength(0);
  });

  it('should assign ready tasks', () => {
    const t1 = makeTask({ id: 't1', status: 'pending' });
    const ctx = makeContext({
      allTasks: [t1],
    });
    const result = schedule(ctx);
    expect(result).toHaveLength(1);
    expect(result[0]!.task.id).toBe('t1');
  });

  it('should not assign already running tasks', () => {
    const t1 = makeTask({ id: 't1', status: 'pending' });
    const ctx = makeContext({
      allTasks: [t1],
      runningTaskIds: new Set(['t1']),
    });
    expect(schedule(ctx)).toHaveLength(0);
  });

  it('should respect maxConcurrentAgents', () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: `t${i}`, status: 'pending' }),
    );
    const ctx = makeContext({
      allTasks: tasks,
      config: { ...defaultConfig, maxConcurrentAgents: 3 },
    });
    expect(schedule(ctx).length).toBeLessThanOrEqual(3);
  });

  it('should respect dependency ordering', () => {
    const t1 = makeTask({ id: 't1', status: 'pending' });
    const t2 = makeTask({ id: 't2', status: 'pending', dependencies: ['t1'] });
    const ctx = makeContext({
      allTasks: [t1, t2],
    });
    const result = schedule(ctx);
    // Only t1 should be assigned (t2 depends on t1)
    expect(result).toHaveLength(1);
    expect(result[0]!.task.id).toBe('t1');
  });

  it('should assign t2 after t1 is done', () => {
    const t1 = makeTask({ id: 't1', status: 'done' });
    const t2 = makeTask({ id: 't2', status: 'pending', dependencies: ['t1'] });
    const ctx = makeContext({
      allTasks: [t1, t2],
      doneTaskIds: new Set(['t1']),
    });
    const result = schedule(ctx);
    expect(result).toHaveLength(1);
    expect(result[0]!.task.id).toBe('t2');
  });

  it('should produce deterministic results for same input', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'pending' }),
      makeTask({ id: 'b', status: 'pending' }),
      makeTask({ id: 'c', status: 'pending' }),
    ];
    const ctx = makeContext({ allTasks: tasks });
    const r1 = schedule(ctx);
    const r2 = schedule(ctx);
    expect(r1.map((a) => a.task.id)).toEqual(r2.map((a) => a.task.id));
  });
});

describe('updateReadySince', () => {
  it('should track when tasks first become ready', () => {
    const t1 = makeTask({ id: 't1', status: 'pending' });
    const readySince = new Map<string, number>();
    const now = 1000;

    updateReadySince([t1], new Set(), new Set(), readySince, now);
    expect(readySince.get('t1')).toBe(1000);
  });

  it('should not update timestamp for already tracked tasks', () => {
    const t1 = makeTask({ id: 't1', status: 'pending' });
    const readySince = new Map<string, number>([['t1', 500]]);

    updateReadySince([t1], new Set(), new Set(), readySince, 1000);
    expect(readySince.get('t1')).toBe(500);
  });

  it('should remove done tasks from tracking', () => {
    const t1 = makeTask({ id: 't1', status: 'done' });
    const readySince = new Map<string, number>([['t1', 500]]);

    updateReadySince([t1], new Set(['t1']), new Set(), readySince, 1000);
    expect(readySince.has('t1')).toBe(false);
  });
});
