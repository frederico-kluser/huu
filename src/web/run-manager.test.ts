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
      (_runId, c) => chunks.push(c),
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

    const done = await waitFor(() => mgr.getSnapshot('sim-x').phase === 'done', 5000);
    expect(done).toBe(true);

    const final = mgr.getSnapshot('sim-x');
    expect(final.state).toBeTruthy();
    expect(final.state!.completedTasks).toBe(final.state!.totalTasks);
    expect(final.state!.totalTasks).toBeGreaterThan(0);
    expect(mgr.isActive()).toBe(false);
    // The firehose was relayed (no real LLM, but the stream is synthesized).
    expect(chunks.length).toBeGreaterThan(0);
    // Snapshots flowed through the throttle-less manager channel.
    expect(snaps.length).toBeGreaterThan(2);
  });
});

describe('WebRunManager — multi-run', () => {
  it('runs multiple simulations concurrently (no 409) and tracks each by runId', async () => {
    const mgr = new WebRunManager(process.cwd(), () => {});
    const a = mgr.startSimulation({ runId: 'sim-a', modelIds: [], fileCount: 3, concurrency: 1, tickMs: 1 });
    const b = mgr.startSimulation({ runId: 'sim-b', modelIds: [], fileCount: 3, concurrency: 1, tickMs: 1 });

    // Both accepted — no "already in progress" refusal.
    expect(a.runId).toBe('sim-a');
    expect(b.runId).toBe('sim-b');
    expect(a.phase).toBe('running');
    expect(b.phase).toBe('running');

    // Each is tracked independently, keyed by runId.
    expect(mgr.getSnapshots().map((s) => s.runId).sort()).toEqual(['sim-a', 'sim-b']);
    expect(mgr.getSnapshot('sim-a').runId).toBe('sim-a');
    expect(mgr.getSnapshot('sim-b').runId).toBe('sim-b');

    mgr.abort();
    expect(await waitFor(() => !mgr.isActive(), 3000)).toBe(true);
  });

  it('aborts one run by runId, leaving the other running', async () => {
    const mgr = new WebRunManager(process.cwd(), () => {});
    // Long sims so the survivor is still running after we kill the other.
    mgr.startSimulation({ runId: 'sim-keep', modelIds: [], fileCount: 60, concurrency: 1, tickMs: 25 });
    mgr.startSimulation({ runId: 'sim-kill', modelIds: [], fileCount: 60, concurrency: 1, tickMs: 25 });

    mgr.abort('sim-kill');
    expect(await waitFor(() => mgr.getSnapshot('sim-kill').phase !== 'running', 3000)).toBe(true);
    // The other run is untouched.
    expect(mgr.getSnapshot('sim-keep').phase).toBe('running');

    mgr.abort();
    expect(await waitFor(() => !mgr.isActive(), 3000)).toBe(true);
  });

  it('pause/abort are per-run-id and safe', async () => {
    const mgr = new WebRunManager(process.cwd(), () => {});
    mgr.startSimulation({ runId: 'sim-c', modelIds: [], fileCount: 6, concurrency: 2, tickMs: 1 });
    mgr.setPaused('sim-c', true);
    mgr.setPaused('sim-c', false);
    mgr.setPaused('sim-unknown', true); // no-op for unknown id
    mgr.abort('sim-c');
    expect(await waitFor(() => !mgr.isActive(), 2000)).toBe(true);
  });
});
