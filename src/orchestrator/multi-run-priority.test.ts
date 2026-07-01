import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import { GlobalScheduler } from './global-scheduler.js';
import { AutoScaler } from './auto-scaler.js';
import type { AgentFactory } from './types.js';
import type { AppConfig, Pipeline } from '../lib/types.js';
import type { SystemMetrics } from '../lib/resource-monitor.js';
import { runMany, type RunSpec } from '../lib/run-many.js';

/**
 * Living spec for MULTI-RUN priority scheduling. Drives REAL Orchestrators
 * (stub backend, real mkdtemp git repos) through ONE GlobalScheduler and pins
 * the invariant the user asked for: under memory pressure the LOWEST-priority
 * run's newest agent is killed first, and a higher-priority run's agents are
 * never touched while a lower-priority run still has a live one.
 */

const CONFIG: AppConfig = { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' };

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

function metrics(ramPercent: number, ramAvailableGiB: number): SystemMetrics {
  const ramTotalBytes = 256 * 1024 ** 3;
  return {
    cpuPercent: 20,
    ramPercent,
    ramUsedBytes: ramTotalBytes - ramAvailableGiB * 1024 ** 3,
    ramTotalBytes,
    ramAvailableBytes: ramAvailableGiB * 1024 ** 3,
    processRssBytes: 1,
    loadAvg1: 0,
    containerAware: false,
    memPressureSome10: null,
  };
}

/** Fast stub agent: streams, writes one file, completes. */
function fastFactory(workMs = 30): AgentFactory {
  return async (task, _config, _hint, cwd, onEvent) => ({
    agentId: task.agentId,
    task,
    async prompt(): Promise<void> {
      onEvent({ type: 'state_change', state: 'streaming' });
      await new Promise((r) => setTimeout(r, workMs));
      const f = `a${task.agentId}.txt`;
      writeFileSync(join(cwd, f), 'x\n', 'utf8');
      onEvent({ type: 'file_write', file: f });
      onEvent({ type: 'done' });
    },
    async abort(): Promise<void> {},
    async dispose(): Promise<void> {},
  });
}

/**
 * Stub that streams and then blocks until dispose() (the kill) rejects its
 * prompt — so an agent stays "live" long enough for the scheduler to pick it
 * as a victim. Mirrors requeue.test.ts's killable stub.
 */
function blockingFactory(): AgentFactory {
  return async (task, _config, _hint, cwd, onEvent) => {
    let onDispose: (() => void) | null = null;
    const disposed = new Promise<never>((_, reject) => {
      onDispose = () => reject(new Error('disposed'));
    });
    disposed.catch(() => {});
    return {
      agentId: task.agentId,
      task,
      async prompt(): Promise<void> {
        onEvent({ type: 'state_change', state: 'streaming' });
        await Promise.race([new Promise((r) => setTimeout(r, 5_000)), disposed]);
        const f = `a${task.agentId}.txt`;
        writeFileSync(join(cwd, f), 'x\n', 'utf8');
        onEvent({ type: 'file_write', file: f });
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {
        onDispose?.();
      },
    };
  };
}

/**
 * Like {@link blockingFactory} but its agents CAN checkpoint (Fase 2.3): each
 * writes a real session file outside the worktree and returns the path, so a
 * scheduler-driven preemption PAUSES (preserve + resume) instead of killing.
 */
function pausableBlockingFactory(): AgentFactory {
  return async (task, _config, _hint, cwd, onEvent) => {
    let onDispose: (() => void) | null = null;
    const disposed = new Promise<never>((_, reject) => {
      onDispose = () => reject(new Error('disposed'));
    });
    disposed.catch(() => {});
    return {
      agentId: task.agentId,
      task,
      async prompt(): Promise<void> {
        onEvent({ type: 'state_change', state: 'streaming' });
        await Promise.race([new Promise((r) => setTimeout(r, 5_000)), disposed]);
        const f = `a${task.agentId}.txt`;
        writeFileSync(join(cwd, f), 'x\n', 'utf8');
        onEvent({ type: 'file_write', file: f });
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {
        onDispose?.();
      },
      async checkpoint(): Promise<string | null> {
        const sdir = join(dirname(cwd), '.huu-sessions', basename(cwd));
        mkdirSync(sdir, { recursive: true });
        const f = join(sdir, 'session.jsonl');
        writeFileSync(f, '{"type":"session"}\n', 'utf8');
        return f;
      },
    };
  };
}

const twoFileStage = (name: string, files: string[]): Pipeline => ({
  name,
  steps: [{ name: 's1', prompt: 'p $file', files }],
});

describe('multi-run priority scheduling', () => {
  const dirs: string[] = [];
  function freshRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'multi-run-'));
    setupRepo(d);
    dirs.push(d);
    return d;
  }

  beforeEach(() => {
    dirs.length = 0;
  });

  afterEach(() => {
    for (const d of dirs) {
      try {
        execSync(`rm -rf "${d}"`, { encoding: 'utf8' });
      } catch {
        /* best effort */
      }
    }
  });

  it(
    'two subordinate runs share one scheduler and both complete',
    async () => {
      const specs: RunSpec[] = [
        {
          pipeline: twoFileStage('A', ['a.ts', 'b.ts']),
          config: CONFIG,
          cwd: freshRepo(),
          agentFactory: fastFactory(),
          label: 'A',
        },
        {
          pipeline: twoFileStage('B', ['c.ts', 'd.ts']),
          config: CONFIG,
          cwd: freshRepo(),
          agentFactory: fastFactory(),
          label: 'B',
        },
      ];

      const results = await runMany(specs, { admitCheckMs: 50, admitHysteresisChecks: 1 });

      expect(results.map((r) => r.status)).toEqual(['done', 'done']);
      // Both runs merged their stage branches — subordinate mode drove the pool
      // end-to-end (grantFor, register/unregister, shared port set, no deadlock).
      expect(results[0]!.result!.integration.branchesMerged).toHaveLength(2);
      expect(results[1]!.result!.integration.branchesMerged).toHaveLength(2);
    },
    30_000,
  );

  it(
    'two runs on the SAME repo complete without git races (repo-lock)',
    async () => {
      // ONE repo shared by both runs — they create worktrees/branches on the
      // same .git concurrently. runMany injects a scheduler, so the Orchestrator
      // turns on serializeGitOps and the per-repo lock guards worktree add /
      // branch create. Overlapping work (80ms agents, fast admission) forces the
      // two runs' git plumbing to actually interleave.
      const repo = freshRepo();
      const specs: RunSpec[] = [
        {
          pipeline: twoFileStage('A', ['a.ts', 'b.ts', 'c.ts']),
          config: CONFIG,
          cwd: repo,
          agentFactory: fastFactory(80),
          label: 'A',
        },
        {
          pipeline: twoFileStage('B', ['d.ts', 'e.ts', 'f.ts']),
          config: CONFIG,
          cwd: repo,
          agentFactory: fastFactory(80),
          label: 'B',
        },
      ];

      const results = await runMany(specs, { admitCheckMs: 25, admitHysteresisChecks: 1 });

      expect(results.map((r) => r.status)).toEqual(['done', 'done']);
      // Each run's branches are runId-namespaced, so both fully merge despite
      // sharing one repo.
      expect(results[0]!.result!.integration.branchesMerged).toHaveLength(3);
      expect(results[1]!.result!.integration.branchesMerged).toHaveLength(3);
    },
    30_000,
  );

  it(
    'under memory pressure the lowest-priority run is the kill victim, not the higher-priority one',
    async () => {
      // Budget driven by a mutable metrics ref; start healthy so both runs spawn.
      let ram = metrics(40, 200);
      const budget = new AutoScaler({ resourceMonitor: () => ram });
      budget.setMode('auto');
      budget.start();
      // Inject the budget; DON'T start the scheduler's auto-tick — we drive
      // tick() manually for determinism (the subordinate pools still refresh
      // grants every pool tick on their own).
      const scheduler = new GlobalScheduler({ budget });

      const orchA = new Orchestrator(
        CONFIG,
        twoFileStage('A', ['a1.ts', 'a2.ts']),
        freshRepo(),
        blockingFactory(),
        { scheduler },
      );
      const orchB = new Orchestrator(
        CONFIG,
        twoFileStage('B', ['b1.ts', 'b2.ts']),
        freshRepo(),
        blockingFactory(),
        { scheduler },
      );

      // Track requeues per run so we can assert WHO got killed.
      let aRequeues = 0;
      let bRequeues = 0;
      let aStreaming = 0;
      let bStreaming = 0;
      orchA.subscribe((s) => {
        aRequeues = s.agents.reduce((n, ag) => n + (ag.requeues ?? 0), 0);
        aStreaming = s.agents.filter((ag) => ag.state === 'streaming').length;
      });
      orchB.subscribe((s) => {
        bRequeues = s.agents.reduce((n, ag) => n + (ag.requeues ?? 0), 0);
        bStreaming = s.agents.filter((ag) => ag.state === 'streaming').length;
      });

      // Start A FIRST so it registers as the higher-priority run (seq 0), then B.
      const pA = orchA.start();
      await waitFor(() => aStreaming > 0);
      const pB = orchB.start();
      await waitFor(() => bStreaming > 0);

      // Spike RAM and force a guard pass: the scheduler must pick B (lower
      // priority), not A. acceptMetrics makes the budget see the spike now.
      ram = metrics(98, 1);
      budget.acceptMetrics(ram);
      await scheduler.tick();

      expect(bRequeues).toBe(1); // lowest-priority run's newest agent was killed+requeued
      expect(aRequeues).toBe(0); // higher-priority run untouched

      // Tear down: relieve pressure and abort both runs (we only needed the kill
      // ordering, not completion).
      ram = metrics(40, 200);
      budget.acceptMetrics(ram);
      orchA.abort();
      orchB.abort();
      await Promise.allSettled([pA, pB]);
      budget.stop();
    },
    30_000,
  );

  it(
    'Fase 2.3: under pressure the lowest-priority run is PAUSED (work preserved), not killed',
    async () => {
      const prev = process.env.HUU_NO_PAUSE;
      delete process.env.HUU_NO_PAUSE; // default = pause on
      try {
        let ram = metrics(40, 200);
        const budget = new AutoScaler({ resourceMonitor: () => ram });
        budget.setMode('auto');
        budget.start();
        const scheduler = new GlobalScheduler({ budget });

        const orchA = new Orchestrator(
          CONFIG,
          twoFileStage('A', ['a1.ts', 'a2.ts']),
          freshRepo(),
          pausableBlockingFactory(),
          { scheduler },
        );
        const orchB = new Orchestrator(
          CONFIG,
          twoFileStage('B', ['b1.ts', 'b2.ts']),
          freshRepo(),
          pausableBlockingFactory(),
          { scheduler },
        );

        let aPauses = 0, bPauses = 0, aRequeues = 0, bRequeues = 0, aStreaming = 0, bStreaming = 0;
        orchA.subscribe((s) => {
          aPauses = s.agents.reduce((n, ag) => n + (ag.pauses ?? 0), 0);
          aRequeues = s.agents.reduce((n, ag) => n + (ag.requeues ?? 0), 0);
          aStreaming = s.agents.filter((ag) => ag.state === 'streaming').length;
        });
        orchB.subscribe((s) => {
          bPauses = s.agents.reduce((n, ag) => n + (ag.pauses ?? 0), 0);
          bRequeues = s.agents.reduce((n, ag) => n + (ag.requeues ?? 0), 0);
          bStreaming = s.agents.filter((ag) => ag.state === 'streaming').length;
        });

        const pA = orchA.start();
        await waitFor(() => aStreaming > 0);
        const pB = orchB.start();
        await waitFor(() => bStreaming > 0);

        ram = metrics(98, 1);
        budget.acceptMetrics(ram);
        await scheduler.tick();

        // Lowest-priority run's newest agent was PAUSED (preserved), not requeued;
        // the higher-priority run is untouched.
        expect(bPauses).toBe(1);
        expect(bRequeues).toBe(0);
        expect(aPauses).toBe(0);
        expect(aRequeues).toBe(0);

        ram = metrics(40, 200);
        budget.acceptMetrics(ram);
        orchA.abort();
        orchB.abort();
        await Promise.allSettled([pA, pB]);
        budget.stop();
      } finally {
        if (prev === undefined) delete process.env.HUU_NO_PAUSE;
        else process.env.HUU_NO_PAUSE = prev;
      }
    },
    30_000,
  );

  it(
    'HUU_NO_PAUSE=1 forces the multi-run guard back to kill+requeue even when checkpoints exist',
    async () => {
      const prev = process.env.HUU_NO_PAUSE;
      process.env.HUU_NO_PAUSE = '1';
      try {
        let ram = metrics(40, 200);
        const budget = new AutoScaler({ resourceMonitor: () => ram });
        budget.setMode('auto');
        budget.start();
        // Reads HUU_NO_PAUSE at construction → kill path.
        const scheduler = new GlobalScheduler({ budget });

        const orchA = new Orchestrator(
          CONFIG,
          twoFileStage('A', ['a1.ts', 'a2.ts']),
          freshRepo(),
          pausableBlockingFactory(),
          { scheduler },
        );
        const orchB = new Orchestrator(
          CONFIG,
          twoFileStage('B', ['b1.ts', 'b2.ts']),
          freshRepo(),
          pausableBlockingFactory(),
          { scheduler },
        );

        let bPauses = 0, bRequeues = 0, aStreaming = 0, bStreaming = 0;
        orchA.subscribe((s) => {
          aStreaming = s.agents.filter((ag) => ag.state === 'streaming').length;
        });
        orchB.subscribe((s) => {
          bPauses = s.agents.reduce((n, ag) => n + (ag.pauses ?? 0), 0);
          bRequeues = s.agents.reduce((n, ag) => n + (ag.requeues ?? 0), 0);
          bStreaming = s.agents.filter((ag) => ag.state === 'streaming').length;
        });

        const pA = orchA.start();
        await waitFor(() => aStreaming > 0);
        const pB = orchB.start();
        await waitFor(() => bStreaming > 0);

        ram = metrics(98, 1);
        budget.acceptMetrics(ram);
        await scheduler.tick();

        // Flag off → KILLED (requeue), not paused, despite checkpoints being
        // available — byte-identical to pre-2.3.
        expect(bRequeues).toBe(1);
        expect(bPauses).toBe(0);

        ram = metrics(40, 200);
        budget.acceptMetrics(ram);
        orchA.abort();
        orchB.abort();
        await Promise.allSettled([pA, pB]);
        budget.stop();
      } finally {
        if (prev === undefined) delete process.env.HUU_NO_PAUSE;
        else process.env.HUU_NO_PAUSE = prev;
      }
    },
    30_000,
  );
});

/** Poll a predicate until true or timeout. */
async function waitFor(pred: () => boolean, timeoutMs = 8_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
