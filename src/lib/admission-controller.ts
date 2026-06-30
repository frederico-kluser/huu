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
   */
  shouldAdmit(ctx: AdmissionContext): boolean {
    if (ctx.pendingCount <= 0) return false;
    if (ctx.liveAdmitted >= this.maxAdmitted) {
      // At the cap — require fresh sustained headroom before the next admit.
      this.headroomStreak = 0;
      return false;
    }
    this.headroomStreak = ctx.schedulerRemaining > 0 ? this.headroomStreak + 1 : 0;
    if (ctx.anyIntegrating || this.headroomStreak >= this.hysteresisChecks) {
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
