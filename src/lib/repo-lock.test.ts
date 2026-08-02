import { describe, it, expect } from 'vitest';
import { withRepoLock, repoLockIdle } from './repo-lock.js';

/** Let pending microtasks + a timer tick drain so queued sections can start. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe('withRepoLock', () => {
  it('serializes overlapping critical sections on the same repo', async () => {
    const events: string[] = [];
    let releaseA!: () => void;
    const aGate = new Promise<void>((r) => {
      releaseA = r;
    });

    const p1 = withRepoLock('/repo', async () => {
      events.push('A:enter');
      await aGate; // hold the lock open until the test releases it
      events.push('A:exit');
    });
    const p2 = withRepoLock('/repo', async () => {
      events.push('B:enter');
      events.push('B:exit');
    });

    // While A holds the lock, B must not have entered its critical section.
    await flush();
    expect(events).toEqual(['A:enter']);

    releaseA();
    await Promise.all([p1, p2]);
    expect(events).toEqual(['A:enter', 'A:exit', 'B:enter', 'B:exit']);
  });

  it('does not serialize across different repos', async () => {
    const events: string[] = [];
    let releaseA!: () => void;
    const aGate = new Promise<void>((r) => {
      releaseA = r;
    });

    const p1 = withRepoLock('/repoA', async () => {
      events.push('A:enter');
      await aGate;
      events.push('A:exit');
    });
    const p2 = withRepoLock('/repoB', async () => {
      events.push('B:ran');
    });

    // B is on a DIFFERENT repo, so it runs even while A holds /repoA's lock.
    await flush();
    expect(events).toContain('B:ran');
    expect(events).not.toContain('A:exit');

    releaseA();
    await Promise.all([p1, p2]);
  });

  it('does not let a throwing critical section poison the chain', async () => {
    await expect(
      withRepoLock('/r', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The next waiter on the same repo still runs.
    await expect(withRepoLock('/r', async () => 'ok')).resolves.toBe('ok');
  });

  it('propagates the critical section return value', async () => {
    await expect(withRepoLock('/r2', async () => 42)).resolves.toBe(42);
    await expect(withRepoLock('/r2', () => 'sync-value')).resolves.toBe('sync-value');
  });

  it('repoLockIdle resolves after queued sections drain', async () => {
    const order: string[] = [];
    void withRepoLock('/r3', async () => {
      await flush();
      order.push('section');
    });
    await repoLockIdle('/r3');
    order.push('idle');
    expect(order).toEqual(['section', 'idle']);
    // Unknown repo: resolves immediately.
    await expect(repoLockIdle('/never-locked')).resolves.toBeUndefined();
  });
});
