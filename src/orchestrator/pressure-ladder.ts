import type { SystemMetrics } from '../lib/resource-monitor.js';

/**
 * PressureLadder — graded memory-pressure verdicts for the guard, replacing the
 * single RAM/CPU ≥ 95% trigger that a swapping host never crosses (pages spill
 * to swap, RAM% plateaus below the line, and the box thrash-freezes with the
 * guard silent — the 9-run and 33-run incidents).
 *
 * Levels (cumulative — a higher level implies everything below):
 *   L0 — healthy.
 *   L1 — BUDGET ENFORCEMENT: `used` has stayed over the RAM-budget dial for a
 *        sustained window. The dial stops being advisory here: spawns freeze and
 *        the guard sheds newest agents until usage returns under the dial.
 *   L2 — HOST PRESSURE (earlyoom-informed): available RAM AND free swap both
 *        low, or PSI `full avg10` past the thrash line, or sustained swap-in,
 *        or the legacy RAM/CPU ≥ 95% line. Admission of queued runs freezes and
 *        the guard tick accelerates.
 *   L3 — EMERGENCY: available/swap floors or PSI full past the emergency line —
 *        the machine is actively thrashing; shed as fast as the tick allows.
 *
 * Threshold provenance: earlyoom defaults (act at ≤10% avail RAM AND ≤10% free
 * swap; kill at 5%/5%), systemd-oomd (PSI-driven kills), and the kernel PSI
 * docs (`full` = all non-idle tasks stalled = thrash). With no swap configured
 * the swap-free ratio is treated as exhausted, collapsing the joint condition
 * to the memory side — earlyoom's exact semantics.
 *
 * Pure w.r.t. the machine: callers pass metrics + budget bytes (+ `now` for
 * deterministic tests). The class owns only the time-based streaks.
 */

export type PressureLevel = 0 | 1 | 2 | 3;

export interface PressureThresholds {
  /** L2 joint condition: available RAM below this % of total… */
  availPct: number;
  /** …AND free swap below this % of swap total. */
  swapFreePct: number;
  /** L3 joint condition floors. */
  availPctEmergency: number;
  swapFreePctEmergency: number;
  /** L2: PSI `full avg10` at/above this %. */
  psiFullHigh: number;
  /** L3: PSI `full avg10` at/above this %. */
  psiFullEmergency: number;
  /** L2: swap-in rate (pages/sec) that counts as "hot" when sustained. */
  swapInPagesPerSec: number;
  /** How long swap-in must stay hot before it counts (ms). */
  swapInSustainMs: number;
  /** L1: how long `used > budget` must persist before enforcement (ms). */
  overBudgetSustainMs: number;
  /** Legacy destroy line (RAM% or CPU%) — mapped to L2. */
  destroyPercent: number;
  /** Minimum gap between L1 preemptions (lets dispose+GC land in `used`). */
  l1RepreemptMs: number;
}

export const DEFAULT_PRESSURE_THRESHOLDS: PressureThresholds = {
  availPct: 10,
  swapFreePct: 10,
  availPctEmergency: 5,
  swapFreePctEmergency: 5,
  psiFullHigh: 5,
  psiFullEmergency: 20,
  swapInPagesPerSec: 1000,
  swapInSustainMs: 2_000,
  overBudgetSustainMs: 3_000,
  destroyPercent: 95,
  l1RepreemptMs: 2_500,
};

/**
 * `HUU_GUARD_*` env knobs → thresholds. Unset/garbage keys keep the defaults;
 * parsing never throws (validation must never block a run).
 */
