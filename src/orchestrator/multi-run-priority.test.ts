import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import { GlobalScheduler, type RunDriver } from './global-scheduler.js';
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
    memPressureFull10: null,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    swapInPagesPerSec: null,
    hostMemTotalBytes: null,
    hostMemAvailableBytes: null,
    containerSwapUsedBytes: null,
    containerSwapTotalBytes: null,
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

      // Deterministic machine view: runMany's lazy admission charges the next
      // run's baseline against REAL RAM headroom under the default 70% dial —
      // on a loaded box (used > dial) the second run is never admitted and the
      // test stalls at the timeout. Inject a healthy-metrics scheduler via the
      // RunManyOptions.scheduler seam (same pattern as the other tests in this
      // file): both runs still share ONE real GlobalScheduler end-to-end.
      const budget = new AutoScaler({ resourceMonitor: () => metrics(40, 200) });
      const scheduler = new GlobalScheduler({ budget });
      const results = await runMany(specs, {
        admitCheckMs: 50,
        admitHysteresisChecks: 1,
        scheduler,
      });
      scheduler.stop(); // an injected scheduler is caller-owned (the driver stops only its own)

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
      // same .git concurrently. A scheduler is injected into runMany, so the
      // Orchestrator turns on serializeGitOps and the per-repo lock guards
      // worktree add / branch create. Overlapping work (80ms agents, fast
      // admission) forces the two runs' git plumbing to actually interleave.
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

      // Injected healthy-metrics scheduler (same rationale as the test above):
      // admission must not depend on the HOST's real RAM headroom, or a loaded
      // box never admits run B and the interleaving this test exists to force
      // never happens.
      const budget = new AutoScaler({ resourceMonitor: () => metrics(40, 200) });
      const scheduler = new GlobalScheduler({ budget });
      const results = await runMany(specs, {
        admitCheckMs: 25,
        admitHysteresisChecks: 1,
        scheduler,
      });
      scheduler.stop(); // an injected scheduler is caller-owned (the driver stops only its own)

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
        let bPauseLog = '';
        orchA.subscribe((s) => {
          aPauses = s.agents.reduce((n, ag) => n + (ag.pauses ?? 0), 0);
          aRequeues = s.agents.reduce((n, ag) => n + (ag.requeues ?? 0), 0);
          aStreaming = s.agents.filter((ag) => ag.state === 'streaming').length;
        });
        orchB.subscribe((s) => {
          bPauses = s.agents.reduce((n, ag) => n + (ag.pauses ?? 0), 0);
          bRequeues = s.agents.reduce((n, ag) => n + (ag.requeues ?? 0), 0);
          bStreaming = s.agents.filter((ag) => ag.state === 'streaming').length;
          bPauseLog =
            s.logs.find((l) => l.message.includes('paused by memory guard'))?.message ?? bPauseLog;
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
        // The user-visible message names the LADDER verdict that fired — a
        // preemption at low container-RAM% was undiagnosable without it
        // (the 8-project storm read as "paused (RAM 9%)" with no cause).
        // These metrics trip the L3 emergency floors (avail 0.4% + no swap).
        expect(bPauseLog).toContain('paused by memory guard — ');
        expect(bPauseLog).toContain('below emergency floor');

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

  /** Pipeline with a gated CheckStep between two one-file work steps. */
  const checkedPipeline = (name: string): Pipeline => ({
    name,
    steps: [
      { name: 'work', prompt: 'p $file', files: ['a.ts'] },
      {
        type: 'check',
        name: 'gate',
        condition: 'is the work done?',
        maxRuns: 2,
        outcomes: [
          { label: 'approved', nextStepName: 'final', default: true },
          { label: 'rework', nextStepName: 'work' },
        ],
      },
      { name: 'final', prompt: 'p $file', files: ['b.ts'] },
    ],
  });

  /**
   * Factory whose CheckStep judge (reserved id 9998) BLOCKS until released —
   * task agents complete fast. Lets a test observe the budget WHILE the judge
   * lives.
   */
  function gatedJudgeFactory(judgeGate: Promise<void>): AgentFactory {
    return async (task, _config, _hint, cwd, onEvent) => ({
      agentId: task.agentId,
      task,
      async prompt(): Promise<void> {
        if (task.agentId === 9998) {
          await judgeGate;
          onEvent({ type: 'log', message: '```json\n{"label":"approved","reason":"ok"}\n```' });
          onEvent({ type: 'done' });
          return;
        }
        onEvent({ type: 'state_change', state: 'streaming' });
        const f = `a${task.agentId}.txt`;
        writeFileSync(join(cwd, f), 'x\n', 'utf8');
        onEvent({ type: 'file_write', file: f });
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {},
    });
  }

  it(
    'a live CheckStep judge is COUNTED in the global budget (demand, telemetry, state) and never a victim',
    async () => {
      const budget = new AutoScaler({ resourceMonitor: () => metrics(40, 200) });
      budget.setMode('auto');
      budget.start();
      const scheduler = new GlobalScheduler({ budget });

      let releaseJudge!: () => void;
      const judgeGate = new Promise<void>((r) => {
        releaseJudge = r;
      });
      const orch = new Orchestrator(
        CONFIG,
        checkedPipeline('JudgeCounted'),
        freshRepo(),
        gatedJudgeFactory(judgeGate),
        { scheduler },
      );

      const done = orch.start();
      await waitFor(() => orch.getState().checkRuns[0]?.phase === 'judging');

      // While the judge deliberates, the run is between steps (pool idle) —
      // pre-fix its demand read as ZERO and the judge was invisible to B.
      scheduler.recomputeGrants();
      const tel = scheduler.budgetTelemetry();
      expect(tel.reservedAgents).toBe(1);
      expect(tel.liveAgents).toBeGreaterThanOrEqual(1);
      expect(orch.getState().reservedAgentCount).toBe(1);
      expect(scheduler.grantFor(orch.getState().runId)).toBeGreaterThanOrEqual(1);
      // Never a preemption victim: the victim selector sees no task agents.
      expect(scheduler.selectGlobalVictim()).toBeNull();

      releaseJudge();
      await done;
      expect(orch.getState().status).toBe('done');
      expect(orch.getState().checkRuns[0]?.outcomeLabel).toBe('approved');
      expect(orch.getState().reservedAgentCount).toBe(0);
      scheduler.recomputeGrants();
      expect(scheduler.budgetTelemetry().reservedAgents).toBe(0);
      budget.stop();
    },
    30_000,
  );

  it(
    'the reserved judge spawns UNGATED — a spawn-freezing budget cannot deadlock a CheckStep',
    async () => {
      // Mutable metrics: healthy for the work step, then flipped to a
      // spawn-freezing spike the moment the work task settles — BEFORE the
      // check visit spawns the judge. The judge must still spawn (the reserved
      // path has no shouldSpawn gate — gating it would deadlock the run:
      // the stage cannot complete without its judge) and the run must finish
      // once pressure clears.
      let ram = metrics(40, 200);
      const budget = new AutoScaler({ resourceMonitor: () => ram });
      budget.setMode('auto');
      budget.start();
      const scheduler = new GlobalScheduler({ budget });

      let releaseJudge!: () => void;
      const judgeGate = new Promise<void>((r) => {
        releaseJudge = r;
      });
      const orch = new Orchestrator(
        CONFIG,
        checkedPipeline('JudgeUngated'),
        freshRepo(),
        gatedJudgeFactory(judgeGate),
        { scheduler },
      );

      let spiked = false;
      orch.subscribe((s) => {
        if (!spiked && s.completedTasks >= 1 && s.checkRuns.length === 0) {
          spiked = true;
          ram = metrics(99, 1);
          budget.acceptMetrics(ram);
        }
      });

      const done = orch.start();
      // The judge reached 'judging' DESPITE the frozen budget — the pin: a
      // future gate on the reserved path would hang here and fail the test.
      await waitFor(() => orch.getState().checkRuns[0]?.phase === 'judging');
      expect(spiked).toBe(true);
      // The budget really IS spawn-frozen at 99% RAM. Asserted with a task
      // agent counted live, because at ZERO live agents shouldSpawn() applies
      // its floor-of-one (degrade to sequential, never to zero) and would
      // legitimately admit one — a different invariant, pinned in
      // auto-scaler.test.ts. Reserved agents stay out of activeAgentCount, so
      // the judge alive here does not raise it.
      budget.syncCounts(1, 0);
      expect(budget.shouldSpawn()).toBe(false);
      budget.syncCounts(0, 0);

      ram = metrics(40, 200);
      budget.acceptMetrics(ram);
      releaseJudge();
      await done;
      expect(orch.getState().status).toBe('done');
      budget.stop();
    },
    30_000,
  );

  it(
    'the RunDriver literal exposes reservedLiveCount (interface ≠ literal regression)',
    async () => {
      // The scheduler holds the EXPLICIT literal from index.ts, not the
      // Orchestrator itself — a field added only to the interface (or only to
      // the class) silently reads as undefined here. Past bug: pauseAgent.
      const captured: RunDriver[] = [];
      class SpyScheduler extends GlobalScheduler {
        override register(driver: RunDriver, priority?: number): ReturnType<GlobalScheduler['register']> {
          captured.push(driver);
          return super.register(driver, priority);
        }
      }
      const budget = new AutoScaler({ resourceMonitor: () => metrics(40, 200) });
      budget.setMode('auto');
      budget.start();
      const scheduler = new SpyScheduler({ budget });

      const orch = new Orchestrator(
        CONFIG,
        twoFileStage('Literal', ['a.ts']),
        freshRepo(),
        fastFactory(),
        { scheduler },
      );
      await orch.start();

      expect(captured).toHaveLength(1);
      const driver = captured[0]!;
      expect(typeof driver.reservedLiveCount).toBe('function');
      expect(driver.reservedLiveCount!()).toBe(0);
      expect(typeof driver.wakeup).toBe('function');
      budget.stop();
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
