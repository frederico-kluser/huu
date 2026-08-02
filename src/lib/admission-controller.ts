/**
 * Lazy/monotonic run-admission decision, shared by the headless `run-many`
 * driver and the web `WebRunManager`. Admit the highest-priority run
 * immediately, then pull in each subsequent run only when the machine shows
 * SUSTAINED spare capacity beyond what the running runs demand (so a one-tick
 * blip doesn't admit a run that's immediately drained), or when a run is
 * bottlenecked in its merge (pool drained → the box is idle despite being
 * "busy").
 *
 * Pure + leaf (`src/lib`): no machine reads, no scheduler import — the caller
 * passes the sampled signals each tick. The controller owns ONLY the hysteresis
 * streak.
 */

export interface AdmissionContext {
  /** Runs admitted and not yet finished (the live concurrency). */
  liveAdmitted: number;
  /** Runs still queued, waiting to be admitted. */
  pendingCount: number;
  /**
   * Spare machine capacity beyond what admitted runs demand
   * (`GlobalScheduler.remaining`). Positive → the box could absorb another run.
   */
  schedulerRemaining: number;
  /** True when some admitted run is merging (its pool is drained → box idle). */
  anyIntegrating: boolean;
  /**
   * Optional: RAM bytes still free under the budget dial (reservations already
   * charged). When provided, an admission also requires it to cover one run's
   * fixed baseline + one agent — a run costs memory before its first agent is
   * ever counted (Node structures, repo scans, worktree creation).
   */
  headroomBytes?: number;
  /**
   * Optional: this tick's effective live-run cap (e.g. budget ÷ (baseline +
   * per-agent charge), so a small machine admits fewer runs). Clamped to
   * `maxAdmitted`; absent → `maxAdmitted` alone (legacy).
   */
  liveCap?: number;
  /** Bytes a run costs before its first agent (used with headroomBytes). */
  runBaselineBytes?: number;
}

/**
 * The slice of `GlobalScheduler` the admission math reads. Declared
 * STRUCTURALLY so this module stays a pure leaf (no upward import) while both
 * the web manager and the shared multi-run driver feed it the real scheduler.
 */
export interface AdmissionBudgetSource {
  /** Free slots beyond what admitted runs demand (`GlobalScheduler.remaining`). */
  readonly remaining: number;
  /** Bytes still free under the dial, reservations already charged. */
  headroomBytes(): number;
  /** Bytes one additional agent is charged at. */
  agentChargeBytes(): number;
  /** Total bytes the dial allows (from `budgetTelemetry().budgetBytes`). */
  budgetBytes(): number;
}

export interface AdmissionSignals {
  liveAdmitted: number;
  pendingCount: number;
  anyIntegrating: boolean;
  /** Bytes a run costs before its first agent (`runBaselineBytes()`). */
  runBaselineBytes: number;
  /** Absent (tests / no scheduler yet) → capacity is treated as unconstrained. */
  budget?: AdmissionBudgetSource | null;
}

/**
 * Build the full {@link AdmissionContext} from the live scheduler. Extracted so
 * the web manager, the shared multi-run driver and `run-many` all charge a run's
 * BASELINE cost and derive the SAME adaptive live cap — before this existed
 * `run-many` passed only the slot signal, so the headless/TUI paths admitted on
 * a weaker rule than the web's and could over-admit on a small machine.
 *
 * `liveCap` = how many runs the dial can hold at `baseline + one agent` each, so
 * a small box admits fewer concurrent runs than the configured ceiling. Floor of
 * 1 — the first run always gets in, otherwise nothing ever runs.
 */
export function computeAdmissionContext(signals: AdmissionSignals): AdmissionContext {
  const { budget } = signals;
  const ctx: AdmissionContext = {
    liveAdmitted: signals.liveAdmitted,
    pendingCount: signals.pendingCount,
    schedulerRemaining: budget ? budget.remaining : Number.POSITIVE_INFINITY,
    anyIntegrating: signals.anyIntegrating,
  };
  if (!budget) return ctx;
  const perRunBytes = signals.runBaselineBytes + budget.agentChargeBytes();
  return {
    ...ctx,
    headroomBytes: budget.headroomBytes(),
    runBaselineBytes: signals.runBaselineBytes,
    liveCap: perRunBytes > 0 ? Math.max(1, Math.floor(budget.budgetBytes() / perRunBytes)) : 1,
  };
}

export interface AdmissionControllerOptions {
  /** Max runs admitted (live) at once. Default 8. */
  maxAdmitted?: number;
  /**
   * Consecutive checks that must observe spare capacity before the next run is
   * pulled in (wall-clock hysteresis). Default 3.
   */
  hysteresisChecks?: number;
}

export class AdmissionController {
  private headroomStreak = 0;
  private readonly maxAdmitted: number;
  private readonly hysteresisChecks: number;

  constructor(opts: AdmissionControllerOptions = {}) {
    this.maxAdmitted = opts.maxAdmitted ?? 8;
    this.hysteresisChecks = opts.hysteresisChecks ?? 3;
  }

  /**
   * Decide whether to admit ONE more run this tick. Maintains the hysteresis
   * streak internally and resets it whenever it returns true (an admission
   * consumes the accumulated headroom) or when at the live cap.
   *
   * `anyIntegrating` only SHORT-CIRCUITS the hysteresis (a merging run's box is
   * genuinely idle) — it never overrides a zero/negative capacity signal. The
   * old behavior admitted on any merge regardless of headroom, which under a
   * many-run queue pulled runs in while the machine was already shedding
   * agents.
   */
  shouldAdmit(ctx: AdmissionContext): boolean {
    if (ctx.pendingCount <= 0) return false;
    const liveCap = Math.min(this.maxAdmitted, Math.max(1, ctx.liveCap ?? this.maxAdmitted));
    if (ctx.liveAdmitted >= liveCap) {
      // At the cap — require fresh sustained headroom before the next admit.
      this.headroomStreak = 0;
      return false;
    }
    const hasCapacity =
      ctx.schedulerRemaining > 0 &&
      (ctx.headroomBytes === undefined ||
        ctx.runBaselineBytes === undefined ||
        // FLOOR OF ONE — with zero live runs the box is idle, so admit even
        // without headroom: when the RAM overshoot comes from OUTSIDE huu
        // (browser/IDE holding RAM past the dial), charging the baseline here
        // deadlocks the queue with nothing running forever. The one admitted
        // run still passes the spawn gate's own floor-of-one, so this degrades
        // to sequential progress, never to oversubscription — the same
        // guarantee GlobalScheduler.shouldSpawn documents for agents.
        ctx.liveAdmitted === 0 ||
        ctx.headroomBytes >= ctx.runBaselineBytes);
    this.headroomStreak = hasCapacity ? this.headroomStreak + 1 : 0;
    if (hasCapacity && (ctx.anyIntegrating || this.headroomStreak >= this.hysteresisChecks)) {
      this.headroomStreak = 0;
      return true;
    }
    return false;
  }

  /** Reset the hysteresis streak (e.g. after admitting outside shouldAdmit). */
  reset(): void {
    this.headroomStreak = 0;
  }
}
