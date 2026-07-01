import { describe, it, expect, afterEach } from 'vitest';
import {
  isErrorStorm,
  errorSignature,
  setResilient,
  isResilient,
  type ErrEntry,
  type StormConfig,
} from './crash-guard.js';

const STORM: StormConfig = { windowMs: 10_000, distinctMax: 15, totalMax: 500 };
const mk = (specs: Array<[number, string]>): ErrEntry[] => specs.map(([t, sig]) => ({ t, sig }));

describe('isErrorStorm', () => {
  it('is not a storm for a handful of errors', () => {
    expect(isErrorStorm(mk([[0, 'a'], [100, 'b'], [200, 'c']]), 300, STORM)).toBe(false);
  });

  it('bails on many DISTINCT signatures in the window (broad cascade ⇒ corrupted state)', () => {
    const e = mk(Array.from({ length: 15 }, (_, i) => [i * 10, `sig${i}`] as [number, string]));
    expect(isErrorStorm(e, 200, STORM)).toBe(true);
    expect(isErrorStorm(e.slice(0, 14), 200, STORM)).toBe(false); // 14 distinct → not yet
  });

  it('bails on an extreme TOTAL rate (CPU-pinning loop) even with ONE signature', () => {
    const e = mk(Array.from({ length: 500 }, (_, i) => [i, 'same'] as [number, string]));
    expect(isErrorStorm(e, 600, STORM)).toBe(true);
  });

  it('SURVIVES one benign error repeating at a moderate rate (the pi-animations case)', () => {
    // 120 hits of the SAME signature over 10s (~12/s) — under totalMax, 1 distinct.
    const e = mk(Array.from({ length: 120 }, (_, i) => [i * 80, 'pi-animations-stale-ctx'] as [number, string]));
    expect(isErrorStorm(e, 120 * 80, STORM)).toBe(false);
  });

  it('ignores entries older than the window', () => {
    const old = mk(Array.from({ length: 30 }, (_, i) => [i, `old${i}`] as [number, string]));
    expect(isErrorStorm(old, 50_000, STORM)).toBe(false); // all > 10s ago
  });
});

describe('errorSignature', () => {
  it('starts with name:message and separates distinct errors', () => {
    const a = new Error('boom');
    const b = new Error('bang');
    expect(errorSignature(a).startsWith('Error:boom')).toBe(true);
    expect(errorSignature(a)).not.toBe(errorSignature(b));
  });
  it('is identical for the SAME thrown error object (so repeats dedupe)', () => {
    const a = new Error('same');
    expect(errorSignature(a)).toBe(errorSignature(a));
  });
  it('handles non-Error throwables', () => {
    expect(errorSignature('just a string')).toBe('just a string');
    expect(errorSignature({ x: 1 })).toContain('object');
  });
});

describe('setResilient / isResilient', () => {
  afterEach(() => setResilient(false));
  it('toggles the survive-mode flag', () => {
    expect(isResilient()).toBe(false);
    setResilient(true);
    expect(isResilient()).toBe(true);
  });
});
