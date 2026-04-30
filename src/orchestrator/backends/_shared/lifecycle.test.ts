import { describe, it, expect, vi } from 'vitest';
import { createDisposableState } from './lifecycle.js';

describe('createDisposableState', () => {
  it('starts not-disposed', () => {
    const state = createDisposableState([]);
    expect(state.isDisposed()).toBe(false);
    expect(() => state.assertLive()).not.toThrow();
  });

  it('runs cleanups in order on first dispose', async () => {
    const calls: string[] = [];
    const state = createDisposableState([
      () => calls.push('a'),
      () => calls.push('b'),
      async () => calls.push('c'),
    ]);
    await state.dispose();
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(state.isDisposed()).toBe(true);
  });

  it('is idempotent — second dispose is a no-op', async () => {
    const fn = vi.fn();
    const state = createDisposableState([fn]);
    await state.dispose();
    await state.dispose();
    await state.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('swallows cleanup errors and continues', async () => {
    const calls: string[] = [];
    const state = createDisposableState([
      () => {
        calls.push('a');
        throw new Error('boom');
      },
      () => calls.push('b'),
    ]);
    await state.dispose();
    expect(calls).toEqual(['a', 'b']);
  });

  it('assertLive throws after dispose', async () => {
    const state = createDisposableState([]);
    await state.dispose();
    expect(() => state.assertLive()).toThrow(/already disposed/);
  });
});
