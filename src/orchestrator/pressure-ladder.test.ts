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
    hostMemTotalBytes: null,
    hostMemAvailableBytes: null,
    containerSwapUsedBytes: null,
    containerSwapTotalBytes: null,
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

describe('PressureLadder — host-aware scoping (G) + container swap spill (D)', () => {
  const BUDGET = 16 * GiB;

  it('L2 fires when the HOST is tight even though the container looks roomy', () => {
    const ladder = new PressureLadder();
    // Container: 50% used of its cgroup — comfortable. Host: 6% available
    // with swap nearly gone — the earlyoom pair, host-scoped.
    const v = ladder.evaluate(
      m({
        ramTotalBytes: 14 * GiB,
        ramUsedBytes: 7 * GiB,
        containerAware: true,
        hostMemTotalBytes: 16 * GiB,
        hostMemAvailableBytes: 0.96 * GiB, // 6%
        swapTotalBytes: 16 * GiB,
        swapFreeBytes: 0.96 * GiB, // 6%
      }),
      BUDGET,
    );
    expect(v.level).toBe(2);
    expect(v.kind).toBe('host');
    expect(v.reason).toContain('host avail');
  });

  it('L3 fires on the emergency floors when the HOST side is the tight one', () => {
    const ladder = new PressureLadder();
    const v = ladder.evaluate(
      m({
        ramTotalBytes: 14 * GiB,
        ramUsedBytes: 7 * GiB,
        containerAware: true,
        hostMemTotalBytes: 16 * GiB,
        hostMemAvailableBytes: 0.48 * GiB, // 3%
        swapTotalBytes: 16 * GiB,
        swapFreeBytes: 0.48 * GiB, // 3%
      }),
      BUDGET,
    );
    expect(v.level).toBe(3);
    expect(v.reason).toContain('host avail');
  });

  it('a roomy host never TIGHTENS the container-scoped condition (min, not replace)', () => {
    const ladder = new PressureLadder();
    // Container avail 6% + swap-free 6% would fire L2 on its own; the host
    // being at 50% avail must not mask it.
    const v = ladder.evaluate(
      m({
        ramTotalBytes: 32 * GiB,
        ramUsedBytes: 30 * GiB,
        containerAware: true,
        hostMemTotalBytes: 32 * GiB,
        hostMemAvailableBytes: 16 * GiB,
        swapTotalBytes: 16 * GiB,
        swapFreeBytes: 0.96 * GiB,
      }),
      BUDGET,
    );
    expect(v.level).toBe(2);
    expect(v.reason).toContain('avail');
    expect(v.reason).not.toContain('host avail');
  });

  it('L2 fires when the container spills into its swap allowance (RAM% plateau)', () => {
    const ladder = new PressureLadder();
    // Container RAM comfortably under every RAM threshold, host swap plentiful
    // — but 60% of the container's own --memory-swap allowance is in use.
    const v = ladder.evaluate(
      m({
        ramTotalBytes: 14 * GiB,
        ramUsedBytes: 7 * GiB,
        containerAware: true,
        containerSwapUsedBytes: 2.4 * GiB,
        containerSwapTotalBytes: 4 * GiB, // 60% ≥ the 50% default
        swapTotalBytes: 16 * GiB,
        swapFreeBytes: 16 * GiB,
      }),
      BUDGET,
    );
    expect(v.level).toBe(2);
    expect(v.kind).toBe('host');
    expect(v.reason).toContain('container swap');
  });

  it('an unlimited (null) container swap ceiling never fires the spill arm', () => {
    const ladder = new PressureLadder();
    const v = ladder.evaluate(
      m({
        containerAware: true,
        containerSwapUsedBytes: 100 * GiB,
        containerSwapTotalBytes: null,
      }),
      BUDGET,
    );
    expect(v.level).toBe(0);
  });

  it('HUU_GUARD_CONTAINER_SWAP_PCT tunes the spill threshold', () => {
    const t = resolveGuardThresholds({ HUU_GUARD_CONTAINER_SWAP_PCT: '80' });
    expect(t.containerSwapUsedPct).toBe(80);
    const ladder = new PressureLadder(t);
    const at60 = ladder.evaluate(
      m({
        containerAware: true,
        containerSwapUsedBytes: 2.4 * GiB,
        containerSwapTotalBytes: 4 * GiB, // 60% < 80
      }),
      BUDGET,
    );
    expect(at60.level).toBe(0);
  });
});

describe('PressureLadder — post-storm calm hold (spawnHold)', () => {
  const BUDGET = 16 * GiB;
  const storm = () =>
    m({ ramUsedBytes: 31 * GiB, ramTotalBytes: 32 * GiB, ramPercent: 96.9, swapFreeBytes: 12 * GiB });

  it('holds spawns during an L2 storm and for reopenCalmMs after it clears', () => {
    const ladder = new PressureLadder(
      resolveGuardThresholds({ HUU_GUARD_REOPEN_CALM_MS: '10000' }),
    );
    expect(ladder.spawnHold(0)).toBe(false); // healthy — no hold
    expect(ladder.evaluate(storm(), BUDGET, 1_000).level).toBe(2);
    expect(ladder.spawnHold(1_000)).toBe(true); // during the storm
    // Pressure clears at t=2s — the hold persists for the calm window…
    expect(ladder.evaluate(m(), BUDGET, 2_000).level).toBe(0);
    expect(ladder.spawnHold(2_000)).toBe(true);
    expect(ladder.spawnHold(10_999)).toBe(true); // 1s + 10s − ε
    // …and expires 10s after the LAST high-pressure verdict.
    expect(ladder.spawnHold(11_001)).toBe(false);
  });

  it('every new L2 verdict extends the window (sustained storm = sustained hold)', () => {
    const ladder = new PressureLadder(
      resolveGuardThresholds({ HUU_GUARD_REOPEN_CALM_MS: '5000' }),
    );
    ladder.evaluate(storm(), BUDGET, 0);
    ladder.evaluate(storm(), BUDGET, 4_000);
    expect(ladder.spawnHold(8_999)).toBe(true); // 4s + 5s
    expect(ladder.spawnHold(9_001)).toBe(false);
  });

  it('L1 (budget/cpu) never arms the hold — only genuine host pressure does', () => {
    const ladder = new PressureLadder(
      resolveGuardThresholds({ HUU_GUARD_REOPEN_CALM_MS: '10000' }),
    );
    const over = m({ ramUsedBytes: 18 * GiB });
    ladder.evaluate(over, BUDGET, 0);
    expect(ladder.evaluate(over, BUDGET, 3_000).level).toBe(1);
    expect(ladder.spawnHold(3_000)).toBe(false);
  });

  it('HUU_GUARD_REOPEN_CALM_MS=0 disables the hold entirely', () => {
    const ladder = new PressureLadder(
      resolveGuardThresholds({ HUU_GUARD_REOPEN_CALM_MS: '0' }),
    );
    ladder.evaluate(storm(), BUDGET, 1_000);
    expect(ladder.spawnHold(1_001)).toBe(false);
  });
});
