import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MultiRunDriver, type MultiRunSpec } from './multi-run-driver.js';
import { GlobalScheduler } from './global-scheduler.js';
import { AutoScaler } from './auto-scaler.js';
import type { AgentFactory } from './types.js';
import type { AppConfig, Pipeline } from '../lib/types.js';
import type { SystemMetrics } from '../lib/resource-monitor.js';

/**
 * Living spec for LAZY ADMISSION in the shared multi-run driver — the fix for
 * the blind-admission OOM of ROADMAP.md. The invariant under test: only the
 * highest-priority run starts immediately, every later run sits in `queued`
 * (owning NO Orchestrator, costing NO budget) until the machine shows sustained
 * spare capacity. Real Orchestrators, stub backend, real mkdtemp git repos.
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

/** Stub that blocks until dispose(), so a run stays live while we assert. */
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

const oneStage = (name: string, files: string[]): Pipeline => ({
  name,
  steps: [{ name: 's1', prompt: 'p $file', files }],
});

/** Scheduler whose machine read is fixed, so admission is deterministic. */
function schedulerWith(m: SystemMetrics, opts: { onAnnounce?: (l: string) => void } = {}) {
  const budget = new AutoScaler({ resourceMonitor: () => m, budgetPercent: 90 });
  return new GlobalScheduler({ ...opts, resourceMonitor: () => m, budget });
}

describe('MultiRunDriver', () => {
  const dirs: string[] = [];
  function freshRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'multi-run-driver-'));
    setupRepo(d);
    dirs.push(d);
    return d;
  }

  function specFor(name: string, files: string[], factory = fastFactory()): MultiRunSpec {
    return {
      pipeline: oneStage(name, files),
      config: CONFIG,
      cwd: freshRepo(),
      agentFactory: factory,
      label: name,
    };
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

  it('starts every slot queued and owning no Orchestrator', () => {
    const driver = new MultiRunDriver([
      specFor('A', ['a.ts']),
      specFor('B', ['b.ts']),
      specFor('C', ['c.ts']),
    ]);

    expect(driver.slots.map((s) => s.phase)).toEqual(['queued', 'queued', 'queued']);
    // The load-bearing property: a queued run has no Orchestrator, so it costs
    // no budget and can never be the thing that OOMs the box.
    expect(driver.slots.every((s) => s.orch === null)).toBe(true);
    // A stable identity exists BEFORE admission so a UI can render the row.
    expect(new Set(driver.slots.map((s) => s.runId)).size).toBe(3);
  });

  it(
    'admits ONLY the highest-priority run immediately, holding the rest queued',
    async () => {
      // A blocking agent keeps run A alive; zero headroom keeps B and C queued.
      const starved = schedulerWith(metrics(99, 0.05));
      const driver = new MultiRunDriver(
        [
          specFor('A', ['a.ts'], blockingFactory()),
          specFor('B', ['b.ts']),
          specFor('C', ['c.ts']),
        ],
        { scheduler: starved, admitCheckMs: 20, admitHysteresisChecks: 1 },
      );

      const done = driver.start();
      await new Promise((r) => setTimeout(r, 250));

      expect(driver.slots[0]!.phase).toBe('running');
      expect(driver.slots[0]!.orch).not.toBeNull();
      // This is the assertion the old TUI would have failed: it called
      // orch.start() for all three in one loop.
      expect(driver.slots[1]!.phase).toBe('queued');
      expect(driver.slots[2]!.phase).toBe('queued');
      expect(driver.slots[1]!.orch).toBeNull();

      driver.abortAll();
      await done;
      starved.stop();
    },
    30_000,
  );

  it(
    'pulls in the queued runs once there is sustained headroom, preserving order',
    async () => {
      const roomy = schedulerWith(metrics(20, 200));
      const phases: string[] = [];
      const driver = new MultiRunDriver(
        [specFor('A', ['a.ts']), specFor('B', ['b.ts']), specFor('C', ['c.ts'])],
        {
          scheduler: roomy,
          admitCheckMs: 20,
          admitHysteresisChecks: 1,
          onSlotsChange: (slots) => phases.push(slots.map((s) => s.phase).join(',')),
        },
      );

      const slots = await driver.start();
      roomy.stop();

      expect(slots.map((s) => s.phase)).toEqual(['done', 'done', 'done']);
      expect(slots.map((s) => s.label)).toEqual(['A', 'B', 'C']);
      for (const s of slots) {
        expect(s.result!.integration.branchesMerged).toHaveLength(1);
      }
      // Admission was observable, and A was never preceded by B or C.
      expect(phases[0]).toBe('running,queued,queued');
    },
    60_000,
  );

  it(
    'each spec runs in its OWN cwd — N projects, not N pipelines in one repo',
    async () => {
      const roomy = schedulerWith(metrics(20, 200));
      const a = specFor('A', ['a.ts']);
      const b = specFor('B', ['b.ts']);
      expect(a.cwd).not.toBe(b.cwd);

      const driver = new MultiRunDriver([a, b], {
        scheduler: roomy,
        admitCheckMs: 20,
        admitHysteresisChecks: 1,
      });
      const slots = await driver.start();
      roomy.stop();

      expect(slots.map((s) => s.phase)).toEqual(['done', 'done']);
      expect(slots[0]!.cwd).toBe(a.cwd);
      expect(slots[1]!.cwd).toBe(b.cwd);
      // Each run merged into its own repo's integration branch.
      expect(slots[0]!.result!.integration.branchesMerged).toHaveLength(1);
      expect(slots[1]!.result!.integration.branchesMerged).toHaveLength(1);
    },
    60_000,
  );

  it(
    'aborting marks never-admitted runs as error without ever building them',
    async () => {
      const starved = schedulerWith(metrics(99, 0.05));
      const driver = new MultiRunDriver(
        [specFor('A', ['a.ts'], blockingFactory()), specFor('B', ['b.ts'])],
        { scheduler: starved, admitCheckMs: 20, admitHysteresisChecks: 1 },
      );

      const done = driver.start();
      await new Promise((r) => setTimeout(r, 150));
      driver.abortAll();
      const slots = await done;
      starved.stop();

      expect(slots[1]!.phase).toBe('error');
      expect(slots[1]!.error).toBe('aborted before admission');
      expect(slots[1]!.orch).toBeNull();
    },
    30_000,
  );

  it('exposes the live Orchestrator only for admitted slots', async () => {
    const starved = schedulerWith(metrics(99, 0.05));
    const driver = new MultiRunDriver(
      [specFor('A', ['a.ts'], blockingFactory()), specFor('B', ['b.ts'])],
      { scheduler: starved, admitCheckMs: 20, admitHysteresisChecks: 1 },
    );

    const done = driver.start();
    await new Promise((r) => setTimeout(r, 150));

    // retryTask/finish reach the run through this; a queued slot has nothing.
    expect(driver.orchestratorAt(0)).not.toBeNull();
    expect(driver.orchestratorAt(1)).toBeNull();
    expect(driver.orchestratorAt(99)).toBeNull();

    driver.abortAll();
    await done;
    starved.stop();
  }, 30_000);

  it('an empty spec list settles immediately without touching the scheduler', async () => {
    const driver = new MultiRunDriver([]);
    await expect(driver.start()).resolves.toEqual([]);
  });
});
