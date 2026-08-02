/**
 * finalize.test.ts — Smoke tests for finalize module (M7-02).
 * Full behavior is covered by orchestrator.test.ts and finalize-truth.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  finalizeAgent,
  commitAgentWork,
  branchAhead,
  branchChangedFiles,
  recordWriteSetViolations,
} from './finalize.js';

describe('finalize module', () => {
  it('exports all finalize functions', () => {
    expect(typeof finalizeAgent).toBe('function');
    expect(typeof commitAgentWork).toBe('function');
    expect(typeof branchAhead).toBe('function');
    expect(typeof branchChangedFiles).toBe('function');
    expect(typeof recordWriteSetViolations).toBe('function');
  });
});