export function resolveGuardThresholds(
  env: NodeJS.ProcessEnv = process.env,
): PressureThresholds {
  const num = (key: string, fallback: number, min: number, max: number): number => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };
  return {
    availPct: num('HUU_GUARD_AVAIL_PCT', DEFAULT_PRESSURE_THRESHOLDS.availPct, 1, 50),
    swapFreePct: num('HUU_GUARD_SWAP_FREE_PCT', DEFAULT_PRESSURE_THRESHOLDS.swapFreePct, 0, 100),
    availPctEmergency: num(
      'HUU_GUARD_AVAIL_PCT_EMERGENCY',
      DEFAULT_PRESSURE_THRESHOLDS.availPctEmergency,
      1,
      25,
    ),
    swapFreePctEmergency: num(
      'HUU_GUARD_SWAP_FREE_PCT_EMERGENCY',
      DEFAULT_PRESSURE_THRESHOLDS.swapFreePctEmergency,
      0,
      100,
    ),
    psiFullHigh: num('HUU_GUARD_PSI_FULL_HIGH', DEFAULT_PRESSURE_THRESHOLDS.psiFullHigh, 0.1, 100),
    psiFullEmergency: num(
      'HUU_GUARD_PSI_FULL_EMERGENCY',
      DEFAULT_PRESSURE_THRESHOLDS.psiFullEmergency,
      0.5,
      100,
    ),
    swapInPagesPerSec: num(
      'HUU_GUARD_SWAPIN_PAGES_SEC',
      DEFAULT_PRESSURE_THRESHOLDS.swapInPagesPerSec,
      10,
      1_000_000,
    ),
    swapInSustainMs: num(
      'HUU_GUARD_SWAPIN_SUSTAIN_MS',
      DEFAULT_PRESSURE_THRESHOLDS.swapInSustainMs,
      0,
      600_000,
    ),
    overBudgetSustainMs: num(
      'HUU_GUARD_OVER_BUDGET_MS',
      DEFAULT_PRESSURE_THRESHOLDS.overBudgetSustainMs,
      0,
      600_000,
    ),
    destroyPercent: num('HUU_GUARD_DESTROY_PCT', DEFAULT_PRESSURE_THRESHOLDS.destroyPercent, 50, 100),
    l1RepreemptMs: num(
      'HUU_GUARD_L1_REPREEMPT_MS',
      DEFAULT_PRESSURE_THRESHOLDS.l1RepreemptMs,
      0,
      600_000,
    ),
  };
}

export interface PressureVerdict {
  level: PressureLevel;
  /**
   * What tripped the level — drives how the guards react:
   *   'budget' — L1 dial enforcement (auto/greedy only; spawn floor-of-one).
   *   'cpu'    — the legacy CPU ≥ 95% line, damped like L1 (CPU saturation is
   *              NORMAL during test/build stages — never accelerate the tick,
   *              never freeze admission for it).
   *   'host'   — genuine memory danger (L2/L3): full freeze + fast tick.
   */
  kind: 'none' | 'budget' | 'cpu' | 'host';
  /** Human-readable trigger, for logs/UI (empty at level 0). */
  reason: string;
  /** Bytes over the budget dial (0 when under). */
  overshootBytes: number;
}

export const HEALTHY_VERDICT: PressureVerdict = {
  level: 0,
  kind: 'none',
  reason: '',
  overshootBytes: 0,
};

