import { describe, it, expect } from 'vitest';
import type { AgentSlot } from '../../types/index.js';
import {
  HealthChecker,
  computeBackoffMs,
  updateHeartbeat,
  computeLoopDelay,
} from '../health.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeSlot(overrides: Partial<AgentSlot> = {}): AgentSlot {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    agentName: 'builder',
    startedAt: Date.now(),
    lastHeartbeat: Date.now(),
    abortController: new AbortController(),
    retryCount: 0,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('HealthChecker', () => {
  it('should report healthy when heartbeat is recent', () => {
    const checker = new HealthChecker();
    const now = Date.now();
    const slots = new Map([['run-1', makeSlot({ lastHeartbeat: now - 1000 })]]);

    const result = checker.check(slots, now);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]!.status).toBe('healthy');
    expect(result.reports[0]!.recommendation).toBe('none');
    expect(result.stuckCount).toBe(0);
    expect(result.deadCount).toBe(0);
  });

  it('should report warning when heartbeat is stale', () => {
    const checker = new HealthChecker({ warningThresholdMs: 10_000 });
    const now = Date.now();
    const slots = new Map([['run-1', makeSlot({ lastHeartbeat: now - 20_000 })]]);

    const result = checker.check(slots, now);
    expect(result.reports[0]!.status).toBe('warning');
    expect(result.reports[0]!.recommendation).toBe('steer');
  });

  it('should report stuck when heartbeat exceeds threshold', () => {
    const checker = new HealthChecker({ stuckThresholdMs: 30_000 });
    const now = Date.now();
    const slots = new Map([['run-1', makeSlot({ lastHeartbeat: now - 40_000 })]]);

    const result = checker.check(slots, now);
    expect(result.reports[0]!.status).toBe('stuck');
    expect(result.reports[0]!.recommendation).toBe('abort');
    expect(result.stuckCount).toBe(1);
  });

  it('should recommend escalate for stuck agents with max retries', () => {
    const checker = new HealthChecker({ stuckThresholdMs: 30_000, maxRetries: 2 });
    const now = Date.now();
    const slots = new Map([['run-1', makeSlot({ lastHeartbeat: now - 40_000, retryCount: 3 })]]);

    const result = checker.check(slots, now);
    expect(result.reports[0]!.recommendation).toBe('escalate');
  });

  it('should report dead when heartbeat far exceeds threshold', () => {
    const checker = new HealthChecker({ deadThresholdMs: 60_000 });
    const now = Date.now();
    const slots = new Map([['run-1', makeSlot({ lastHeartbeat: now - 120_000 })]]);

    const result = checker.check(slots, now);
    expect(result.reports[0]!.status).toBe('dead');
    expect(result.deadCount).toBe(1);
  });

  it('should handle multiple slots with different statuses', () => {
    const checker = new HealthChecker({
      warningThresholdMs: 10_000,
      stuckThresholdMs: 30_000,
      deadThresholdMs: 60_000,
    });
    const now = Date.now();
    const slots = new Map([
      ['run-1', makeSlot({ runId: 'run-1', lastHeartbeat: now - 1_000 })],
      ['run-2', makeSlot({ runId: 'run-2', lastHeartbeat: now - 20_000 })],
      ['run-3', makeSlot({ runId: 'run-3', lastHeartbeat: now - 50_000 })],
    ]);

    const result = checker.check(slots, now);
    expect(result.reports).toHaveLength(3);
    const statuses = result.reports.map((r) => r.status);
    expect(statuses).toContain('healthy');
    expect(statuses).toContain('warning');
    expect(statuses).toContain('stuck');
  });

  it('should handle empty slots', () => {
    const checker = new HealthChecker();
    const result = checker.check(new Map(), Date.now());
    expect(result.reports).toHaveLength(0);
    expect(result.stuckCount).toBe(0);
    expect(result.deadCount).toBe(0);
  });
});

describe('computeBackoffMs', () => {
  it('should return base for retry 0', () => {
    // With jitter, should be between baseMs and 2*baseMs
    const result = computeBackoffMs(0, 1000, 60_000);
    expect(result).toBeGreaterThanOrEqual(1000);
    expect(result).toBeLessThanOrEqual(2000);
  });

  it('should increase exponentially', () => {
    const r0 = computeBackoffMs(0, 1000, 60_000);
    const r3 = computeBackoffMs(3, 1000, 60_000);
    expect(r3).toBeGreaterThan(r0);
  });

  it('should cap at maxMs', () => {
    const result = computeBackoffMs(20, 1000, 10_000);
    expect(result).toBeLessThanOrEqual(10_000);
  });
});

describe('updateHeartbeat', () => {
  it('should update lastHeartbeat timestamp', () => {
    const slot = makeSlot({ lastHeartbeat: 1000 });
    updateHeartbeat(slot, 5000);
    expect(slot.lastHeartbeat).toBe(5000);
  });
});

describe('computeLoopDelay', () => {
  const config = { minDelayMs: 250, maxDelayMs: 2000, loadFactor: 0.1 };

  it('should return maxDelay when idle', () => {
    expect(computeLoopDelay(0, 5, 10, config)).toBe(2000);
  });

  it('should return value in range for active agents', () => {
    const delay = computeLoopDelay(3, 5, 10, config);
    expect(delay).toBeGreaterThanOrEqual(config.minDelayMs);
    expect(delay).toBeLessThanOrEqual(config.maxDelayMs);
  });

  it('should have shorter delay at higher load', () => {
    const lowLoad = computeLoopDelay(1, 5, 10, config);
    const highLoad = computeLoopDelay(5, 5, 10, config);
    expect(highLoad).toBeLessThanOrEqual(lowLoad);
  });
});
