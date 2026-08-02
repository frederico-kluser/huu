/**
 * wave-driver.test.ts — Smoke tests for wave-driver module (M7-02).
 * Full behavior is covered by orchestrator.test.ts and dag-execution.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { runDagWaves } from './wave-driver.js';

describe('wave-driver module', () => {
  it('exports runDagWaves function', () => {
    expect(typeof runDagWaves).toBe('function');
  });
});
