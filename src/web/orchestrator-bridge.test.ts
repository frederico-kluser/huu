import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateCoalescer } from './orchestrator-bridge.js';
import type { OrchestratorState } from '../lib/types.js';

function mkState(overrides: Partial<OrchestratorState> = {}): OrchestratorState {
  return {
    status: 'running',
    runId: 'r1',
    agents: [],
    logs: [],
    totalCost: 0,
    completedTasks: 0,
    totalTasks: 0,
    integrationStatus: {
      phase: 'pending',
      branchesMerged: [],
      branchesPending: [],
      conflicts: [],
    },
    stageIntegrations: [],
    checkRuns: [],
    startedAt: 0,
    elapsedMs: 0,
    concurrency: 1,
    currentStage: 0,
    totalStages: 1,
    pendingTaskCount: 0,
    activeAgentCount: 0,
    ...overrides,
  };
}

describe('StateCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces multiple pushes into a single send per tick', () => {
    const sink = vi.fn();
    const c = new StateCoalescer(125, sink);
    c.push(mkState({ completedTasks: 1 }));
    c.push(mkState({ completedTasks: 2 }));
    c.push(mkState({ completedTasks: 3 }));
    c.push(mkState({ completedTasks: 4 }));
    c.push(mkState({ completedTasks: 5 }));
    expect(sink).not.toHaveBeenCalled();
    vi.advanceTimersByTime(125);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0].completedTasks).toBe(5);
    c.dispose();
  });

  it('flush() forces an immediate emit', () => {
    const sink = vi.fn();
    const c = new StateCoalescer(125, sink);
    const s = mkState({ completedTasks: 7 });
    c.push(s);
    c.flush();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0].completedTasks).toBe(7);
    c.dispose();
  });

  it('flush() with no pending state is a no-op', () => {
    const sink = vi.fn();
    const c = new StateCoalescer(125, sink);
    c.flush();
    expect(sink).not.toHaveBeenCalled();
    c.dispose();
  });

  it('does not re-emit identical pending state on subsequent ticks', () => {
    const sink = vi.fn();
    const c = new StateCoalescer(125, sink);
    c.push(mkState({ completedTasks: 1 }));
    vi.advanceTimersByTime(125);
    vi.advanceTimersByTime(125);
    vi.advanceTimersByTime(125);
    expect(sink).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('dispose() stops the interval and drops pending state', () => {
    const sink = vi.fn();
    const c = new StateCoalescer(125, sink);
    c.push(mkState({ completedTasks: 1 }));
    c.dispose();
    vi.advanceTimersByTime(1000);
    expect(sink).not.toHaveBeenCalled();
    // Push-after-dispose is also a no-op (no resurrection).
    c.push(mkState({ completedTasks: 2 }));
    c.flush();
    expect(sink).not.toHaveBeenCalled();
  });
});
