import { describe, it, expect } from 'vitest';
import { WebRunManager, type RunSnapshot } from './run-manager.js';

function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (pred()) {
        clearInterval(iv);
        resolve(true);
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(iv);
        resolve(false);
      }
    }, 5);
  });
}

describe('WebRunManager — simulation', () => {
  it('drives a synthetic run to done over the same snapshot channel as a real run', async () => {
    const snaps: RunSnapshot[] = [];
    const chunks: Array<{ agentId: number }> = [];
    const mgr = new WebRunManager(
      process.cwd(),
      (s) => snaps.push(s),
      (c) => chunks.push(c),
    );

    const first = mgr.startSimulation({
      runId: 'sim-x',
      modelIds: ['openrouter/a'],
      fileCount: 4,
      concurrency: 2,
      tickMs: 1,
    });
    expect(first.phase).toBe('running');
    expect(first.pipelineName).toBeTruthy();
    expect(mgr.isActive()).toBe(true);

    const done = await waitFor(() => mgr.getSnapshot().phase === 'done', 5000);
    expect(done).toBe(true);

    const final = mgr.getSnapshot();
    expect(final.state).toBeTruthy();
    expect(final.state!.completedTasks).toBe(final.state!.totalTasks);
    expect(final.state!.totalTasks).toBeGreaterThan(0);
    expect(mgr.isActive()).toBe(false);
    // The firehose was relayed (no real LLM, but the stream is synthesized).
    expect(chunks.length).toBeGreaterThan(0);
    // Snapshots flowed through the throttle-less manager channel.
    expect(snaps.length).toBeGreaterThan(2);
  });

  it('refuses a second concurrent run (the 409 path)', () => {
    const mgr = new WebRunManager(process.cwd(), () => {});
    mgr.startSimulation({ runId: 'sim-a', modelIds: [], fileCount: 3, concurrency: 1, tickMs: 50 });
    expect(() =>
      mgr.startSimulation({ runId: 'sim-b', modelIds: [], fileCount: 3, concurrency: 1, tickMs: 50 }),
    ).toThrow(/in progress/i);
    mgr.abort();
  });

  it('pause is a no-op-safe control and abort settles the run', async () => {
    const mgr = new WebRunManager(process.cwd(), () => {});
    mgr.startSimulation({ runId: 'sim-c', modelIds: [], fileCount: 6, concurrency: 2, tickMs: 1 });
    mgr.setPaused(true);
    mgr.setPaused(false);
    mgr.abort();
    const settled = await waitFor(() => !mgr.isActive(), 2000);
    expect(settled).toBe(true);
  });
});
