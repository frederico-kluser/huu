import { describe, it, expect } from 'vitest';
import { GlobalScheduler, distributeBudget, type RunDriver } from './global-scheduler.js';
import { AutoScaler } from './auto-scaler.js';
import type { SystemMetrics } from '../lib/resource-monitor.js';

/**
 * Plentiful RAM by default → global budget B = min(totalDemand, maxAgents=200).
 * Sized comfortably above maxAgents × the pessimistic per-agent seed (1.5 GiB ×
 * 200 = 300 GiB) so the budget headroom never becomes the binding constraint in
 * these distribution tests.
 */
function metrics(partial: Partial<SystemMetrics> = {}): SystemMetrics {
  const ramTotalBytes = partial.ramTotalBytes ?? 512 * 1024 ** 3;
  const ramAvailableBytes = partial.ramAvailableBytes ?? 504 * 1024 ** 3;
  const ramUsedBytes = partial.ramUsedBytes ?? ramTotalBytes - ramAvailableBytes;
  return {
    cpuPercent: partial.cpuPercent ?? 20,
    ramPercent: partial.ramPercent ?? (ramUsedBytes / ramTotalBytes) * 100,
    ramUsedBytes,
    ramTotalBytes,
    ramAvailableBytes,
    processRssBytes: 1,
    loadAvg1: 0,
    containerAware: false,
    memPressureSome10: partial.memPressureSome10 ?? null,
  };
}

class StubDriver implements RunDriver {
  killed: number[] = [];
  private agents: Array<{ agentId: number; startedAt: number }>;
  constructor(
    public runId: string,
    private pending = 0,
    agents: Array<{ agentId: number; startedAt: number }> = [],
  ) {
    this.agents = agents;
  }
  setPending(n: number): void {
    this.pending = n;
  }
  getDemand(): number {
    return this.agents.length + this.pending;
  }
  activeAgentAges(): Array<{ agentId: number; startedAt: number }> {
    return [...this.agents];
  }
  async destroyAgent(agentId: number): Promise<void> {
    this.killed.push(agentId);
    this.agents = this.agents.filter((a) => a.agentId !== agentId);
  }
}

describe('distributeBudget', () => {
  it('serves highest priority first, backfills the remainder', () => {
    expect(distributeBudget([10, 10], 12)).toEqual([10, 2]);
  });

  it('a saturated top run leaves nothing for lower runs', () => {
    expect(distributeBudget([20, 5, 5], 20)).toEqual([20, 0, 0]);
  });

  it('cascades budget to a third run when the first two are idle/merging', () => {
    expect(distributeBudget([0, 0, 8], 10)).toEqual([0, 0, 8]);
  });

  it('grants each run its full demand when the budget covers everyone', () => {
    expect(distributeBudget([3, 4, 2], 100)).toEqual([3, 4, 2]);
  });

  it('returns zeros for a zero (or negative) budget', () => {
    expect(distributeBudget([5, 5], 0)).toEqual([0, 0]);
    expect(distributeBudget([5, 5], -3)).toEqual([0, 0]);
  });

  it('clamps negative demand to zero', () => {
    expect(distributeBudget([-3, 4], 10)).toEqual([0, 4]);
  });

  it('caps a single run by the per-run overflow ceiling', () => {
    expect(distributeBudget([1000], 600, 64)).toEqual([64]);
  });
});

describe('GlobalScheduler.recomputeGrants', () => {
  it('distributes by priority across registered runs (backfill)', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 150)); // priority 0
    sched.register(new StubDriver('r2', 100)); // priority 1
    sched.recomputeGrants();
    // B = min(250, 200) = 200; r1 saturates 150, r2 backfills the remaining 50.
    expect(sched.currentBudget).toBe(200);
    expect(sched.grantFor('r1')).toBe(150);
    expect(sched.grantFor('r2')).toBe(50);
  });

  it('gives a saturated top-priority run everything, lower runs drain to 0', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 220)); // wants more than the whole budget
    sched.register(new StubDriver('r2', 30));
    sched.recomputeGrants();
    expect(sched.grantFor('r1')).toBe(200); // capped at B
    expect(sched.grantFor('r2')).toBe(0); // nothing left → drains
  });

  it('register() grants immediately without an explicit recompute', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 5));
    expect(sched.grantFor('r1')).toBe(5);
  });

  it('remaining reports spare machine capacity beyond demand (admission signal)', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 3));
    sched.register(new StubDriver('r2', 4));
    sched.recomputeGrants();
    // Plentiful RAM → capacity 200, demand 7 → spare headroom for more runs.
    expect(sched.remaining).toBeGreaterThan(0);
  });

  it('remaining is 0 when demand saturates the machine', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 250)); // exceeds the maxAgents cap
    sched.recomputeGrants();
    expect(sched.remaining).toBe(0);
  });
});

