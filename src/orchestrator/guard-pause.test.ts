/**
 * guard-pause.test.ts — Smoke tests for guard-pause module (M7-02).
 * Full behavior is covered by orchestrator.test.ts, requeue.test.ts,
 * multi-run-priority.test.ts, etc.
 */
import { describe, it, expect } from 'vitest';
import {
  destroyAgent,
  pauseAgent,
  executeTaskPool,
  spawnAndRun,
  getDemand,
  activeAgentAges,
  abandonReview,
  spawnStats,
  trackReservedAgent,
  announceAgentExit,
  consumePreemptMarker,
} from './guard-pause.js';

describe('guard-pause module', () => {
  it('exports all guard/pause functions', () => {
    expect(typeof destroyAgent).toBe('function');
    expect(typeof pauseAgent).toBe('function');
    expect(typeof executeTaskPool).toBe('function');
    expect(typeof spawnAndRun).toBe('function');
    expect(typeof getDemand).toBe('function');
    expect(typeof activeAgentAges).toBe('function');
    expect(typeof abandonReview).toBe('function');
    expect(typeof spawnStats).toBe('function');
    expect(typeof trackReservedAgent).toBe('function');
    expect(typeof announceAgentExit).toBe('function');
    expect(typeof consumePreemptMarker).toBe('function');
  });
});
