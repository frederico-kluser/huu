import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import type { AgentFactory } from './types.js';
import type { Pipeline } from '../lib/types.js';

function setupRepo(dir: string): void {
  execSync('git init --initial-branch=main', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "t@t.com" && git config user.name "t"', {
    cwd: dir,
    shell: '/bin/bash',
  });
  writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.huu-worktrees/\n', 'utf8');
  execSync('git add -A && git commit -m init', { cwd: dir, encoding: 'utf8' });
}

/**
 * Stub whose prompt() blocks ~workMs and rejects early when dispose() is
 * called — mirroring how a real SDK session's in-flight request settles
 * when the orchestrator tears the agent down. `failWhen` lets a test make
 * specific spawns fail genuinely (post-requeue regression).
 */
function makeKillableFactory(opts: {
  workMs?: number;
  failWhen?: (agentId: number, spawnCount: number) => boolean;
}): { factory: AgentFactory; spawnCounts: Map<number, number> } {
  const spawnCounts = new Map<number, number>();
  const workMs = opts.workMs ?? 150;
  const factory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => {
    const spawnCount = (spawnCounts.get(task.agentId) ?? 0) + 1;
    spawnCounts.set(task.agentId, spawnCount);
    let onDispose: (() => void) | null = null;
    const disposed = new Promise<never>((_, reject) => {
      onDispose = () => reject(new Error('disposed'));
    });
    disposed.catch(() => {
      /* mark handled — the success path disposes after prompt resolved */
    });
    return {
      agentId: task.agentId,
      task,
      async prompt(): Promise<void> {
        onEvent({ type: 'state_change', state: 'streaming' });
        if (opts.failWhen?.(task.agentId, spawnCount)) {
          throw new Error('genuine failure after requeue');
        }
        await Promise.race([
          new Promise((r) => setTimeout(r, workMs)),
          disposed,
        ]);
        const fileName = `a${task.agentId}.txt`;
        writeFileSync(join(cwd, fileName), 'content\n', 'utf8');
        onEvent({ type: 'file_write', file: fileName });
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {
        onDispose?.();
      },
    };
  };
  return { factory, spawnCounts };
}

describe('memory-guard requeue (kill → TODO)', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'requeue-test-'));
    setupRepo(scratch);
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${scratch}"`, { encoding: 'utf8' });
    } catch {
      /* best effort */
    }
  });

  it(
    'killed card returns to TODO with a requeue counter and the rerun completes',
    async () => {
      const pipeline: Pipeline = {
        name: 'requeue',
        steps: [{ name: 'stage1', prompt: 'p $file', files: ['a.ts', 'b.ts', 'c.ts'] }],
      };
      const { factory, spawnCounts } = makeKillableFactory({});

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false },
      );

      let killedId: number | null = null;
      let sawRequeuedTodo = false;
      orch.subscribe((state) => {
        if (killedId === null) {
          const streaming = state.agents.find((a) => a.state === 'streaming');
          if (streaming) {
            killedId = streaming.agentId;
            void orch.destroyAgent(streaming.agentId);
          }
          return;
        }
        const victim = state.agents.find((a) => a.agentId === killedId);
        if (victim && victim.phase === 'pending' && (victim.requeues ?? 0) === 1) {
          sawRequeuedTodo = true;
        }
      });

      const result = await orch.start();

      expect(result.manifest.status).toBe('done');
      expect(killedId).not.toBeNull();
      // The card visibly went back to the TODO column (phase pending) with
      // its requeue counter before the rerun picked it up.
      expect(sawRequeuedTodo).toBe(true);
      // The killed task restarted from zero (a second spawn) and completed.
      expect(spawnCounts.get(killedId!)).toBe(2);
      const victim = result.agents.find((a) => a.agentId === killedId)!;
      expect(victim.state).toBe('done');
      expect(victim.commitSha).toBeDefined();
      expect(victim.requeues).toBe(1);
      // Nothing was double-counted: one manifest entry per agent, all merged.
      expect(result.agents).toHaveLength(3);
      expect(result.agents.filter((a) => a.commitSha)).toHaveLength(3);
      expect(result.integration.branchesMerged).toHaveLength(3);
    },
    20_000,
  );

  it(
    'a requeued task that later fails genuinely still errors (stale-flag regression)',
    async () => {
      const pipeline: Pipeline = {
        name: 'requeue-then-fail',
        steps: [{ name: 'stage1', prompt: 'p $file', files: ['a.ts', 'b.ts'] }],
      };
      let killedId: number | null = null;
      // Every spawn of the killed agent AFTER the kill fails genuinely. With
      // the old `killedByAutoScaler` status flag (never cleared), these
      // failures were swallowed by the early-return and the task silently
      // dropped — never retried, never marked error, never counted.
      const { factory } = makeKillableFactory({
        failWhen: (agentId, spawnCount) => agentId === killedId && spawnCount >= 2,
      });

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false },
      );

      orch.subscribe((state) => {
        if (killedId === null) {
          const streaming = state.agents.find((a) => a.state === 'streaming');
          if (streaming) {
            killedId = streaming.agentId;
            void orch.destroyAgent(streaming.agentId);
          }
        }
      });

      const result = await orch.start();

      expect(killedId).not.toBeNull();
      const victim = result.agents.find((a) => a.agentId === killedId)!;
      // The genuine failure consumed the normal retry path and surfaced as
      // an error — not a silent drop.
      expect(victim.state).toBe('error');
      expect(victim.errorKind).toBe('failed');
      expect(victim.error).toContain('genuine failure');
      // The other task still completed and merged.
      const other = result.agents.find((a) => a.agentId !== killedId)!;
      expect(other.state).toBe('done');
      expect(other.commitSha).toBeDefined();
    },
    20_000,
  );

  it(
    'guard kill → TODO → rerun still holds in greedy (MAX) mode, which also floods concurrency',
    async () => {
      const pipeline: Pipeline = {
        name: 'requeue-greedy',
        steps: [{ name: 'stage1', prompt: 'p $file', files: ['a.ts', 'b.ts', 'c.ts'] }],
      };
      const { factory, spawnCounts } = makeKillableFactory({});

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        factory,
        { initialConcurrency: 1 },
      );
      // MAX mode: the poll loop now drives concurrency from the queue depth
      // (not the memory headroom), and the always-on guard stays the sole
      // backstop. The kill→TODO→rerun regression must survive this mode.
      orch.enableGreedyMode();

      let killedId: number | null = null;
      let sawGreedy = false;
      let maxConcurrency = 0;
      orch.subscribe((state) => {
        if (state.autoScale?.mode === 'greedy') sawGreedy = true;
        if (state.concurrency > maxConcurrency) maxConcurrency = state.concurrency;
        if (killedId === null) {
          const streaming = state.agents.find((a) => a.state === 'streaming');
          if (streaming) {
            killedId = streaming.agentId;
            void orch.destroyAgent(streaming.agentId);
          }
        }
      });

      const result = await orch.start();

      expect(result.manifest.status).toBe('done');
      expect(sawGreedy).toBe(true);
      // Greedy floated concurrency up from the initial 1 toward the queue depth.
      expect(maxConcurrency).toBeGreaterThan(1);
      expect(killedId).not.toBeNull();
      // Killed card went back to TODO with a requeue counter and reran to done.
      expect(spawnCounts.get(killedId!)).toBe(2);
      const victim = result.agents.find((a) => a.agentId === killedId)!;
      expect(victim.state).toBe('done');
      expect(victim.requeues).toBe(1);
      // All three tasks merged — nothing dropped or double-counted.
      expect(result.agents).toHaveLength(3);
      expect(result.agents.filter((a) => a.commitSha)).toHaveLength(3);
      expect(result.integration.branchesMerged).toHaveLength(3);
    },
    20_000,
  );
});
