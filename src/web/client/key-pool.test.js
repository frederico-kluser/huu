import { describe, expect, it } from 'vitest';
import { coolingUntilLabel, keyStateChip, poolNeedsReset, poolRows } from './key-pool.js';

// The ⚙ key list renders one chip per pooled key from a payload that NEVER
// carries the key's value. These pin the derivation, which is the only logic
// in that panel that can be wrong without a browser noticing.

describe('coolingUntilLabel', () => {
  it('formats a local HH:MM, zero-padded', () => {
    // Built from LOCAL components so the expectation holds in any timezone.
    const until = new Date(2026, 6, 28, 9, 5).toISOString();
    expect(coolingUntilLabel(until)).toBe('09:05');
  });

  it('formats a 24h afternoon time', () => {
    expect(coolingUntilLabel(new Date(2026, 6, 28, 23, 59).toISOString())).toBe('23:59');
  });

  it('returns empty for missing or unparseable stamps instead of "Invalid Date"', () => {
    expect(coolingUntilLabel(undefined)).toBe('');
    expect(coolingUntilLabel('')).toBe('');
    expect(coolingUntilLabel('not a date')).toBe('');
  });
});

describe('keyStateChip', () => {
  it('active → green', () => {
    expect(keyStateChip({ state: 'active' })).toEqual({ cls: 'ok', text: 'active' });
  });

  it('cooling → amber, with the wake-up time when it is known', () => {
    const until = new Date(2026, 6, 28, 12, 3).toISOString();
    expect(keyStateChip({ state: 'cooling', until })).toEqual({
      cls: 'warn',
      text: 'cooling until 12:03',
    });
    expect(keyStateChip({ state: 'cooling' })).toEqual({ cls: 'warn', text: 'cooling' });
  });

  it('burned → red, carrying the reason the server gave', () => {
    expect(keyStateChip({ state: 'burned', reason: '401' })).toEqual({ cls: 'bad', text: 'burned 401' });
    expect(keyStateChip({ state: 'burned' })).toEqual({ cls: 'bad', text: 'burned' });
  });

  it('never renders an unknown state as healthy', () => {
    expect(keyStateChip({ state: 'quarantined' })).toEqual({ cls: 'warn', text: 'quarantined' });
    expect(keyStateChip({})).toEqual({ cls: 'warn', text: 'unknown' });
    expect(keyStateChip(undefined)).toEqual({ cls: 'warn', text: 'unknown' });
  });
});

describe('poolNeedsReset', () => {
  it('is false for an all-active pool and for an absent one', () => {
    expect(poolNeedsReset({ keys: [{ state: 'active' }, { state: 'active' }] })).toBe(false);
    expect(poolNeedsReset(null)).toBe(false);
    expect(poolNeedsReset({})).toBe(false);
  });

  it('is true as soon as one key is out of rotation', () => {
    expect(poolNeedsReset({ keys: [{ state: 'active' }, { state: 'burned' }] })).toBe(true);
    expect(poolNeedsReset({ keys: [{ state: 'cooling' }] })).toBe(true);
  });
});

describe('poolRows', () => {
  it('marks the key currently in rotation', () => {
    const rows = poolRows({
      current: 1,
      keys: [
        { index: 0, masked: 'sk-or…aaaa', state: 'burned', reason: '401' },
        { index: 1, masked: 'sk-or…bbbb', state: 'active' },
      ],
    });
    expect(rows.map((r) => r.isCurrent)).toEqual([false, true]);
    expect(rows[0].chip).toEqual({ cls: 'bad', text: 'burned 401' });
    expect(rows[1].masked).toBe('sk-or…bbbb');
  });

  it('falls back to the array position when the server omits an index', () => {
    const rows = poolRows({ current: 0, keys: [{ masked: 'a' }, { masked: 'b' }] });
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
    expect(rows[0].isCurrent).toBe(true);
  });

  it('renders a placeholder rather than "undefined" for a maskless entry', () => {
    expect(poolRows({ keys: [{ index: 0, state: 'active' }] })[0].masked).toBe('—');
  });

  it('yields [] for an absent or malformed payload so the list can just hide', () => {
    expect(poolRows(null)).toEqual([]);
    expect(poolRows({})).toEqual([]);
    expect(poolRows({ keys: 'nope' })).toEqual([]);
  });

  it('marks nothing current when the server sends no cursor', () => {
    expect(poolRows({ keys: [{ index: 0, state: 'active' }] }).every((r) => !r.isCurrent)).toBe(true);
  });
});
