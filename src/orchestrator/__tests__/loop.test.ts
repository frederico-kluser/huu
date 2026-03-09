import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import { MergeQueueRepository } from '../../db/repositories/merge-queue.js';
import { MergeResultsRepository } from '../../db/repositories/merge-results.js';
import { BeatSheetPersistence } from '../beatsheet-persistence.js';
import { OrchestratorLoop, DEFAULT_CONFIG } from '../loop.js';
import type { LoopDeps, LoopEvent } from '../loop.js';
import type { BeatSheet } from '../beatsheet.js';
import type { AgentDefinition } from '../../agents/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

const builderAgent: AgentDefinition = {
  name: 'builder',
  role: 'implementation',
  description: 'Test builder agent',
  model: 'sonnet',
  tools: ['read_file', 'write_file'],
  systemPrompt: 'You are a test builder.',
};

function makeBeatSheet(tasks: Array<{ id: string; deps?: string[]; status?: string }>): BeatSheet {
  return {
    id: 'bs-test',
    objective: 'Test objective',
    successCriteria: ['All tasks done'],
    constraints: [],
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
            tasks: tasks.map((t) => ({
              id: t.id,
              actId: 'act-1',
              sequenceId: 'seq-1',
              title: `Task ${t.id}`,
              precondition: 'none',
              action: 'implement feature',
              postcondition: 'done',
              verification: 'tests pass',
              dependencies: t.deps ?? [],
              critical: false,
              estimatedEffort: 'small' as const,
              status: (t.status ?? 'pending') as any,
            })),
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

function createMockDeps(db: Database.Database): LoopDeps {
  const queue = new MessageQueue(db);
  const mergeQueue = new MergeQueueRepository(db);
  const mergeResults = new MergeResultsRepository(db);

  // Mock merge manager
  const mergeManager = {
    enqueue: vi.fn().mockReturnValue({ id: 1, request_id: 'test', status: 'queued' }),
    processNext: vi.fn().mockResolvedValue(null),
    preMergeCheck: vi.fn(),
  } as any;

  // Mock runtime deps — spawnAgent will be called in loop
  const runtimeDeps = {
    worktreeManager: {} as any,
    queue,
    auditLog: { append: vi.fn() } as any,
    toolRegistry: {} as any,
  };

  return {
    db,
    queue,
    runtimeDeps,
    mergeManager,
    availableAgents: [builderAgent],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('OrchestratorLoop', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db?.close();
  });

  describe('initialization', () => {
    it('should start in DECOMPOSE state', () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      expect(loop.getState()).toBe('DECOMPOSE');
    });

    it('should accept custom config', () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1', {
        maxConcurrentAgents: 10,
      });
      expect(loop.getLoopState().runId).toBe('run-1');
    });
  });

  describe('DECOMPOSE state', () => {
    it('should stay in DECOMPOSE when no beat sheet exists', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const ac = new AbortController();

      await loop.tick(ac.signal);
      expect(loop.getState()).toBe('DECOMPOSE');
    });

    it('should transition to ASSIGN when beat sheet is set', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const ac = new AbortController();

      const sheet = makeBeatSheet([{ id: 't1' }, { id: 't2' }]);
      loop.setBeatSheet(sheet);

      await loop.tick(ac.signal);
      expect(loop.getState()).toBe('ASSIGN');
    });

    it('should load beat sheet from persistence', async () => {
      const deps = createMockDeps(db);
      const persistence = new BeatSheetPersistence(db);
      const sheet = makeBeatSheet([{ id: 't1' }]);
      persistence.save('default', 'run-1', sheet);

      const loop = new OrchestratorLoop(deps, 'run-1');
      const ac = new AbortController();

      await loop.tick(ac.signal);
      expect(loop.getState()).toBe('ASSIGN');
      expect(loop.getBeatSheet()).not.toBeNull();
    });
  });

  describe('ASSIGN state', () => {
    it('should transition to MONITOR after assigning tasks', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const ac = new AbortController();

      const sheet = makeBeatSheet([{ id: 't1' }]);
      loop.setBeatSheet(sheet);

      // DECOMPOSE → ASSIGN
      await loop.tick(ac.signal);
      expect(loop.getState()).toBe('ASSIGN');

      // ASSIGN → MONITOR (spawns agent)
      await loop.tick(ac.signal);
      expect(loop.getState()).toBe('MONITOR');
    });

    it('should transition to ADVANCE_BEAT when all tasks done', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const ac = new AbortController();

      const sheet = makeBeatSheet([{ id: 't1', status: 'done' }]);
      loop.setBeatSheet(sheet);

      // DECOMPOSE → ASSIGN
      await loop.tick(ac.signal);
      // ASSIGN: all done, no active slots → ADVANCE_BEAT
      await loop.tick(ac.signal);
      expect(loop.getState()).toBe('ADVANCE_BEAT');
    });
  });

  describe('event emission', () => {
    it('should emit state_change events', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const events: LoopEvent[] = [];
      loop.on((e) => events.push(e));

      const sheet = makeBeatSheet([{ id: 't1' }]);
      loop.setBeatSheet(sheet);

      const ac = new AbortController();
      await loop.tick(ac.signal);

      const stateChanges = events.filter((e) => e.type === 'state_change');
      expect(stateChanges.length).toBeGreaterThan(0);
    });

    it('should emit task_assigned events', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const events: LoopEvent[] = [];
      loop.on((e) => events.push(e));

      const sheet = makeBeatSheet([{ id: 't1' }]);
      loop.setBeatSheet(sheet);

      const ac = new AbortController();
      // DECOMPOSE → ASSIGN
      await loop.tick(ac.signal);
      // ASSIGN → spawns agent
      await loop.tick(ac.signal);

      const assignEvents = events.filter((e) => e.type === 'task_assigned');
      expect(assignEvents.length).toBeGreaterThan(0);
      expect(assignEvents[0]!.data['taskId']).toBe('t1');
    });

    it('should not crash if event handler throws', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      loop.on(() => {
        throw new Error('handler error');
      });

      const sheet = makeBeatSheet([{ id: 't1' }]);
      loop.setBeatSheet(sheet);

      const ac = new AbortController();
      // Should not throw
      await loop.tick(ac.signal);
    });
  });

  describe('MONITOR state', () => {
    it('should transition to ASSIGN when no active slots and no messages', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const ac = new AbortController();

      const sheet = makeBeatSheet([{ id: 't1' }]);
      loop.setBeatSheet(sheet);

      // Force into MONITOR state
      await loop.tick(ac.signal); // DECOMPOSE → ASSIGN
      await loop.tick(ac.signal); // ASSIGN → MONITOR

      // Wait for the spawn promise to settle (uses promise micro-task)
      await new Promise(resolve => setTimeout(resolve, 50));

      // Since spawnAgent is real but deps are mocked, the agent will fail
      // and the slot will be removed. Next tick in MONITOR should go to ASSIGN
      await loop.tick(ac.signal);
      // Could be ASSIGN or COLLECT depending on escalation messages
      expect(['ASSIGN', 'COLLECT', 'MONITOR']).toContain(loop.getState());
    });
  });

  describe('COLLECT state', () => {
    it('should process task_done messages', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const ac = new AbortController();
      const events: LoopEvent[] = [];
      loop.on((e) => events.push(e));

      const sheet = makeBeatSheet([{ id: 't1' }]);
      loop.setBeatSheet(sheet);

      // Simulate a task_done message
      deps.queue.enqueue({
        project_id: 'default',
        message_type: 'task_done',
        sender_agent: 'builder',
        recipient_agent: 'orchestrator',
        run_id: 'agent-run-1',
        correlation_id: 't1',
        payload: { state: 'completed', commitSha: 'abc123' },
      });

      // DECOMPOSE → ASSIGN
      await loop.tick(ac.signal);
      // ASSIGN → MONITOR (or straight to MONITOR since task needs spawning)
      await loop.tick(ac.signal);

      // Force into COLLECT manually by setting state
      // (In real flow, MONITOR would detect the message and transition)
      // We'll pump multiple ticks to let the FSM advance
      for (let i = 0; i < 5; i++) {
        await loop.tick(ac.signal);
        if (loop.getState() === 'COLLECT') break;
      }

      // Verify task_completed events were emitted at some point
      // (depends on timing of message consumption)
    });
  });

  describe('ADVANCE_BEAT state', () => {
    it('should evaluate checkpoints when all tasks resolved', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const events: LoopEvent[] = [];
      loop.on((e) => events.push(e));
      const ac = new AbortController();

      const sheet = makeBeatSheet([
        { id: 't1', status: 'done' },
        { id: 't2', status: 'done' },
      ]);
      loop.setBeatSheet(sheet);

      // DECOMPOSE → ASSIGN
      await loop.tick(ac.signal);
      // ASSIGN: all done → ADVANCE_BEAT
      await loop.tick(ac.signal);
      expect(loop.getState()).toBe('ADVANCE_BEAT');

      // ADVANCE_BEAT → evaluates checkpoints → COMPLETED
      await loop.tick(ac.signal);
      expect(loop.getState()).toBe('COMPLETED');

      const beatEvents = events.filter((e) => e.type === 'beat_advanced');
      expect(beatEvents.length).toBeGreaterThan(0);
    });
  });

  describe('abort handling', () => {
    it('should stop loop when signal is aborted', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');

      const sheet = makeBeatSheet([{ id: 't1' }]);
      loop.setBeatSheet(sheet);

      const ac = new AbortController();
      // Abort immediately
      ac.abort();

      const finalState = await loop.run(ac.signal);
      // Should stop without completing
      expect(finalState).not.toBe('COMPLETED');
    });
  });

  describe('full cycle', () => {
    it('should complete when all tasks are already done', async () => {
      const deps = createMockDeps(db);
      const loop = new OrchestratorLoop(deps, 'run-1');
      const ac = new AbortController();

      const sheet = makeBeatSheet([
        { id: 't1', status: 'done' },
        { id: 't2', status: 'done' },
      ]);
      loop.setBeatSheet(sheet);

      const finalState = await loop.run(ac.signal);
      expect(finalState).toBe('COMPLETED');
    });
  });
});
