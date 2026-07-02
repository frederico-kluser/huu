import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RAM_PERCENT,
  MAX_RAM_PERCENT,
  MIN_OS_RESERVE_BYTES,
  MIN_RAM_PERCENT,
  clampPercent,
  osReserveBytes,
  ramBudgetBytes,
  resolveRamPercent,
} from './budget.js';

const GiB = 1024 ** 3;

describe('clampPercent', () => {
  it('passes a normal value through (rounded to int)', () => {
    expect(clampPercent(85)).toBe(85);
    expect(clampPercent(72.4)).toBe(72);
  });
  it('clamps below MIN and above MAX', () => {
    expect(clampPercent(0)).toBe(MIN_RAM_PERCENT);
    expect(clampPercent(-50)).toBe(MIN_RAM_PERCENT);
    expect(clampPercent(150)).toBe(MAX_RAM_PERCENT);
  });
  it('falls back to default on non-finite', () => {
    expect(clampPercent(NaN)).toBe(DEFAULT_RAM_PERCENT);
    expect(clampPercent(Infinity)).toBe(DEFAULT_RAM_PERCENT);
  });
});

describe('resolveRamPercent', () => {
  const saved = process.env.HUU_RAM_PERCENT;
  beforeEach(() => {
    delete process.env.HUU_RAM_PERCENT;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.HUU_RAM_PERCENT;
    else process.env.HUU_RAM_PERCENT = saved;
  });

  it('returns the default when nothing is set', () => {
    expect(resolveRamPercent()).toBe(DEFAULT_RAM_PERCENT);
  });
  it('reads HUU_RAM_PERCENT from env', () => {
    process.env.HUU_RAM_PERCENT = '70';
    expect(resolveRamPercent()).toBe(70);
  });
  it('clamps an out-of-range env value', () => {
    process.env.HUU_RAM_PERCENT = '999';
    expect(resolveRamPercent()).toBe(MAX_RAM_PERCENT);
  });
  it('ignores an empty/garbage env value (falls back to default)', () => {
    process.env.HUU_RAM_PERCENT = '';
    expect(resolveRamPercent()).toBe(DEFAULT_RAM_PERCENT);
    process.env.HUU_RAM_PERCENT = 'abc';
    expect(resolveRamPercent()).toBe(DEFAULT_RAM_PERCENT);
  });
  it('explicit value wins over env and is clamped', () => {
    process.env.HUU_RAM_PERCENT = '50';
    expect(resolveRamPercent(90)).toBe(90);
    expect(resolveRamPercent(3)).toBe(MIN_RAM_PERCENT);
  });
});

describe('ramBudgetBytes', () => {
  it('computes pct of total', () => {
    expect(ramBudgetBytes(32 * GiB, 85)).toBeCloseTo(32 * GiB * 0.85, -6);
  });
  it('never claims more than total minus the OS reserve floor', () => {
    // 95% of 1 GiB would be 0.95 GiB, but total - 512MiB = 0.5 GiB is lower.
    const total = 1 * GiB;
    expect(ramBudgetBytes(total, 95)).toBe(total - MIN_OS_RESERVE_BYTES);
  });
  it('returns 0 for non-positive/non-finite total', () => {
    expect(ramBudgetBytes(0, 85)).toBe(0);
    expect(ramBudgetBytes(-1, 85)).toBe(0);
    expect(ramBudgetBytes(NaN, 85)).toBe(0);
  });
  it('clamps the percent defensively (ceiling = total − ADAPTIVE reserve)', () => {
    const total = 32 * GiB;
    // On a 32 GiB desktop the adaptive reserve is 8% (2.56 GiB) — larger than
    // the legacy 512 MiB floor that proved far too thin for a desktop.
    expect(ramBudgetBytes(total, 999)).toBe(
      Math.min(total * (MAX_RAM_PERCENT / 100), total - osReserveBytes(total)),
    );
  });
});

describe('osReserveBytes', () => {
  const savedReserve = process.env.HUU_OS_RESERVE_MB;
  afterEach(() => {
    if (savedReserve === undefined) delete process.env.HUU_OS_RESERVE_MB;
    else process.env.HUU_OS_RESERVE_MB = savedReserve;
  });

  it('reserves max(min(2GiB, 25%), 8%, 512MiB)', () => {
    delete process.env.HUU_OS_RESERVE_MB;
    expect(osReserveBytes(32 * GiB)).toBeCloseTo(32 * GiB * 0.08, -6); // 2.56 GiB (8% wins)
    expect(osReserveBytes(16 * GiB)).toBe(2 * GiB); // 2 GiB cap wins
    expect(osReserveBytes(4 * GiB)).toBe(1 * GiB); // 25% of a small box
    expect(osReserveBytes(1 * GiB)).toBe(MIN_OS_RESERVE_BYTES); // 512 MiB floor
  });

  it('HUU_OS_RESERVE_MB overrides, capped at 90% of total', () => {
    process.env.HUU_OS_RESERVE_MB = '4096';
    expect(osReserveBytes(32 * GiB)).toBe(4096 * 1024 * 1024);
    process.env.HUU_OS_RESERVE_MB = '999999';
    expect(osReserveBytes(4 * GiB)).toBe(Math.floor(4 * GiB * 0.9));
    process.env.HUU_OS_RESERVE_MB = 'garbage';
    expect(osReserveBytes(32 * GiB)).toBeCloseTo(32 * GiB * 0.08, -6);
  });
});
