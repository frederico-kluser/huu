/**
 * orch-consts.test.ts — Tests for shared orchestrator constants (M7-02).
 */
import { describe, it, expect } from 'vitest';
import {
  POLL_INTERVAL_MS,
  PRESSURE_POLL_INTERVAL_MS,
  computeCardTimeoutMs,
  unionPaths,
} from './orch-consts.js';

describe('orch-consts', () => {
  it('exports poll intervals as positive numbers', () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThan(0);
    expect(PRESSURE_POLL_INTERVAL_MS).toBeGreaterThan(0);
    expect(PRESSURE_POLL_INTERVAL_MS).toBeLessThan(POLL_INTERVAL_MS);
  });

  it('computeCardTimeoutMs returns default for multi-file task', () => {
    const task = { files: ['a.ts', 'b.ts'], agentId: 1, stageIndex: 0, stageName: 'test' } as any;
    const pipeline = {} as any;
    expect(computeCardTimeoutMs(task, pipeline)).toBeGreaterThan(0);
  });

  it('computeCardTimeoutMs returns single-file timeout for one file', () => {
    const task = { files: ['a.ts'], agentId: 1, stageIndex: 0, stageName: 'test' } as any;
    const pipeline = {} as any;
    expect(computeCardTimeoutMs(task, pipeline)).toBeGreaterThan(0);
  });

  it('unionPaths deduplicates and preserves order', () => {
    expect(unionPaths(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(unionPaths(undefined, ['a'])).toEqual(['a']);
    expect(unionPaths([], ['a'])).toEqual(['a']);
  });
});
