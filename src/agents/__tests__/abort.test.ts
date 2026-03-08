import { describe, it, expect, afterEach } from 'vitest';
import {
  createRunAbortController,
  composeRunSignal,
  abortRun,
  cleanupRunController,
  getActiveRunIds,
} from '../abort.js';

afterEach(() => {
  // Clean up any controllers left by tests
  for (const id of getActiveRunIds()) {
    cleanupRunController(id);
  }
});

describe('createRunAbortController', () => {
  it('creates a new controller for a runId', () => {
    const controller = createRunAbortController('run-1');
    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal.aborted).toBe(false);
    cleanupRunController('run-1');
  });

  it('returns same controller for same runId', () => {
    const c1 = createRunAbortController('run-2');
    const c2 = createRunAbortController('run-2');
    expect(c1).toBe(c2);
    cleanupRunController('run-2');
  });

  it('creates new controller after previous was aborted', () => {
    const c1 = createRunAbortController('run-3');
    c1.abort();
    const c2 = createRunAbortController('run-3');
    expect(c2).not.toBe(c1);
    expect(c2.signal.aborted).toBe(false);
    cleanupRunController('run-3');
  });
});

describe('composeRunSignal', () => {
  it('returns a signal with timeout', () => {
    const signal = composeRunSignal({ timeoutMs: 60_000 });
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
  });

  it('composes with user signal', () => {
    const userController = new AbortController();
    const signal = composeRunSignal({
      userSignal: userController.signal,
      timeoutMs: 60_000,
    });
    expect(signal.aborted).toBe(false);
    userController.abort();
    expect(signal.aborted).toBe(true);
  });

  it('composes with parent signal', () => {
    const parentController = new AbortController();
    const signal = composeRunSignal({
      parentSignal: parentController.signal,
      timeoutMs: 60_000,
    });
    expect(signal.aborted).toBe(false);
    parentController.abort();
    expect(signal.aborted).toBe(true);
  });

  it('any source aborting triggers the composed signal', () => {
    const userController = new AbortController();
    const parentController = new AbortController();
    const signal = composeRunSignal({
      userSignal: userController.signal,
      parentSignal: parentController.signal,
      timeoutMs: 60_000,
    });
    expect(signal.aborted).toBe(false);
    parentController.abort('parent cancelled');
    expect(signal.aborted).toBe(true);
  });

  it('uses default timeout when not specified', () => {
    const signal = composeRunSignal({});
    expect(signal.aborted).toBe(false);
  });
});

describe('abortRun', () => {
  it('aborts an active run', () => {
    const controller = createRunAbortController('run-abort-1');
    expect(abortRun('run-abort-1')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    cleanupRunController('run-abort-1');
  });

  it('returns false for unknown runId', () => {
    expect(abortRun('nonexistent')).toBe(false);
  });

  it('returns false for already aborted run', () => {
    createRunAbortController('run-abort-2');
    abortRun('run-abort-2');
    expect(abortRun('run-abort-2')).toBe(false);
    cleanupRunController('run-abort-2');
  });
});

describe('cleanupRunController', () => {
  it('removes the controller', () => {
    createRunAbortController('run-clean-1');
    cleanupRunController('run-clean-1');
    expect(getActiveRunIds()).not.toContain('run-clean-1');
  });

  it('is idempotent', () => {
    cleanupRunController('nonexistent');
    // no throw
  });
});

describe('getActiveRunIds', () => {
  it('returns empty when no runs', () => {
    expect(getActiveRunIds()).toEqual([]);
  });

  it('returns active run IDs', () => {
    createRunAbortController('active-1');
    createRunAbortController('active-2');
    const ids = getActiveRunIds();
    expect(ids).toContain('active-1');
    expect(ids).toContain('active-2');
    cleanupRunController('active-1');
    cleanupRunController('active-2');
  });

  it('excludes aborted runs', () => {
    createRunAbortController('active-3');
    createRunAbortController('aborted-1');
    abortRun('aborted-1');
    const ids = getActiveRunIds();
    expect(ids).toContain('active-3');
    expect(ids).not.toContain('aborted-1');
    cleanupRunController('active-3');
    cleanupRunController('aborted-1');
  });
});
