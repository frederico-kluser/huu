import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RESOLVER_TIMEOUT_MS,
  TimeoutError,
  resolveResolverTimeoutMs,
  withTimeout,
} from './with-timeout.js';

describe('withTimeout', () => {
  it('passes a value through when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it('propagates the original rejection, not a timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('rejects with TimeoutError past the deadline', async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise(() => {}), 5000, 'conflict resolver');
      const assertion = expect(pending).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the operation in the message so logs are actionable', async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise(() => {}), 100, 'conflict resolver');
      const assertion = expect(pending).rejects.toThrow(/conflict resolver timed out after 100ms/);
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  // The orchestrator branches on this to set `errorKind: 'timeout'`, which is
  // what surfaces an amber TIMEOUT card and the longer interactive retry.
  it('carries the structural marker the orchestrator branches on', () => {
    const err = new TimeoutError('x');
    expect(err.isTimeout).toBe(true);
    expect(err.name).toBe('TimeoutError');
    expect(err instanceof Error).toBe(true);
  });

  it('clears its timer so a resolved race does not hold the loop open', async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await withTimeout(Promise.resolve('ok'), 60_000);
      expect(clear).toHaveBeenCalled();
    } finally {
      clear.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('resolveResolverTimeoutMs', () => {
  it('defaults to the generous ceiling', () => {
    expect(resolveResolverTimeoutMs({})).toBe(DEFAULT_RESOLVER_TIMEOUT_MS);
  });

  it('honors a positive override', () => {
    expect(resolveResolverTimeoutMs({ HUU_RESOLVER_TIMEOUT_MS: '90000' })).toBe(90_000);
  });

  it('ignores junk rather than disabling the bound', () => {
    for (const raw of ['0', '-1', 'abc', '']) {
      expect(resolveResolverTimeoutMs({ HUU_RESOLVER_TIMEOUT_MS: raw })).toBe(
        DEFAULT_RESOLVER_TIMEOUT_MS,
      );
    }
  });
});