describe('GlobalScheduler.selectGlobalVictim', () => {
  it('targets the lowest-priority run, its newest agent', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 0, [{ agentId: 1, startedAt: 100 }])); // priority 0
    sched.register(
      new StubDriver('r2', 0, [
        { agentId: 1, startedAt: 200 },
        { agentId: 2, startedAt: 350 },
      ]),
    ); // priority 1 (lowest)
    const v = sched.selectGlobalVictim();
    expect(v?.runId).toBe('r2');
    expect(v?.agentId).toBe(2); // newest startedAt
  });

  it('skips lower-priority runs that have no live agent', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 0, [{ agentId: 5, startedAt: 100 }]));
    sched.register(new StubDriver('r2', 0, [])); // lowest priority but idle
    const v = sched.selectGlobalVictim();
    expect(v?.runId).toBe('r1');
    expect(v?.agentId).toBe(5);
  });

  it('returns null when no run has a live agent', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 5, []));
    expect(sched.selectGlobalVictim()).toBeNull();
  });
});

describe('GlobalScheduler memory guard (tick)', () => {
  it('kills the lowest-priority newest agent at the destroy threshold', async () => {
    const high = metrics({ ramPercent: 98, ramAvailableBytes: 1 * 1024 ** 3 });
    const budget = new AutoScaler({ resourceMonitor: () => high });
    budget.setMode('auto');
    budget.start(); // enabled → shouldDestroy can fire
    const sched = new GlobalScheduler({ budget });
    const d1 = new StubDriver('r1', 0, [{ agentId: 1, startedAt: 100 }]);
    const d2 = new StubDriver('r2', 0, [
      { agentId: 1, startedAt: 200 },
      { agentId: 2, startedAt: 300 },
    ]);
    sched.register(d1);
    sched.register(d2);

    await sched.tick();

    expect(d1.killed).toEqual([]); // higher priority untouched
    expect(d2.killed).toEqual([2]); // lower priority, newest agent
    budget.stop();
  });

  it('does not kill when RAM is healthy', async () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics({ ramPercent: 40 }) });
    const d = new StubDriver('r1', 0, [{ agentId: 1, startedAt: 100 }]);
    sched.register(d);
    await sched.tick(); // budget not started → shouldDestroy false → no kill
    expect(d.killed).toEqual([]);
  });
});

describe('GlobalScheduler register / unregister', () => {
  it('assigns ascending seq (priority) in registration order', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    const h1 = sched.register(new StubDriver('r1', 5));
    const h2 = sched.register(new StubDriver('r2', 5));
    expect(h1.seq).toBeLessThan(h2.seq);
    expect(sched.size).toBe(2);
  });

  it('clears grants and shrinks on unregister, freeing budget to survivors', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 10));
    const h2 = sched.register(new StubDriver('r2', 10));
    sched.recomputeGrants();
    expect(sched.grantFor('r2')).toBeGreaterThan(0);

    sched.unregister(h2);
    expect(sched.size).toBe(1);
    expect(sched.grantFor('r2')).toBe(0);
    sched.recomputeGrants();
    expect(sched.grantFor('r1')).toBe(10);
  });
});

describe('GlobalScheduler — explicit priority (list order is authoritative)', () => {
  // The multi-run front-ends start their runs CONCURRENTLY, so the order
  // register() is called is a race (each run registers only after its own async
  // preflight). These pin that an explicit priority — the project's position in
  // the user's list — decides rank instead: the first project is always served
  // first, and the last is always the kill victim, regardless of who registered
  // first. This is the guarantee behind "pull cards from the first project on."

  it('serves the explicitly-highest-priority run first even when it registered LAST', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    // Registration order is the REVERSE of priority: the LOW-priority run
    // registers first (seq 0), the HIGH-priority run second (seq 1).
    sched.register(new StubDriver('low', 150), 5);
    sched.register(new StubDriver('high', 150), 0);
    sched.recomputeGrants();
    // B = min(300, 200) = 200. Priority 0 ('high') saturates 150; 'low' backfills
    // the remaining 50 — NOT the reverse (which a registration-order sort gives).
    expect(sched.currentBudget).toBe(200);
    expect(sched.grantFor('high')).toBe(150);
    expect(sched.grantFor('low')).toBe(50);
  });

  it('kills the explicitly-lowest-priority run first even when it registered FIRST', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    // 'lowest' registers FIRST (seq 0) but is priority 9 (lowest); 'top'
    // registers second but is priority 0 (highest).
    sched.register(new StubDriver('lowest', 0, [{ agentId: 7, startedAt: 500 }]), 9);
    sched.register(new StubDriver('top', 0, [{ agentId: 1, startedAt: 100 }]), 0);
    const v = sched.selectGlobalVictim();
    expect(v?.runId).toBe('lowest');
    expect(v?.agentId).toBe(7);
  });

  it('falls back to registration order when no explicit priority is given', () => {
    const sched = new GlobalScheduler({ resourceMonitor: () => metrics() });
    sched.register(new StubDriver('r1', 150)); // seq 0 → priority 0
    sched.register(new StubDriver('r2', 150)); // seq 1 → priority 1
    sched.recomputeGrants();
    expect(sched.grantFor('r1')).toBe(150);
    expect(sched.grantFor('r2')).toBe(50);
  });
});
