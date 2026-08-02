import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAUSE_BACKOFF_BASE_MS,
  DEFAULT_PAUSE_BACKOFF_CAP_MS,
  parsePauseBackoffBaseMs,
  pauseBackoffJitterFactor,
  pauseBackoffMs,
  pauseBackoffRemainingMs,
} from './pause-backoff.js';

const BASE = 1_000;
const CAP = 8_000;

describe('pauseBackoffMs', () => {
  it('doubles per pause and caps: base×2^(pauses−1) clamped to capMs', () => {
    expect(pauseBackoffMs(1, BASE, CAP)).toBe(1_000);
    expect(pauseBackoffMs(2, BASE, CAP)).toBe(2_000);
    expect(pauseBackoffMs(3, BASE, CAP)).toBe(4_000);
    expect(pauseBackoffMs(4, BASE, CAP)).toBe(8_000);
    expect(pauseBackoffMs(5, BASE, CAP)).toBe(8_000); // capped
  });

  it('is disabled when baseMs is 0 and never overflows on huge pause counts', () => {
    expect(pauseBackoffMs(10, 0, CAP)).toBe(0);
    expect(pauseBackoffMs(0, BASE, CAP)).toBe(0);
    expect(pauseBackoffMs(10_000, BASE, CAP)).toBe(CAP); // 2^9999 must not produce Infinity/NaN
    expect(Number.isFinite(pauseBackoffMs(10_000, BASE, Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  it('a cap below base never shrinks the first window (max(base, cap))', () => {
    expect(pauseBackoffMs(1, 5_000, 1_000)).toBe(5_000);
  });
});

describe('pauseBackoffRemainingMs', () => {
  it('reports the exact remaining ms mid-window and 0 after expiry', () => {
    const card = { phase: 'paused', pauses: 2, pausedAt: 10_000 }; // window 2s
    expect(pauseBackoffRemainingMs(card, 10_500, BASE, CAP)).toBe(1_500);
    expect(pauseBackoffRemainingMs(card, 12_000, BASE, CAP)).toBe(0);
    expect(pauseBackoffRemainingMs(card, 20_000, BASE, CAP)).toBe(0);
  });

  it('returns 0 for non-paused cards, missing cards, or missing pausedAt', () => {
    expect(pauseBackoffRemainingMs(undefined, 0, BASE, CAP)).toBe(0);
    // Kill-requeues and user retries reset to `pending` — never delayed.
    expect(
      pauseBackoffRemainingMs({ phase: 'pending', pauses: 3, pausedAt: 0 }, 1, BASE, CAP),
    ).toBe(0);
    expect(pauseBackoffRemainingMs({ phase: 'paused', pauses: 1 }, 1, BASE, CAP)).toBe(0);
  });

  it('is fully disabled when baseMs is 0', () => {
    expect(
      pauseBackoffRemainingMs({ phase: 'paused', pauses: 5, pausedAt: 100 }, 101, 0, CAP),
    ).toBe(0);
  });

  it('a card with no pauses counter defaults to one window', () => {
    expect(
      pauseBackoffRemainingMs({ phase: 'paused', pausedAt: 0 }, 500, BASE, CAP),
    ).toBe(500);
  });
});

describe('parsePauseBackoffBaseMs', () => {
  it('default when unset/garbage, 0 disables, explicit value wins', () => {
    expect(parsePauseBackoffBaseMs(undefined)).toBe(DEFAULT_PAUSE_BACKOFF_BASE_MS);
    expect(parsePauseBackoffBaseMs('')).toBe(DEFAULT_PAUSE_BACKOFF_BASE_MS);
    expect(parsePauseBackoffBaseMs('garbage')).toBe(DEFAULT_PAUSE_BACKOFF_BASE_MS);
    expect(parsePauseBackoffBaseMs('-5')).toBe(DEFAULT_PAUSE_BACKOFF_BASE_MS);
    expect(parsePauseBackoffBaseMs('0')).toBe(0);
    expect(parsePauseBackoffBaseMs('250')).toBe(250);
    expect(DEFAULT_PAUSE_BACKOFF_CAP_MS).toBeGreaterThan(DEFAULT_PAUSE_BACKOFF_BASE_MS);
  });
});

describe('pauseBackoffJitterFactor (anti-herd)', () => {
  it('is deterministic, up-only, and bounded in [1, 1.5)', () => {
    for (const key of ['run-a#1#1', 'run-b#1#1', 'run-c#7#3', 'x']) {
      const f = pauseBackoffJitterFactor(key);
      expect(f).toBe(pauseBackoffJitterFactor(key)); // stable
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThan(1.5);
    }
  });

  it('different runs with the SAME agentId+pauses get different windows (the herd de-sync)', () => {
    // The incident: 8 runs each paused their "agent 1" in the same second —
    // identical id + count meant identical windows and a synchronized resume.
    const factors = new Set(
      ['run-a', 'run-b', 'run-c', 'run-d', 'run-e'].map((r) =>
        pauseBackoffJitterFactor(`${r}#1#1`),
      ),
    );
    expect(factors.size).toBeGreaterThan(1);
  });

  it('consecutive pauses of the same task decorrelate too', () => {
    expect(pauseBackoffJitterFactor('run-a#1#1')).not.toBe(pauseBackoffJitterFactor('run-a#1#2'));
  });

  it('remainingMs applies the jitter AFTER the cap (no re-sync at the cap)', () => {
    const card = { phase: 'paused', pauses: 10, pausedAt: 0 }; // window = cap
    const plain = pauseBackoffRemainingMs(card, 0, BASE, CAP);
    expect(plain).toBe(CAP);
    const jittered = pauseBackoffRemainingMs(card, 0, BASE, CAP, 'run-a#1');
    expect(jittered).toBeGreaterThanOrEqual(CAP); // up-only: window stays a floor
    expect(jittered).toBeLessThan(CAP * 1.5);
  });

  it('no jitterKey keeps the exact un-jittered window (legacy callers)', () => {
    const card = { phase: 'paused', pauses: 2, pausedAt: 10_000 };
    expect(pauseBackoffRemainingMs(card, 10_500, BASE, CAP)).toBe(1_500);
  });
});
