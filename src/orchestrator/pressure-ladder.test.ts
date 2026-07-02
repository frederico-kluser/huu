import { describe, it, expect } from 'vitest';
import {
  PressureLadder,
  DEFAULT_PRESSURE_THRESHOLDS,
  resolveGuardThresholds,
} from './pressure-ladder.js';
import type { SystemMetrics } from '../lib/resource-monitor.js';

const GiB = 1024 ** 3;

function m(partial: Partial<SystemMetrics> = {}): SystemMetrics {
  const ramTotalBytes = partial.ramTotalBytes ?? 32 * GiB;
  const ramUsedBytes = partial.ramUsedBytes ?? 8 * GiB;
  return {
    cpuPercent: 20,
    ramPercent: (ramUsedBytes / ramTotalBytes) * 100,
    ramUsedBytes,
    ramTotalBytes,
    ramAvailableBytes: Math.max(0, ramTotalBytes - ramUsedBytes),
    processRssBytes: 1,
    loadAvg1: 0,
    containerAware: false,
    memPressureSome10: null,
    memPressureFull10: null,
    swapTotalBytes: 16 * GiB,
    swapFreeBytes: 16 * GiB,
    swapInPagesPerSec: null,
    ...partial,
  };
}

describe('PressureLadder', () => {
  const BUDGET = 16 * GiB;

  it('is healthy (L0) with usage under budget and no pressure signals', () => {
    const ladder = new PressureLadder();
    expect(ladder.evaluate(m(), BUDGET, 0).level).toBe(0);
  });

  it('L1 fires only after usage stays over the budget for the sustain window', () => {
    const ladder = new PressureLadder();
    const over = m({ ramUsedBytes: 18 * GiB });
    expect(ladder.evaluate(over, BUDGET, 0).level).toBe(0); // streak starts
    expect(ladder.evaluate(over, BUDGET, 1_000).level).toBe(0); // not sustained yet
    const v = ladder.evaluate(over, BUDGET, 3_000);
    expect(v.level).toBe(1);
    expect(v.overshootBytes).toBe(2 * GiB);
  });

  it('L1 streak resets when usage returns under the budget', () => {
    const ladder = new PressureLadder();
    const over = m({ ramUsedBytes: 18 * GiB });
    ladder.evaluate(over, BUDGET, 0);
    ladder.evaluate(m(), BUDGET, 2_000); // back under → reset
    expect(ladder.evaluate(over, BUDGET, 4_000).level).toBe(0); // streak restarted
    expect(ladder.evaluate(over, BUDGET, 7_000).level).toBe(1);
  });

  it('budgetBytes = 0 disables the L1 budget check', () => {
    const ladder = new PressureLadder();
    const over = m({ ramUsedBytes: 30 * GiB, swapFreeBytes: 12 * GiB });
    ladder.evaluate(over, 0, 0);
    expect(ladder.evaluate(over, 0, 10_000).level).toBe(0);
  });

  it('L2 fires on the earlyoom joint condition (avail AND swap-free low)', () => {
    const ladder = new PressureLadder();
    // 2 GiB available of 32 (6.2% < 10) + 1 GiB free swap of 16 (6.2% < 10).
    const v = ladder.evaluate(
      m({ ramUsedBytes: 30 * GiB, swapFreeBytes: 1 * GiB }),
      BUDGET,
      0,
    );
    expect(v.level).toBe(2);
    expect(v.reason).toContain('swap free');
  });

  it('low available RAM alone does NOT fire L2 while swap has room', () => {
    const ladder = new PressureLadder();
    // 6.2% available but 12 GiB free swap (75%) — the box still has spill room.
    const v = ladder.evaluate(
      m({ ramUsedBytes: 30 * GiB, swapFreeBytes: 12 * GiB }),
      32 * GiB, // budget above usage so L1 stays quiet
      0,
    );
    expect(v.level).toBe(0);
  });

  it('treats a no-swap host as swap-exhausted (earlyoom semantics)', () => {
    const ladder = new PressureLadder();
    const v = ladder.evaluate(
      m({ ramUsedBytes: 30 * GiB, swapTotalBytes: 0, swapFreeBytes: 0 }),
      32 * GiB,
      0,
    );
    expect(v.level).toBe(2);
  });

  it('L2 fires on PSI full past the thrash line', () => {
    const ladder = new PressureLadder();
    const v = ladder.evaluate(m({ memPressureFull10: 6 }), BUDGET, 0);
    expect(v.level).toBe(2);
    expect(v.reason).toContain('PSI full');
  });

  it('L2 fires on the legacy RAM ≥ 95% line', () => {
    const ladder = new PressureLadder();
    // 31 GiB of 32 = 96.9% but swap still has room → only the legacy line trips.
    const v = ladder.evaluate(
      m({ ramUsedBytes: 31 * GiB, swapFreeBytes: 12 * GiB }),
      32 * GiB,
      0,
    );
    expect(v.level).toBe(2);
    expect(v.reason).toContain('95');
  });

  it('L2 fires on sustained swap-in, not on a single spike', () => {
    const ladder = new PressureLadder();
    const hot = m({ swapInPagesPerSec: 5_000 });
    expect(ladder.evaluate(hot, BUDGET, 0).level).toBe(0); // spike — not sustained
    expect(ladder.evaluate(hot, BUDGET, 2_000).level).toBe(2);
  });

  it('L3 fires on the emergency floors and on PSI full emergency', () => {
    const ladder = new PressureLadder();
    // 1 GiB avail (3.1% < 5) + 0.5 GiB free swap (3.1% < 5).
    const floors = ladder.evaluate(
      m({ ramUsedBytes: 31 * GiB, swapFreeBytes: 0.5 * GiB }),
      BUDGET,
      0,
    );
    expect(floors.level).toBe(3);

    const psi = new PressureLadder().evaluate(m({ memPressureFull10: 25 }), BUDGET, 0);
    expect(psi.level).toBe(3);
    expect(psi.reason).toContain('thrashing');
  });

  it('damps L1 preemptions but never L2/L3', () => {
    const ladder = new PressureLadder();
    expect(ladder.preemptAllowed(1, 0)).toBe(true);
    ladder.notePreempt(1, 0);
    expect(ladder.preemptAllowed(1, 1_000)).toBe(false); // within the GC window
    expect(ladder.preemptAllowed(1, 2_500)).toBe(true);
    expect(ladder.preemptAllowed(2, 1)).toBe(true);
    expect(ladder.preemptAllowed(3, 1)).toBe(true);
    expect(ladder.preemptAllowed(0, 1)).toBe(false);
  });
});

