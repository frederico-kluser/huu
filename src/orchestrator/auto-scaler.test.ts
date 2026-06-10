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

  describe('targetConcurrency — memory headroom', () => {
    // 16 GiB total, 8 GiB available: margin = max(10% of 16 GiB, 512 MiB)
    // = 1.6 GiB → headroom = 6.4 GiB → floor(6.4 GiB / 250 MiB) = 26.
    it('admits floor(headroom / observedAgentBytes) on top of active agents', () => {
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 16 * 1024 ** 3, ramUsedBytes: 8 * 1024 ** 3 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      expect(scaler.targetConcurrency()).toBe(26);
      scaler.stop();
    });

    it('adds the headroom admission on top of currently active agents', () => {
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 16 * 1024 ** 3, ramUsedBytes: 8 * 1024 ** 3 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      scaler.notifyAgentSpawned();
      scaler.notifyAgentSpawned();
      expect(scaler.targetConcurrency()).toBe(28);
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

    it('keeps at least the 512 MiB margin floor on small machines', () => {
      // 2 GiB total, fully available: percent margin would be 204 MiB but the
      // 512 MiB floor wins → headroom = 1.5 GiB → floor(1536 / 250) = 6.
      const scaler = createScaler(
        makeMetrics({ ramTotalBytes: 2 * 1024 ** 3, ramUsedBytes: 0 }),
        { agentMemoryEstimateMb: 250 },
      );
      scaler.start();
      expect(scaler.targetConcurrency()).toBe(6);
      scaler.stop();
    });
  });

  describe('observed agent memory (EMA)', () => {
    it('seeds the estimate from agentMemoryEstimateMb', () => {
      const scaler = createScaler(makeMetrics(), { agentMemoryEstimateMb: 250 });
      expect(scaler.observedAgentMemoryMb()).toBe(250);
    });

    it('converges toward (used − baseline) / activeAgents', () => {
      const metricsRef = { current: makeMetrics({ ramUsedBytes: 4 * 1024 ** 3 }) };
      const scaler = new AutoScaler({ resourceMonitor: () => metricsRef.current });
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

    it('clamps the estimate to maxAgentMemoryMb', () => {
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

      expect(scaler.observedAgentMemoryMb()).toBe(2048);
      scaler.stop();
    });

    it('ignores negative samples and re-baselines when the pool drains', () => {
      const metricsRef = { current: makeMetrics({ ramUsedBytes: 6 * 1024 ** 3 }) };
      const scaler = new AutoScaler({ resourceMonitor: () => metricsRef.current });
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
      const scaler = createScaler(makeMetrics({ ramTotalBytes: 16 * 1024 ** 3 }));
      scaler.start();
      expect(scaler.targetConcurrency()).toBe(26);
      scaler.stop();
    });

    it('uses latest queued count', () => {
      const scaler = createScaler(makeMetrics({ ramTotalBytes: 16 * 1024 ** 3 }));
      scaler.start();
      scaler.notifyTaskQueued(10);
      expect(scaler.targetConcurrency()).toBe(10);
      scaler.stop();
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
});
