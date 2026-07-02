import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SystemMetrics } from '../lib/resource-monitor.js';
import { AutoScaler } from './auto-scaler.js';

function makeMetrics(partial: Partial<SystemMetrics> = {}): SystemMetrics {
  const ramTotalBytes = partial.ramTotalBytes ?? 16 * 1024 ** 3;
  const ramUsedBytes = partial.ramUsedBytes ?? 8 * 1024 ** 3;
  return {
    cpuPercent: 50,
    ramPercent: 50,
    ramUsedBytes,
    ramTotalBytes,
    ramAvailableBytes: Math.max(0, ramTotalBytes - ramUsedBytes),
    processRssBytes: 123456789,
    loadAvg1: 1.5,
    containerAware: false,
    memPressureSome10: null,
    memPressureFull10: null,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    swapInPagesPerSec: null,
    ...partial,
  };
}

describe('AutoScaler', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createScaler(metrics: SystemMetrics, overrides: Partial<ConstructorParameters<typeof AutoScaler>[0]> = {}) {
    return new AutoScaler({
      resourceMonitor: () => metrics,
      // Tests pin their own dial so the hand-computed budget math in the
      // assertions is insulated from the PRODUCT default (85 → 70 already
      // happened once). resolveRamPercent()/DEFAULT_RAM_PERCENT have their
      // own tests in budget.test.ts.
      budgetPercent: 85,
      ...overrides,
    });
  }

  describe('constructor', () => {
    it('uses defaults when optional config values are omitted', () => {
      const scaler = createScaler(makeMetrics());
      expect(scaler.getStatus()).toMatchObject({
        enabled: false,
        state: 'NORMAL',
        cooldownRemainingMs: 0,
        cpuPercent: 50,
        ramPercent: 50,
      });
    });
  });

  describe('start / stop', () => {
    it('starts polling metrics on start()', () => {
      const scaler = createScaler(makeMetrics());
      scaler.start();
      expect(scaler.getStatus().enabled).toBe(true);
      scaler.stop();
    });

    it('stops polling and resets state on stop()', () => {
      const scaler = createScaler(makeMetrics());
      scaler.start();
      scaler.stop();
      expect(scaler.getStatus().enabled).toBe(false);
      expect(scaler.getStatus().state).toBe('NORMAL');
    });

    it('clears intervals so stop() is idempotent', () => {
      const scaler = createScaler(makeMetrics());
      scaler.start();
      scaler.stop();
      scaler.stop();
      expect(scaler.getStatus().enabled).toBe(false);
    });
  });

  describe('shouldSpawn — happy path', () => {
    it('returns true when resources are well below thresholds', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 50 }));
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(true);
      scaler.stop();
    });
  });

  describe('shouldSpawn — stop threshold (OR logic)', () => {
    it('returns false when CPU >= stopThreshold', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 92, ramPercent: 50 }));
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(false);
      expect(scaler.getStatus().state).toBe('BACKING_OFF');
      scaler.stop();
    });

    it('returns false when RAM >= stopThreshold', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 92 }));
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(false);
      expect(scaler.getStatus().state).toBe('BACKING_OFF');
      scaler.stop();
    });

    it('returns false when both CPU and RAM >= stopThreshold', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 95, ramPercent: 95 }));
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(false);
      scaler.stop();
    });
  });

  describe('shouldDestroy — destroy threshold (OR logic)', () => {
    it('returns false when no active agents', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 96, ramPercent: 50 }));
      scaler.start();
      expect(scaler.shouldDestroy()).toBe(false);
      scaler.stop();
    });

    it('returns true when CPU >= destroyThreshold and active agents exist', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 96, ramPercent: 50 }));
      scaler.start();
      scaler.notifyAgentSpawned();
      expect(scaler.shouldDestroy()).toBe(true);
      expect(scaler.getStatus().state).toBe('DESTROYING');
      scaler.stop();
    });

    it('returns true when RAM >= destroyThreshold and active agents exist', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 96 }));
      scaler.start();
      scaler.notifyAgentSpawned();
      expect(scaler.shouldDestroy()).toBe(true);
      expect(scaler.getStatus().state).toBe('DESTROYING');
      scaler.stop();
    });

    it('returns true when both CPU and RAM >= destroyThreshold', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 98, ramPercent: 98 }));
      scaler.start();
      scaler.notifyAgentSpawned();
      expect(scaler.shouldDestroy()).toBe(true);
      scaler.stop();
    });
  });

  describe('cooldown', () => {
    it('returns false from shouldSpawn during active cooldown', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 50 }));
      scaler.start();
      scaler.notifyAgentCompleted();
      scaler.notifyAgentDestroyed();
      expect(scaler.getStatus().state).toBe('COOLDOWN');
      expect(scaler.shouldSpawn()).toBe(false);
      scaler.stop();
    });

    it('allows spawn after cooldown expires', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 50 }));
      scaler.start();
      scaler.notifyAgentCompleted();
      scaler.notifyAgentDestroyed();
      expect(scaler.shouldSpawn()).toBe(false);

      vi.advanceTimersByTime(31_000);
      expect(scaler.getStatus().state).toBe('NORMAL');
      expect(scaler.shouldSpawn()).toBe(true);
      scaler.stop();
    });

    it('resets cooldown timer on repeated destruction', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 50 }));
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentCompleted();
      scaler.notifyAgentDestroyed();
      expect(scaler.getStatus().state).toBe('COOLDOWN');

      // Advance 20s — still in cooldown (20s < 30s)
      vi.advanceTimersByTime(20_000);
      expect(scaler.getStatus().state).toBe('COOLDOWN');

      // Second destroy resets the cooldown timer
      scaler.notifyAgentDestroyed();
      expect(scaler.getStatus().state).toBe('COOLDOWN');

      // If timer was NOT reset, 10 more seconds (total 30s) would end cooldown.
      // With reset, still COOLDOWN (only 10s elapsed of the new 30s timer).
      vi.advanceTimersByTime(10_000);
      expect(scaler.getStatus().state).toBe('COOLDOWN');

      // Advance past the reset cooldown
      vi.advanceTimersByTime(25_000);
      expect(scaler.getStatus().state).toBe('NORMAL');
      scaler.stop();
    });

    it('shouldDestroy can still return true during cooldown if resources >= destroyThreshold', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 96, ramPercent: 50 }));
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentCompleted();
      scaler.notifyAgentDestroyed();
      expect(scaler.getStatus().state).toBe('COOLDOWN');
      expect(scaler.shouldDestroy()).toBe(true);
      scaler.stop();
    });
  });

  describe('recovery', () => {
    it('transitions from BACKING_OFF to NORMAL when resources drop below threshold', () => {
      const metricsRef = { current: makeMetrics({ cpuPercent: 92, ramPercent: 50 }) };
      const scaler = new AutoScaler({
        resourceMonitor: () => metricsRef.current,
      });
      scaler.start();
      expect(scaler.getStatus().state).toBe('BACKING_OFF');

      metricsRef.current = makeMetrics({ cpuPercent: 80, ramPercent: 50 });
      vi.advanceTimersByTime(1_000);
      expect(scaler.getStatus().state).toBe('NORMAL');
      scaler.stop();
    });
  });

  describe('targetConcurrency — RAM budget (% dial)', () => {
    // 16 GiB total, 8 GiB used, budget 85% → budget = min(13.6, 15.5) = 13.6 GiB
    // → headroom = 13.6 − 8 = 5.6 GiB → floor(5.6 GiB / 250 MiB) = 22.
    it('admits floor(budget headroom / observedAgentBytes) on top of active agents', () => {
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 16 * 1024 ** 3, ramUsedBytes: 8 * 1024 ** 3 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      expect(scaler.targetConcurrency()).toBe(22);
      scaler.stop();
    });

    it('adds the budget admission on top of currently active agents', () => {
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 16 * 1024 ** 3, ramUsedBytes: 8 * 1024 ** 3 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();
      expect(scaler.targetConcurrency()).toBe(24);
      scaler.stop();
    });

    it('clamps to maxAgents when headroom admits more', () => {
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 64 * 1024 ** 3, ramUsedBytes: 0 }),
        { agentMemoryEstimateMb: 250, maxAgents: 50 },
      );
      scaler.start();
      expect(scaler.targetConcurrency()).toBe(50);
      scaler.stop();
    });

    it('caps at active + pendingTaskCount when work is queued', () => {
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 16 * 1024 ** 3, ramUsedBytes: 8 * 1024 ** 3 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      scaler.notifyTaskQueued(10);
      expect(scaler.targetConcurrency()).toBe(10);
      scaler.stop();
    });

    it('clamps to minimum of 1 when no headroom remains', () => {
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 128 * 1024 ** 2, ramUsedBytes: 100 * 1024 ** 2 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      expect(scaler.targetConcurrency()).toBe(1);
      scaler.stop();
    });

    it('keeps the OS-reserve floor on small machines', () => {
      // 2 GiB total, 0 used, budget 85% → byPercent 1.7 GiB but the OS-reserve
      // ceiling (total − 512 MiB) = 1.5 GiB wins → headroom = 1.5 GiB →
      // floor(1536 / 250) = 6.
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 2 * 1024 ** 3, ramUsedBytes: 0 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      expect(scaler.targetConcurrency()).toBe(6);
      scaler.stop();
    });
  });

  describe('PSI admission brake (shouldSpawn)', () => {
    it('freezes admission at/above the cut band (2x setpoint = 1.0, controller on)', () => {
      const scaler = createScaler(
        makeMetrics({ cpuPercent: 10, ramPercent: 10, memPressureSome10: 1.0 }),
      );
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(false);
      scaler.stop();
    });

    it('admits AT the setpoint (controller operates there; no hard freeze below the cut band)', () => {
      // 0.5 is the controller setpoint — the hard freeze sits at the cut band
      // (1.0), so the controller can run the machine AT ~0.5 without the binary
      // gate fighting it (that is the point of the closed loop).
      const scaler = createScaler(
        makeMetrics({ cpuPercent: 10, ramPercent: 10, memPressureSome10: 0.5 }),
      );
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(true);
      scaler.stop();
    });

    it('falls back to the RAM gate when PSI is unavailable (null)', () => {
      const ok = createScaler(
        makeMetrics({ cpuPercent: 10, ramPercent: 10, memPressureSome10: null }),
      );
      ok.start();
      expect(ok.shouldSpawn()).toBe(true);
      ok.stop();

      const blocked = createScaler(
        makeMetrics({ cpuPercent: 10, ramPercent: 95, memPressureSome10: null }),
      );
      blocked.start();
      expect(blocked.shouldSpawn()).toBe(false);
      blocked.stop();
    });

    it('does NOT PSI-gate manual mode (user-pinned pool)', () => {
      const scaler = createScaler(
        makeMetrics({ cpuPercent: 10, ramPercent: 10, memPressureSome10: 5 }),
      );
      scaler.setMode('manual');
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(true);
      scaler.stop();
    });
  });

  describe('PSI controller (closed-loop, Fase 2.2)', () => {
    const GiB = 1024 ** 3;
    // Big machine so the budget ceiling = maxAgents (200): isolates the controller.
    const big = (psi: number | null) =>
      makeMetrics({
        ramTotalBytes: 256 * GiB,
        ramUsedBytes: 16 * GiB,
        cpuPercent: 10,
        ramPercent: 10,
        memPressureSome10: psi,
      });

    it('cuts the limit ×0.5 when PSI crosses the cut band (2× setpoint = 1.0)', () => {
      const m = { current: big(0) };
      const scaler = new AutoScaler({ resourceMonitor: () => m.current, agentMemoryEstimateMb: 250 });
      scaler.start(); // first poll seeds controlledLimit to the budget ceiling (200)
      expect(scaler.getStatus().controlledLimit).toBe(200);
      m.current = big(2.0); // pressure above the cut band
      vi.advanceTimersByTime(1000); // one poll → multiplicative decrease
      expect(scaler.getStatus().controlledLimit).toBe(100);
      scaler.stop();
    });

    it('re-ramps additively under low PSI after a cut (bounded by the ceiling)', () => {
      const m = { current: big(2.0) };
      const scaler = new AutoScaler({ resourceMonitor: () => m.current, agentMemoryEstimateMb: 250 });
      scaler.start(); // seed 200 then cut to 100 on the same poll (PSI 2.0)
      expect(scaler.getStatus().controlledLimit).toBe(100);
      m.current = big(0); // pressure gone
      vi.advanceTimersByTime(8000); // past the 5s hold → several additive increases
      const limit = scaler.getStatus().controlledLimit!;
      expect(limit).toBeGreaterThan(100); // re-ramped
      expect(limit).toBeLessThanOrEqual(200); // never above the RAM-budget ceiling
      scaler.stop();
    });

    it('holds in the hysteresis band (setpoint ≤ PSI < cut band)', () => {
      const m = { current: big(2.0) };
      const scaler = new AutoScaler({ resourceMonitor: () => m.current, agentMemoryEstimateMb: 250 });
      scaler.start(); // → cut to 100
      m.current = big(0.7); // between setpoint (0.5) and cut band (1.0)
      vi.advanceTimersByTime(8000);
      expect(scaler.getStatus().controlledLimit).toBe(100); // neither grows nor cuts
      scaler.stop();
    });

    it('never exceeds the RAM budget ceiling even under sustained zero PSI', () => {
      // 16 GiB, seed 250 → budget ceiling ≈ 22; the controller cannot ramp past it.
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 16 * GiB, ramUsedBytes: 8 * GiB, memPressureSome10: 0 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      vi.advanceTimersByTime(30000);
      expect(scaler.getStatus().controlledLimit).toBeLessThanOrEqual(22);
      scaler.stop();
    });

    it('PSI null → open-loop: controlledLimit tracks the live budget ceiling', () => {
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 16 * GiB, ramUsedBytes: 8 * GiB, memPressureSome10: null }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      // budget headroom = 22; open-loop limit == Fase 1 budget target.
      expect(scaler.getStatus().controlledLimit).toBe(22);
      expect(scaler.targetConcurrency()).toBe(22);
      scaler.stop();
    });

    it('controllerEnabled:false → open-loop even with PSI present', () => {
      const m = { current: big(0) }; // PSI 0 would otherwise ramp
      const scaler = new AutoScaler({
        resourceMonitor: () => m.current,
        agentMemoryEstimateMb: 250,
        controllerEnabled: false,
      });
      scaler.start();
      vi.advanceTimersByTime(8000);
      // No closed loop: limit stays at the budget ceiling (200), not driven by PSI.
      expect(scaler.getStatus().controlledLimit).toBe(200);
      scaler.stop();
    });
  });

  describe('observed agent memory (EMA)', () => {
    it('seeds the estimate from agentMemoryEstimateMb', () => {
      const scaler = createScaler(makeMetrics(), { agentMemoryEstimateMb: 250 });
      expect(scaler.observedAgentMemoryMb()).toBe(250);
    });

    it('defaults the seed to the pessimistic 1536 MiB', () => {
      const scaler = createScaler(makeMetrics());
      expect(scaler.observedAgentMemoryMb()).toBe(1536);
    });

    it('converges toward (used − baseline) / activeAgents (explicit alpha = legacy symmetric)', () => {
      const metricsRef = { current: makeMetrics({ ramUsedBytes: 4 * 1024 ** 3 }) };
      const scaler = new AutoScaler({
        resourceMonitor: () => metricsRef.current,
        agentMemoryEstimateMb: 250,
        emaAlpha: 0.2,
      });
      scaler.start(); // baseline re-captured at 4 GiB (0 active agents)
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();

      // Two agents push usage up by 1 GiB → sample = 512 MiB/agent.
      metricsRef.current = makeMetrics({ ramUsedBytes: 5 * 1024 ** 3 });
      vi.advanceTimersByTime(1_000);

      // EMA: 0.2 × 512 + 0.8 × 250 = 302.4 MiB
      expect(scaler.observedAgentMemoryMb()).toBe(302);
      scaler.stop();
    });

    it('tracks UP fast and DOWN slowly when no alpha is pinned (asymmetric default)', () => {
      const metricsRef = { current: makeMetrics({ ramUsedBytes: 4 * 1024 ** 3 }) };
      const scaler = new AutoScaler({
        resourceMonitor: () => metricsRef.current,
        agentMemoryEstimateMb: 250,
      });
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();

      // Sample ABOVE the estimate → fast alpha 0.5: 0.5×512 + 0.5×250 = 381.
      metricsRef.current = makeMetrics({ ramUsedBytes: 5 * 1024 ** 3 });
      vi.advanceTimersByTime(1_000);
      expect(scaler.observedAgentMemoryMb()).toBe(381);

      // Sample BELOW the estimate → slow alpha 0.05: 0.05×128 + 0.95×381 ≈ 368.
      metricsRef.current = makeMetrics({ ramUsedBytes: 4 * 1024 ** 3 + 256 * 1024 ** 2 });
      vi.advanceTimersByTime(1_000);
      expect(scaler.observedAgentMemoryMb()).toBe(368);
      scaler.stop();
    });

    it('never samples while spawns are in flight or agents are young (mature-cohort gate)', () => {
      const metricsRef = { current: makeMetrics({ ramUsedBytes: 4 * 1024 ** 3 }) };
      const scaler = new AutoScaler({
        resourceMonitor: () => metricsRef.current,
        agentMemoryEstimateMb: 250,
      });
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.syncReservations(1, 1); // one spawn in flight, one young agent

      metricsRef.current = makeMetrics({ ramUsedBytes: 5 * 1024 ** 3 });
      vi.advanceTimersByTime(2_000);
      // Young cohort → the cheap-looking sample is DISCARDED, estimate holds.
      expect(scaler.observedAgentMemoryMb()).toBe(250);

      scaler.syncReservations(0, 0); // cohort matured
      vi.advanceTimersByTime(1_000);
      expect(scaler.observedAgentMemoryMb()).toBeGreaterThan(250);
      scaler.stop();
    });

    it('clamps the estimate to maxAgentMemoryMb (default raised to 4096)', () => {
      const metricsRef = { current: makeMetrics({ ramUsedBytes: 4 * 1024 ** 3 }) };
      const scaler = new AutoScaler({
        resourceMonitor: () => metricsRef.current,
        emaAlpha: 1,
      });
      scaler.start();
      scaler.notifyAgentSpawned();

      metricsRef.current = makeMetrics({
        ramTotalBytes: 200 * 1024 ** 3,
        ramUsedBytes: 104 * 1024 ** 3, // +100 GiB over baseline for 1 agent
      });
      vi.advanceTimersByTime(1_000);

      expect(scaler.observedAgentMemoryMb()).toBe(4096);
      scaler.stop();
    });

    it('ignores negative samples and re-baselines when the pool drains', () => {
      const metricsRef = { current: makeMetrics({ ramUsedBytes: 6 * 1024 ** 3 }) };
      const scaler = new AutoScaler({
        resourceMonitor: () => metricsRef.current,
        agentMemoryEstimateMb: 250,
        emaAlpha: 0.2,
      });
      scaler.start();
      scaler.notifyAgentSpawned();

      // Usage DROPS below baseline — sample is negative, estimate unchanged.
      metricsRef.current = makeMetrics({ ramUsedBytes: 5 * 1024 ** 3 });
      vi.advanceTimersByTime(1_000);
      expect(scaler.observedAgentMemoryMb()).toBe(250);

      // Pool drains → baseline re-captured at the new (lower) usage.
      scaler.notifyAgentCompleted();
      vi.advanceTimersByTime(1_000);
      scaler.notifyAgentSpawned();
      metricsRef.current = makeMetrics({ ramUsedBytes: 5 * 1024 ** 3 + 500 * 1024 ** 2 });
      vi.advanceTimersByTime(1_000);

      // EMA: 0.2 × 500 + 0.8 × 250 = 300 MiB
      expect(scaler.observedAgentMemoryMb()).toBe(300);
      scaler.stop();
    });
  });

  describe('reservation accounting (budget charge for spawning/young agents)', () => {
    it('subtracts in-flight spawn + young-agent reservations from budget headroom', () => {
      // 16 GiB total, 4 GiB used, dial 85% → budget ≈ 13.6 GiB, headroom ≈ 9.6 GiB.
      // Seed 1024 MiB → 9 more agents with no reservations.
      const m = makeMetrics({ ramTotalBytes: 16 * 1024 ** 3, ramUsedBytes: 4 * 1024 ** 3 });
      const scaler = createScaler(m, { agentMemoryEstimateMb: 1024 });
      scaler.setMode('auto');
      scaler.start();
      scaler.syncCounts(0, 100);
      expect(scaler.targetConcurrency()).toBe(9);

      // 4 spawns in flight + 4 young agents → reserve 4×1 GiB + 4×0.5 GiB = 6 GiB
      // → headroom ≈ 3.6 GiB → 3 additional.
      scaler.syncReservations(4, 4);
      expect(scaler.targetConcurrency()).toBe(3);
      scaler.stop();
    });
  });

  describe('manual mode (guard-only)', () => {
    it('does not gate spawning below the destroy threshold', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 92, ramPercent: 92 }));
      scaler.setMode('manual');
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(true);
      scaler.stop();
    });

    it('blocks spawning at the destroy threshold', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 96 }));
      scaler.setMode('manual');
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(false);
      scaler.stop();
    });

    it('still destroys at the destroy threshold (always-on memory guard)', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 96 }));
      scaler.setMode('manual');
      scaler.start();
      scaler.notifyAgentSpawned();
      expect(scaler.shouldDestroy()).toBe(true);
      scaler.stop();
    });

    it('reports mode and enabled=false while manual', () => {
      const scaler = createScaler(makeMetrics());
      scaler.setMode('manual');
      scaler.start();
      const status = scaler.getStatus();
      expect(status.mode).toBe('manual');
      expect(status.enabled).toBe(false);
      scaler.stop();
    });
  });

  describe('greedy mode (MAX) — flood to the limit', () => {
    it('targets one agent per queued task, ignoring memory headroom', () => {
      // 128 MiB total / 100 MiB used: auto would admit only 1 (no headroom),
      // but greedy floods straight to the queue depth.
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 128 * 1024 ** 2, ramUsedBytes: 100 * 1024 ** 2 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.setMode('greedy');
      scaler.start();
      scaler.notifyTaskQueued(10);
      expect(scaler.targetConcurrency()).toBe(10);
      scaler.stop();
    });

    it('caps the target at active + pending (never over-provisions idle slots)', () => {
      const scaler = createScaler(makeMetrics(), { agentMemoryEstimateMb: 250 });
      scaler.setMode('greedy');
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();
      scaler.notifyTaskQueued(5);
      expect(scaler.targetConcurrency()).toBe(7); // min(active 2 + pending 5, maxAgents)
      scaler.stop();
    });

    it('clamps the flood to maxAgents', () => {
      const scaler = createScaler(makeMetrics(), { maxAgents: 8 });
      scaler.setMode('greedy');
      scaler.start();
      scaler.notifyTaskQueued(100);
      expect(scaler.targetConcurrency()).toBe(8);
      scaler.stop();
    });

    it('spawns above the stop threshold (where auto would back off)', () => {
      // 92% is ≥ the stop threshold (auto stops) but < the destroy threshold.
      // ramUsedBytes stays at the default 8 GiB of 16 (under the dial), so the
      // budget-greedy byte gate keeps the tap open.
      const scaler = createScaler(makeMetrics({ cpuPercent: 92, ramPercent: 92 }));
      scaler.setMode('greedy');
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(true);
      scaler.stop();
    });

    it('BUDGET-greedy: stops spawning once used bytes cross the dial, even below 95%', () => {
      // 14 GiB used of 16 (87.5% < 95) but the 85% dial = 13.6 GiB → no
      // headroom. Old MAX flooded to the 95% destroy line; the dial is now a
      // contract in every mode.
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 16 * 1024 ** 3, ramUsedBytes: 14 * 1024 ** 3, ramPercent: 87.5 }),
      );
      scaler.setMode('greedy');
      scaler.start();
      expect(scaler.shouldSpawn()).toBe(false);
      scaler.stop();
    });

    it('stops spawning at the destroy threshold (RAM or CPU)', () => {
      const ramHot = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 96 }));
      ramHot.setMode('greedy');
      ramHot.start();
      expect(ramHot.shouldSpawn()).toBe(false);
      ramHot.stop();

      const cpuHot = createScaler(makeMetrics({ cpuPercent: 96, ramPercent: 50 }));
      cpuHot.setMode('greedy');
      cpuHot.start();
      expect(cpuHot.shouldSpawn()).toBe(false);
      cpuHot.stop();
    });

    it('is cooldown-damped: no respawn while cooling down from a guard kill', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 50 }));
      scaler.setMode('greedy');
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentDestroyed();
      expect(scaler.getStatus().state).toBe('COOLDOWN');
      expect(scaler.shouldSpawn()).toBe(false);

      // Floods again only once the cooldown expires.
      vi.advanceTimersByTime(31_000);
      expect(scaler.getStatus().state).toBe('NORMAL');
      expect(scaler.shouldSpawn()).toBe(true);
      scaler.stop();
    });

    it('keeps the always-on memory guard (destroys the newest at the threshold)', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 96 }));
      scaler.setMode('greedy');
      scaler.start();
      scaler.notifyAgentSpawned();
      expect(scaler.shouldDestroy()).toBe(true);
      scaler.stop();
    });

    it('reports mode=greedy and enabled=false', () => {
      const scaler = createScaler(makeMetrics());
      scaler.setMode('greedy');
      scaler.start();
      const status = scaler.getStatus();
      expect(status.mode).toBe('greedy');
      expect(status.enabled).toBe(false);
      scaler.stop();
    });
  });

  describe('guard kill count', () => {
    it('increments on every notifyAgentDestroyed', () => {
      const scaler = createScaler(makeMetrics());
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentDestroyed();
      scaler.notifyAgentDestroyed();
      expect(scaler.getStatus().guardKillCount).toBe(2);
      scaler.stop();
    });
  });

  describe('notifyAgentCompleted / notifyAgentDestroyed', () => {
    it('decrements active count on notifyAgentCompleted', () => {
      const scaler = createScaler(makeMetrics());
      scaler.start();
      scaler.notifyAgentCompleted();
      scaler.notifyAgentCompleted();
      expect(scaler.shouldDestroy()).toBe(false); // no threshold breach
      scaler.stop();
    });

    it('tracks active agents for shouldDestroy', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 96 }));
      scaler.start();
      expect(scaler.shouldDestroy()).toBe(false); // no active agents
      scaler.notifyAgentSpawned();
      expect(scaler.shouldDestroy()).toBe(true);
      scaler.stop();
    });
  });

  describe('notifyTaskQueued', () => {
    it('updates internal pending count', () => {
      const scaler = createScaler(makeMetrics({ ramTotalBytes: 16 * 1024 ** 3 }), {
        agentMemoryEstimateMb: 250,
      });
      scaler.start();
      expect(scaler.targetConcurrency()).toBe(22);
      scaler.stop();
    });

    it('uses latest queued count', () => {
      const scaler = createScaler(makeMetrics({ ramTotalBytes: 16 * 1024 ** 3 }), {
        agentMemoryEstimateMb: 250,
      });
      scaler.start();
      scaler.notifyTaskQueued(10);
      expect(scaler.targetConcurrency()).toBe(10);
      scaler.stop();
    });
  });

  describe('syncCounts (global-scheduler budget driver)', () => {
    it('overwrites active + pending counts and bounds targetConcurrency by pending', () => {
      const scaler = createScaler(makeMetrics({ ramTotalBytes: 16 * 1024 ** 3 }));
      scaler.start();
      // 16 GiB total, 8 GiB used, budget 85%, seed 1536 MiB → ~3 budget slots.
      scaler.syncCounts(0, 3);
      expect(scaler.targetConcurrency()).toBe(3);
      // active=5, pending=10 → ceiling 15, but the budget (active 5 + 3) caps to 8.
      scaler.syncCounts(5, 10);
      expect(scaler.targetConcurrency()).toBe(8);
      scaler.stop();
    });

    it('clamps negative counts to zero', () => {
      const scaler = createScaler(makeMetrics({ ramTotalBytes: 16 * 1024 ** 3 }));
      scaler.syncCounts(-4, -7);
      // pending 0 → ceiling is maxAgents; never below 1.
      expect(scaler.targetConcurrency()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('acceptMetrics (dormant per-run display)', () => {
    it('injects metrics surfaced by getStatus without polling', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 10, ramPercent: 10 }));
      // Never started → dormant; acceptMetrics still updates the displayed snapshot.
      scaler.acceptMetrics(makeMetrics({ cpuPercent: 99, ramPercent: 88 }));
      const status = scaler.getStatus();
      expect(status.cpuPercent).toBe(99);
      expect(status.ramPercent).toBe(88);
      // Dormant scaler never gates: shouldDestroy stays false even at high RAM.
      expect(scaler.shouldDestroy()).toBe(false);
    });
  });

  describe('headroomCapacity (admission signal)', () => {
    it('returns RAM-based capacity, independent of the demand/pending ceiling', () => {
      const scaler = createScaler(makeMetrics({ ramTotalBytes: 16 * 1024 ** 3 }));
      scaler.syncCounts(0, 2); // pending 2 → targetConcurrency caps at 2...
      expect(scaler.targetConcurrency()).toBe(2);
      // ...but capacity reflects the RAM budget only: ~3 slots (seed 1536 MiB).
      expect(scaler.headroomCapacity()).toBe(3);
    });
  });

  describe('getStatus', () => {
    it('reflects current metrics', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 75, ramPercent: 60 }));
      scaler.start();
      const status = scaler.getStatus();
      expect(status.cpuPercent).toBe(75);
      expect(status.ramPercent).toBe(60);
      expect(status.enabled).toBe(true);
      scaler.stop();
    });

    it('reports cooldown remaining during cooldown', () => {
      const scaler = createScaler(makeMetrics());
      scaler.start();
      scaler.notifyAgentCompleted();
      scaler.notifyAgentDestroyed();
      const status = scaler.getStatus();
      expect(status.state).toBe('COOLDOWN');
      expect(status.cooldownRemainingMs).toBeGreaterThan(0);
      expect(status.cooldownRemainingMs).toBeLessThanOrEqual(30_000);
      scaler.stop();
    });
  });

  describe('no oscillation', () => {
    it('does not oscillate between spawn/destroy during cooldown', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 50, ramPercent: 50 }));
      scaler.start();
      scaler.notifyAgentCompleted();
      scaler.notifyAgentDestroyed();
      expect(scaler.shouldSpawn()).toBe(false);
      expect(scaler.shouldDestroy()).toBe(false);
      scaler.stop();
    });
  });

  describe('re-evaluation after destruction', () => {
    it('re-evaluates after 5s and allows destroy if still above threshold', () => {
      const scaler = createScaler(makeMetrics({ cpuPercent: 96, ramPercent: 50 }));
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentCompleted();
      scaler.notifyAgentDestroyed();
      expect(scaler.shouldDestroy()).toBe(true);

      vi.advanceTimersByTime(5_000);
      vi.setSystemTime(Date.now() + 5_000);
      expect(scaler.shouldDestroy()).toBe(true);
      scaler.stop();
    });
  });

  describe('injected memory-model config (the HUU_AGENT_MEM_* env knobs land here)', () => {
    it('honors an injected agentMemoryEstimateMb seed (status reports it before any EMA sample)', () => {
      const scaler = createScaler(makeMetrics(), { agentMemoryEstimateMb: 512 });
      expect(scaler.getStatus().observedAgentMemoryMb).toBe(512);
      expect(scaler.observedAgentMemoryMb()).toBe(512);
    });

    it('keeps the pessimistic 1536MiB default when nothing is injected', () => {
      const scaler = createScaler(makeMetrics());
      expect(scaler.getStatus().observedAgentMemoryMb).toBe(1536);
    });

    it('a faster injected emaAlpha converges the observation faster than the default', () => {
      // Two scalers see the SAME single observation: baseline 8GiB, then one
      // agent pushes usage to 9GiB → sample = 1024MiB (below the 1536 seed).
      // alpha=1 must jump straight to the sample; the 0.2 default only part-way.
      const mkDynamic = () => {
        const m = makeMetrics();
        return {
          metrics: m,
          read: () => m,
          bump: (usedGiB: number) => {
            m.ramUsedBytes = usedGiB * 1024 ** 3;
          },
        };
      };
      const fast = mkDynamic();
      const slow = mkDynamic();
      const fastScaler = new AutoScaler({ resourceMonitor: fast.read, emaAlpha: 1 });
      const slowScaler = new AutoScaler({ resourceMonitor: slow.read });
      fastScaler.start();
      slowScaler.start();
      fastScaler.notifyAgentSpawned();
      slowScaler.notifyAgentSpawned();
      fast.bump(9);
      slow.bump(9);
      vi.advanceTimersByTime(1_000); // one poll tick → one EMA sample each
      expect(fastScaler.observedAgentMemoryMb()).toBe(1024);
      const slowMb = slowScaler.observedAgentMemoryMb();
      expect(slowMb).toBeGreaterThan(1024);
      expect(slowMb).toBeLessThan(1536);
      fastScaler.stop();
      slowScaler.stop();
    });
  });
});