describe('resolveGuardThresholds', () => {
  it('returns defaults for an empty env and never throws on garbage', () => {
    expect(resolveGuardThresholds({})).toEqual(DEFAULT_PRESSURE_THRESHOLDS);
    expect(
      resolveGuardThresholds({ HUU_GUARD_AVAIL_PCT: 'garbage', HUU_GUARD_PSI_FULL_HIGH: '' }),
    ).toEqual(DEFAULT_PRESSURE_THRESHOLDS);
  });

  it('parses and clamps HUU_GUARD_* overrides', () => {
    const t = resolveGuardThresholds({
      HUU_GUARD_AVAIL_PCT: '15',
      HUU_GUARD_PSI_FULL_HIGH: '2.5',
      HUU_GUARD_OVER_BUDGET_MS: '10000',
      HUU_GUARD_DESTROY_PCT: '1', // below clamp floor 50
    });
    expect(t.availPct).toBe(15);
    expect(t.psiFullHigh).toBe(2.5);
    expect(t.overBudgetSustainMs).toBe(10_000);
    expect(t.destroyPercent).toBe(50);
  });
});

describe('PressureLadder — review regressions', () => {
  const BUDGET = 16 * GiB;

  it('UNKNOWN swap (null) never collapses the joint condition (macOS false-L2)', () => {
    const ladder = new PressureLadder();
    // 9% available with swap metrics UNAVAILABLE — a warmed-up Mac's normal
    // state. Must stay healthy (legacy behavior: guard only at ≥95%).
    const v = ladder.evaluate(
      m({
        ramUsedBytes: 29.2 * GiB,
        swapTotalBytes: null,
        swapFreeBytes: null,
      }),
      32 * GiB,
      0,
    );
    expect(v.level).toBe(0);
  });

  it('pure CPU saturation is damped L1 (kind cpu), never the L2 drain-to-zero', () => {
    const ladder = new PressureLadder();
    const v = ladder.evaluate(m({ cpuPercent: 97 }), BUDGET, 0);
    expect(v.level).toBe(1);
    expect(v.kind).toBe('cpu');
    // Damped like budget-L1: one preemption per repreempt window.
    expect(ladder.preemptAllowed(1, 0)).toBe(true);
    ladder.notePreempt(1, 0);
    expect(ladder.preemptAllowed(1, 1_000)).toBe(false);
  });

  it('RAM ≥ 95% alone still escalates to L2 (host kind)', () => {
    const ladder = new PressureLadder();
    const v = ladder.evaluate(
      m({ ramUsedBytes: 31 * GiB, swapFreeBytes: 12 * GiB }),
      32 * GiB,
      0,
    );
    expect(v.level).toBe(2);
    expect(v.kind).toBe('host');
  });

  it('budget-L1 carries kind budget', () => {
    const ladder = new PressureLadder();
    const over = m({ ramUsedBytes: 18 * GiB });
    ladder.evaluate(over, BUDGET, 0);
    const v = ladder.evaluate(over, BUDGET, 3_000);
    expect(v.level).toBe(1);
    expect(v.kind).toBe('budget');
  });
});