export class PressureLadder {
  private overBudgetSince: number | null = null;
  private swapInHotSince: number | null = null;
  private lastL1PreemptAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly t: PressureThresholds = resolveGuardThresholds()) {}

  /**
   * Grade the current pressure. `budgetBytes` is the dial in bytes (0 disables
   * the L1 budget check — e.g. totals unknown). `now` is injectable for tests.
   */
  evaluate(m: SystemMetrics, budgetBytes: number, now: number = Date.now()): PressureVerdict {
    const availPct = m.ramTotalBytes > 0 ? (m.ramAvailableBytes / m.ramTotalBytes) * 100 : 100;
    // Swap semantics — three distinct states:
    //   known, has swap → real free ratio;
    //   known, no swap (Linux, SwapTotal=0) → trivially exhausted (earlyoom
    //     semantics: zero spill room), collapses the joint condition;
    //   UNKNOWN (null — macOS/Windows/unreadable /proc) → treat as NOT
    //     exhausted, so the avail-only side can never fire L2/L3 alone.
    //     Conflating unknown with none used to turn "9% available on a Mac"
    //     into a drain-to-zero L2 — tighter than the legacy 95% line.
    const swapFreePct =
      m.swapTotalBytes === null
        ? 100
        : m.swapTotalBytes > 0
          ? ((m.swapFreeBytes ?? 0) / m.swapTotalBytes) * 100
          : 0;
    const full10 = m.memPressureFull10;
    const overshootBytes =
      budgetBytes > 0 ? Math.max(0, m.ramUsedBytes - budgetBytes) : 0;

    // Time-based streaks (tick cadence varies, so counts would be meaningless).
    if (overshootBytes > 0) {
      this.overBudgetSince ??= now;
    } else {
      this.overBudgetSince = null;
    }
    const swapInHot =
      m.swapInPagesPerSec !== null && m.swapInPagesPerSec >= this.t.swapInPagesPerSec;
    if (swapInHot) {
      this.swapInHotSince ??= now;
    } else {
      this.swapInHotSince = null;
    }

    if (
      (availPct < this.t.availPctEmergency && swapFreePct < this.t.swapFreePctEmergency) ||
      (full10 !== null && full10 >= this.t.psiFullEmergency)
    ) {
      return {
        level: 3,
        kind: 'host',
        reason:
          full10 !== null && full10 >= this.t.psiFullEmergency
            ? `PSI full avg10 ${full10.toFixed(1)}% ≥ ${this.t.psiFullEmergency}% (thrashing)`
            : `avail ${availPct.toFixed(1)}% + swap free ${swapFreePct.toFixed(1)}% below emergency floor`,
        overshootBytes,
      };
    }

    const swapInSustained =
      this.swapInHotSince !== null && now - this.swapInHotSince >= this.t.swapInSustainMs;
    if (
      (availPct < this.t.availPct && swapFreePct < this.t.swapFreePct) ||
      (full10 !== null && full10 >= this.t.psiFullHigh) ||
      swapInSustained ||
      m.ramPercent >= this.t.destroyPercent
    ) {
      const reason =
        m.ramPercent >= this.t.destroyPercent
          ? `RAM ≥ ${this.t.destroyPercent}%`
          : full10 !== null && full10 >= this.t.psiFullHigh
            ? `PSI full avg10 ${full10.toFixed(1)}% ≥ ${this.t.psiFullHigh}%`
            : swapInSustained
              ? `sustained swap-in ≥ ${this.t.swapInPagesPerSec} pages/s`
              : `avail ${availPct.toFixed(1)}% + swap free ${swapFreePct.toFixed(1)}% low`;
      return { level: 2, kind: 'host', reason, overshootBytes };
    }

    // Pure CPU saturation (memory healthy) is NORMAL during parallel
    // test/build stages — it gets the DAMPED L1 treatment (one preemption per
    // repreempt window, normal tick, admission untouched), never the L2
    // drain-to-zero + machine-wide freeze the legacy ≥95% OR-condition used
    // to escalate into.
    if (m.cpuPercent >= this.t.destroyPercent) {
      return {
        level: 1,
        kind: 'cpu',
        reason: `CPU ≥ ${this.t.destroyPercent}%`,
        overshootBytes,
      };
    }

    if (
      this.overBudgetSince !== null &&
      now - this.overBudgetSince >= this.t.overBudgetSustainMs
    ) {
      return {
        level: 1,
        kind: 'budget',
        reason: `used over the RAM budget for ${Math.round((now - this.overBudgetSince) / 1000)}s`,
        overshootBytes,
      };
    }

    return HEALTHY_VERDICT;
  }

  /**
   * Damping for L1 (budget-enforcement) preemptions: a pause frees RAM only
   * after dispose + GC land in `used`, so back-to-back L1 preemptions would
   * over-shed on stale data. L2/L3 (host pressure) are never damped — the
   * accelerated tick is the pacing there.
   */
  preemptAllowed(level: PressureLevel, now: number = Date.now()): boolean {
    if (level >= 2) return true;
    if (level === 1) return now - this.lastL1PreemptAt >= this.t.l1RepreemptMs;
    return false;
  }

  /** Record an executed preemption (feeds the L1 damping window). */
  notePreempt(level: PressureLevel, now: number = Date.now()): void {
    if (level === 1) this.lastL1PreemptAt = now;
  }
}
