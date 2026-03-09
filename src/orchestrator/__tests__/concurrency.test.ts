import { describe, it, expect } from 'vitest';
import {
  resolveConcurrencyCap,
  SchedulerQueue,
  SchedulerOverloadError,
} from '../concurrency.js';

// ── resolveConcurrencyCap ───────────────────────────────────────────

describe('resolveConcurrencyCap', () => {
  it('uses default 5 when no overrides', () => {
    const { cap } = resolveConcurrencyCap({});
    expect(cap).toBe(5);
  });

  it('uses config value when provided', () => {
    const { cap } = resolveConcurrencyCap({ configValue: 8 });
    expect(cap).toBe(8);
  });

  it('ENV overrides config', () => {
    const { cap } = resolveConcurrencyCap({ configValue: 8, envVar: '3' });
    expect(cap).toBe(3);
  });

  it('CLI overrides ENV and config', () => {
    const { cap } = resolveConcurrencyCap({
      configValue: 8,
      envVar: '3',
      cliFlag: 10,
    });
    expect(cap).toBe(10);
  });

  it('clamps to range 1..20', () => {
    expect(resolveConcurrencyCap({ cliFlag: 0 }).cap).toBe(5); // invalid → falls through
    expect(resolveConcurrencyCap({ cliFlag: 25 }).cap).toBe(20);
    expect(resolveConcurrencyCap({ cliFlag: 1 }).cap).toBe(1);
    expect(resolveConcurrencyCap({ cliFlag: 20 }).cap).toBe(20);
  });

  it('warns when cap exceeds 10', () => {
    const result = resolveConcurrencyCap({ cliFlag: 15 });
    expect(result.cap).toBe(15);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('15');
  });

  it('no warning at or below 10', () => {
    const result = resolveConcurrencyCap({ cliFlag: 10 });
    expect(result.warning).toBeUndefined();
  });

  it('ignores invalid ENV values', () => {
    const { cap } = resolveConcurrencyCap({ envVar: 'not-a-number' });
    expect(cap).toBe(5);
  });
});

// ── SchedulerQueue ──────────────────────────────────────────────────

