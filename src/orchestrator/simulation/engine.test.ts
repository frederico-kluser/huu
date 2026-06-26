import { describe, it, expect } from 'vitest';
import { SimulationEngine, sampleScenarioDeck, type SimulationOptions } from './engine.js';
import type { OrchestratorState } from '../../lib/types.js';

/**
 * Drive an engine to completion by calling `advance()` directly (no timers,
 * no `start()`), collecting an assertion callback after every tick. Returns
 * the final state. Caps iterations so a regression can't hang the suite.
 */
function runToDone(
  engine: SimulationEngine,
  onTick?: (s: OrchestratorState) => void,
  max = 20000,
): OrchestratorState {
  let i = 0;
  while (engine.getState().status !== 'done' && i < max) {
    engine.advance();
    if (onTick) onTick(engine.getState());
    i++;
  }
  const state = engine.getState();
  expect(state.status).toBe('done');
  return state;
}

function makeEngine(overrides: Partial<SimulationOptions> = {}): SimulationEngine {
  return new SimulationEngine({
    runId: 'sim-test',
    modelIds: ['openrouter/test-model'],
    fileCount: 10,
    concurrency: 4,
    seed: 42,
    tickMs: 100,
    ...overrides,
  });
}

describe('sampleScenarioDeck', () => {
  const rng = () => 0.5; // stable

  it('returns exactly n entries', () => {
    expect(sampleScenarioDeck(1, rng)).toHaveLength(1);
    expect(sampleScenarioDeck(7, rng)).toHaveLength(7);
    expect(sampleScenarioDeck(25, rng)).toHaveLength(25);
  });

  it('guarantees every special scenario is drawn once the file count affords it', () => {
    const deck = sampleScenarioDeck(12, rng);
    expect(deck).toContain('no_changes');
    expect(deck).toContain('requeue');
    expect(deck).toContain('error_retry');
    expect(deck).toContain('error_final');
  });

  it('stays modest for tiny runs (no forced specials)', () => {
    const deck = sampleScenarioDeck(2, rng);
    expect(deck).toHaveLength(2);
    expect(deck.every((s) => s === 'happy' || s === 'heavy')).toBe(true);
  });
});

describe('SimulationEngine', () => {
  it('drives the run to completion with every task terminal', () => {
    const engine = makeEngine();
    const state = runToDone(engine);
    expect(state.totalTasks).toBeGreaterThan(0);
    expect(state.completedTasks).toBe(state.totalTasks);
    expect(state.pendingTaskCount).toBe(0);
    expect(state.activeAgentCount).toBe(0);
    // Every agent card lands in a terminal phase.
    for (const a of state.agents) {
      expect(['done', 'no_changes', 'error']).toContain(a.phase);
    }
  });

  it('never exceeds the chosen concurrency while running', () => {
    const concurrency = 3;
    const engine = makeEngine({ fileCount: 14, concurrency });
    let maxActive = 0;
    runToDone(engine, (s) => {
      maxActive = Math.max(maxActive, s.activeAgentCount);
      expect(s.activeAgentCount).toBeLessThanOrEqual(concurrency);
    });
    // Sanity: the board actually got busy (not a trivially-idle run).
    expect(maxActive).toBeGreaterThan(1);
  });

  it('samples all failure/edge scenarios into the kanban', () => {
    const engine = makeEngine({ fileCount: 12, concurrency: 5 });
    const state = runToDone(engine);
    const requeued = state.agents.filter((a) => (a.requeues ?? 0) > 0);
    const errored = state.agents.filter((a) => a.phase === 'error');
    const noChanges = state.agents.filter((a) => a.phase === 'no_changes');
    expect(requeued.length).toBeGreaterThan(0);
    expect(errored.length).toBeGreaterThan(0);
    expect(noChanges.length).toBeGreaterThan(0);
    // The memory guard "killed" at least once (drives the ↻ badge + guard count).
    expect(state.autoScale?.guardKillCount ?? 0).toBeGreaterThan(0);
  });

  it('produces stage merges and a judge check', () => {
    const state = runToDone(makeEngine());
    expect(state.stageIntegrations.length).toBeGreaterThanOrEqual(2);
    expect(state.stageIntegrations.every((m) => m.phase === 'done')).toBe(true);
    expect(state.checkRuns.length).toBeGreaterThanOrEqual(1);
    expect(state.checkRuns.every((c) => c.phase === 'done')).toBe(true);
  });

  it('can run the judge rework→approved loop (re-runs consolidate, judges again)', () => {
    // Find a seed that exercises the rework branch (probabilistic per run).
    let found: OrchestratorState | null = null;
    for (let seed = 0; seed < 200 && !found; seed++) {
      const state = runToDone(makeEngine({ seed, fileCount: 6, concurrency: 3 }));
      if (state.checkRuns.length >= 2) found = state;
    }
    expect(found).not.toBeNull();
    const checks = found!.checkRuns;
    expect(checks[0]!.outcomeLabel).toBe('rework');
    expect(checks[0]!.nextStepName).toBeTruthy();
    const last = checks[checks.length - 1]!;
    expect(last.outcomeLabel).toBe('approved');
    expect(last.runs).toBeGreaterThan(1);
  });

  it('streams an agent-output firehose during the run', () => {
    const engine = makeEngine();
    const chunks: Array<{ agentId: number; channel: string; text: string }> = [];
    engine.subscribeAgentOutput((c) => chunks.push(c));
    runToDone(engine);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.channel === 'assistant')).toBe(true);
  });

  it('freezes progress while paused and resumes', () => {
    const engine = makeEngine();
    // Warm up a few ticks so work is in flight.
    for (let i = 0; i < 20; i++) engine.advance();
    engine.setPaused(true);
    const before = engine.getState().completedTasks;
    for (let i = 0; i < 30; i++) engine.advance();
    expect(engine.getState().completedTasks).toBe(before);
    engine.setPaused(false);
    const state = runToDone(engine);
    expect(state.completedTasks).toBe(state.totalTasks);
  });

  it('is deterministic for a given seed', () => {
    const a = runToDone(makeEngine({ seed: 7 }));
    const b = runToDone(makeEngine({ seed: 7 }));
    expect(b.totalTasks).toBe(a.totalTasks);
    expect(b.completedTasks).toBe(a.completedTasks);
    expect(b.checkRuns.length).toBe(a.checkRuns.length);
    expect(b.agents.map((x) => x.phase)).toEqual(a.agents.map((x) => x.phase));
  });

  it('resolves start() and reports done via the driver contract', async () => {
    const engine = makeEngine({ fileCount: 3, concurrency: 2, tickMs: 1 });
    const result = await engine.start();
    expect(result.runId).toBe('sim-test');
    expect(result.manifest.errorReason).toBeUndefined();
    expect(engine.getState().status).toBe('done');
  });
});