describe('SchedulerQueue', () => {
  it('limits concurrency to maxConcurrentAgents', async () => {
    const queue = new SchedulerQueue({ maxConcurrentAgents: 2 });
    let maxRunning = 0;
    let currentRunning = 0;

    const makeTask = () => async () => {
      currentRunning++;
      maxRunning = Math.max(maxRunning, currentRunning);
      await new Promise((r) => setTimeout(r, 50));
      currentRunning--;
    };

    const promises = Array.from({ length: 10 }, () =>
      queue.add(makeTask()),
    );

    await Promise.all(promises);

    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(queue.stats.totalCompleted).toBe(10);
  });

  it('defaults to 5 concurrent', () => {
    const queue = new SchedulerQueue();
    expect(queue.stats.maxConcurrent).toBe(5);
  });

  it('respects priority ordering (higher first)', async () => {
    const queue = new SchedulerQueue({ maxConcurrentAgents: 1 });
    const order: string[] = [];

    // First task occupies the slot
    const blocker = queue.add(
      async () => { await new Promise((r) => setTimeout(r, 100)); },
      { priority: 0 },
    );

    // Queue tasks with different priorities while blocker runs
    await new Promise((r) => setTimeout(r, 10));
    const lowP = queue.add(
      async () => { order.push('low'); },
      { priority: 1 },
    );
    const highP = queue.add(
      async () => { order.push('high'); },
      { priority: 10 },
    );
    const midP = queue.add(
      async () => { order.push('mid'); },
      { priority: 5 },
    );

    await Promise.all([blocker, highP, midP, lowP]);

    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('activates backpressure when overloaded', async () => {
    const queue = new SchedulerQueue({
      maxConcurrentAgents: 1,
      maxPendingTasks: 2,
    });

    // Fill up the queue
    const tasks: Promise<void>[] = [];
    tasks.push(
      queue.add(async () => {
        await new Promise((r) => setTimeout(r, 200));
      }),
    );

    await new Promise((r) => setTimeout(r, 10));

    // Add 2 pending (at limit)
    tasks.push(queue.add(async () => {}));
    tasks.push(queue.add(async () => {}));

    // This should be rejected (backpressure)
    await expect(queue.add(async () => {})).rejects.toThrow(
      SchedulerOverloadError,
    );

    await Promise.all(tasks);
    expect(queue.stats.totalRejected).toBeGreaterThanOrEqual(1);
  });

  it('supports AbortSignal cancellation', async () => {
    const queue = new SchedulerQueue({ maxConcurrentAgents: 1 });

    // Fill the slot
    const blocker = queue.add(
      async () => { await new Promise((r) => setTimeout(r, 200)); },
    );

    await new Promise((r) => setTimeout(r, 10));

    const controller = new AbortController();
    const abortedTask = queue.add(async () => {}, {
      signal: controller.signal,
    });

    // Abort while pending
    controller.abort();

    await expect(abortedTask).rejects.toThrow('aborted');
    await blocker;
  });

  it('drain rejects pending and waits for running', async () => {
    const queue = new SchedulerQueue({ maxConcurrentAgents: 1 });
    let taskRan = false;

    const running = queue.add(async () => {
      await new Promise((r) => setTimeout(r, 100));
      taskRan = true;
    });

    await new Promise((r) => setTimeout(r, 10));

    const pending = queue.add(async () => {});

    const drainPromise = queue.drain();

    await expect(pending).rejects.toThrow('drained');
    await drainPromise;
    expect(taskRan).toBe(true);
  });

  it('rejects new tasks during drain', async () => {
    const queue = new SchedulerQueue({ maxConcurrentAgents: 1 });

    queue.add(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    await new Promise((r) => setTimeout(r, 10));

    // Start drain
    const drainPromise = queue.drain();

    // Try to add during drain
    await expect(queue.add(async () => {})).rejects.toThrow('draining');

    await drainPromise;
  });

  it('provides accurate stats', async () => {
    const queue = new SchedulerQueue({ maxConcurrentAgents: 2, maxPendingTasks: 10 });

    expect(queue.stats.running).toBe(0);
    expect(queue.stats.pending).toBe(0);
    expect(queue.stats.isSaturated).toBe(false);

    const tasks = Array.from({ length: 5 }, () =>
      queue.add(async () => {
        await new Promise((r) => setTimeout(r, 50));
      }),
    );

    // Give time for execution to start
    await new Promise((r) => setTimeout(r, 10));

    expect(queue.stats.running).toBe(2);
    expect(queue.stats.pending).toBe(3);
    expect(queue.isSaturated).toBe(true);

    await Promise.all(tasks);

    // Allow microtask queue to flush (finally() handler)
    await new Promise((r) => setTimeout(r, 10));

    expect(queue.stats.totalCompleted).toBe(5);
    expect(queue.runningCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  it('clearPending removes all pending without affecting running', async () => {
    const queue = new SchedulerQueue({ maxConcurrentAgents: 1 });

    const running = queue.add(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    await new Promise((r) => setTimeout(r, 10));

    const p1 = queue.add(async () => {}).catch(() => {});
    const p2 = queue.add(async () => {}).catch(() => {});

    const cleared = queue.clearPending();
    expect(cleared).toBe(2);
    expect(queue.pendingCount).toBe(0);

    await running;
    await p1;
    await p2;
  });

  it('never exceeds cap even with 20 simultaneous tasks', async () => {
    const cap = 5;
    const queue = new SchedulerQueue({ maxConcurrentAgents: cap });
    let maxRunning = 0;
    let currentRunning = 0;

    const promises = Array.from({ length: 20 }, () =>
      queue.add(async () => {
        currentRunning++;
        maxRunning = Math.max(maxRunning, currentRunning);
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
        currentRunning--;
      }),
    );

    await Promise.all(promises);

    expect(maxRunning).toBeLessThanOrEqual(cap);
    expect(queue.stats.totalCompleted).toBe(20);
  });
});
