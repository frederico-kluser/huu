import { AutoScaler } from './auto-scaler.js';
import { SystemMetricsSampler, type SystemMetrics } from '../lib/resource-monitor.js';

/**
 * GlobalScheduler — the single owner of the machine for MULTI-RUN scheduling.
 *
 * huu normally runs one pipeline at a time; each Orchestrator owns its own
 * AutoScaler that reads SYSTEM-WIDE RAM and would, if two ran at once, each
 * target "use all the headroom" → double-count → OOM. The GlobalScheduler
 * resolves that by owning ONE SystemMetricsSampler + ONE budget AutoScaler and
 * distributing the single global concurrency budget across N subordinate runs
 * top-down by priority. Backfill, cascade, strict priority and auto-yield all
 * fall out of that one distribution; the lowest-priority-first kill ordering
 * falls out of one victim selector.
 *
 * It operates on the {@link RunDriver} interface, never on Orchestrator
 * directly — so the dependency points downward (Orchestrator depends on this
 * module, not vice-versa) and the scheduler stays unit-testable with stubs.
 */

/** Scheduler re-evaluation cadence. */
const SCHED_TICK_MS = 1_000;
/**
 * Overflow guard on a single run's demand. Real bounding is the global budget
 * B (≤ AutoScaler maxAgents); this only stops a bogus getDemand() (e.g. a
 * runaway count) from skewing the distribution. Set well above any real B so
 * it never caps a legitimately busy top-priority run.
 */
const HARD_PER_RUN_CEILING = 512;

/**
 * What a subordinate run (an Orchestrator) exposes to the scheduler. Kept tiny
 * and side-effect-light so the scheduler can be driven by stub drivers in
 * tests.
 */
export interface RunDriver {
  readonly runId: string;
  /**
   * How many slots this run could USE right now — active + spawning + pending.
   * The scheduler reads this once per tick; it must be cheap and consistent.
   */
  getDemand(): number;
  /**
   * Currently-running TASK agents (NOT reserved integration/judge agents),
   * each with the time its work began. Newest `startedAt` = least work done =
   * the kill victim. Empty when the run is idle or merging.
   */
  activeAgentAges(): Array<{ agentId: number; startedAt: number }>;
  /**
   * Kill + requeue one task agent. Reuses the run's own memory-guard machinery
   * (the consumable killedAgentIds Set + front-of-queue requeue), so a
   * scheduler-driven kill is indistinguishable from a single-run guard kill.
   */
  destroyAgent(agentId: number): Promise<void>;
  /**
   * Optional: receive the scheduler's single metrics read so the run's dormant
   * AutoScaler can surface live RAM%/CPU% in the UI without polling the machine
   * itself (which would corrupt the shared CPU delta). Display-only.
   */
  acceptMetrics?(metrics: SystemMetrics): void;
}

/** Returned to a run on register(); pass back to unregister(). */
export interface RunDriverHandle {
  readonly runId: string;
  /** Priority key: lower = higher priority (assigned in registration order). */
  readonly seq: number;
}

interface RunSlot {
  driver: RunDriver;
  seq: number;
}

/**
 * Top-down priority distribution of a global slot budget. Each run, in
 * priority order (highest first), is granted `min(demand, remaining)`; the
 * remainder cascades to the next run. This single function encodes:
 *   - backfill (a saturated #1 leaves 0 for #2);
 *   - cascade (#1 and #2 both idle/merging → budget reaches #3);
 *   - strict priority (#1 is always served first);
 *   - auto-yield (when #1's demand rises its grant grows and lower runs' grants
 *     shrink — the caller then drains/preempts them down to their new grant).
 *
 * `demands` MUST already be in priority order (index 0 = highest priority).
 */
export function distributeBudget(
  demands: number[],
  total: number,
  perRunCeiling: number = HARD_PER_RUN_CEILING,
): number[] {
  let remaining = Math.max(0, Math.floor(total));
  return demands.map((d) => {
    const want = Math.min(Math.max(0, Math.floor(d)), perRunCeiling);
    const grant = Math.min(want, remaining);
    remaining -= grant;
    return grant;
  });
}

export class GlobalScheduler {
  private readonly sampler: SystemMetricsSampler;
  private readonly budget: AutoScaler;
  private readonly slots: RunSlot[] = [];
  private seqCounter = 0;
  private readonly grants = new Map<string, number>();
  /** `${runId}#${agentId}` for kills in flight — never re-select the same victim. */
  private readonly preempting = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private lastBudget = 0;
  private lastRemaining = 0;
  /**
   * One reservation set shared by every subordinate run's PortAllocator, so two
   * concurrent runs (each with their own agentId space) never hand out the same
   * physical port window. See PortAllocatorOptions.sharedReservedPorts.
   */
  readonly sharedReservedPorts = new Set<number>();

  constructor(
    opts: {
      sampler?: SystemMetricsSampler;
      resourceMonitor?: () => SystemMetrics;
      /** Inject a pre-built budget scaler (tests pass a started one). */
      budget?: AutoScaler;
    } = {},
  ) {
    this.sampler = opts.sampler ?? new SystemMetricsSampler();
    const monitor = opts.resourceMonitor ?? (() => this.sampler.sample());
    this.budget = opts.budget ?? new AutoScaler({ resourceMonitor: monitor });
    this.budget.setMode('auto');
  }

  /** Begin sampling + the re-grant/guard tick. Idempotent. */
  start(): void {
    if (this.tickTimer) return;
    // The budget's internal poll is the SOLE caller of the sampler — one sample
    // per second, so the single CPU-delta snapshot is never corrupted.
    this.budget.start();
    void this.tick();
    this.tickTimer = setInterval(() => void this.tick(), SCHED_TICK_MS);
    this.tickTimer.unref?.();
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.budget.stop();
  }

  /** Admit a run. Returns a handle for later unregister(). Re-grants at once. */
  register(driver: RunDriver): RunDriverHandle {
    const seq = this.seqCounter++;
    this.slots.push({ driver, seq });
    this.recomputeGrants();
    return { runId: driver.runId, seq };
  }

  unregister(handle: RunDriverHandle): void {
    const i = this.slots.findIndex((s) => s.driver.runId === handle.runId);
    if (i >= 0) this.slots.splice(i, 1);
    this.grants.delete(handle.runId);
    // Drop any in-flight preemption markers for the departed run.
    for (const key of [...this.preempting]) {
      if (key.startsWith(`${handle.runId}#`)) this.preempting.delete(key);
    }
    this.recomputeGrants();
  }

  /** The slot grant for a run — what its pool may run up to this tick. */
  grantFor(runId: string): number {
    return this.grants.get(runId) ?? 0;
  }

  /** Global RAM/CPU spawn gate (the budget's headroom check). */
  shouldSpawn(): boolean {
    return this.budget.shouldSpawn();
  }

  /** Number of admitted runs. A selector/UI shows only when this is > 1. */
  get size(): number {
    return this.slots.length;
  }

  /** Last computed global budget B (slots across all runs). */
  get currentBudget(): number {
    return this.lastBudget;
  }

  /**
   * Free slots not claimed by any admitted run's demand (last recompute).
   * Positive only when every admitted run is fully served and budget remains —
   * the signal an admission policy samples to pull in the next queued run.
   */
  get remaining(): number {
    return this.lastRemaining;
  }

  /**
   * Recompute every run's grant from the current global budget. Pure w.r.t the
   * machine — reads each driver's demand once, syncs the budget's global
   * counts, then distributes top-down by priority.
   */
  recomputeGrants(): void {
    const ordered = [...this.slots].sort((a, b) => a.seq - b.seq);

    let activeTotal = 0;
    let pendingTotal = 0;
    const demands: number[] = [];
    for (const s of ordered) {
      const active = s.driver.activeAgentAges().length;
      const demand = Math.max(0, s.driver.getDemand());
      demands.push(demand);
      activeTotal += active;
      pendingTotal += Math.max(0, demand - active);
    }

    // Drive the ONE budget AutoScaler from the SUM across all runs, so
    // targetConcurrency() returns the GLOBAL slot budget.
    this.budget.syncCounts(activeTotal, pendingTotal);
    const B = this.budget.targetConcurrency();
    this.lastBudget = B;

    const granted = distributeBudget(demands, B);
    ordered.forEach((s, i) => this.grants.set(s.driver.runId, granted[i]!));

    // Spare MACHINE capacity beyond what the admitted runs demand. B itself is
    // demand-capped (so B − Σgrants is always ~0); the real admission signal is
    // the RAM-headroom capacity WITHOUT that cap, minus total demand. Positive
    // only when the box could absorb more agents than the admitted runs want —
    // i.e. another queued run can be pulled in. (Hysteresis is the caller's.)
    const totalDemand = activeTotal + pendingTotal;
    this.lastRemaining = Math.max(0, this.budget.headroomCapacity() - totalDemand);
  }

  /**
   * Pick the kill victim under memory pressure (and, later, priority
   * preemption): the LOWEST-priority run that has a live task agent, and that
   * run's NEWEST agent (largest startedAt = least work lost). Agents already
   * being preempted are excluded. Returns null when nothing is killable.
   *
   * Because grants are handed out highest-priority-first, only lower-priority
   * runs can exceed their grant, so reverse-priority victim selection upholds
   * the invariant: never kill a higher-priority run's agent while a
   * lower-priority run still has one alive.
   */
  selectGlobalVictim(): { runId: string; agentId: number; driver: RunDriver } | null {
    const ordered = [...this.slots].sort((a, b) => b.seq - a.seq); // lowest priority first
    for (const s of ordered) {
      const ages = s.driver
        .activeAgentAges()
        .filter((a) => !this.preempting.has(`${s.driver.runId}#${a.agentId}`));
      if (ages.length === 0) continue;
      const newest = ages.reduce((m, a) => (a.startedAt > m.startedAt ? a : m));
      return { runId: s.driver.runId, agentId: newest.agentId, driver: s.driver };
    }
    return null;
  }

  /**
   * One scheduling pass: re-grant + run the memory guard. Normally driven by
   * the internal timer; exposed so tests can step it deterministically.
   */
  async tick(): Promise<void> {
    if (this.ticking) return; // never overlap (a kill may await)
    this.ticking = true;
    try {
      this.recomputeGrants();
      await this.enforceMemoryGuard();
    } finally {
      this.ticking = false;
    }
  }

  /**
   * RAM/CPU backstop: at ≥ the destroy threshold, kill the global victim
   * (lowest-priority newest) and arm the budget's cooldown so we don't re-kill
   * before the freed RAM is observed. One kill per tick — the tick cadence +
   * cooldown are the damping (mirrors the single-run guard).
   */
  private async enforceMemoryGuard(): Promise<void> {
    if (!this.budget.shouldDestroy()) return;
    const victim = this.selectGlobalVictim();
    if (!victim) return;
    const key = `${victim.runId}#${victim.agentId}`;
    this.preempting.add(key);
    try {
      await victim.driver.destroyAgent(victim.agentId);
      this.budget.notifyAgentDestroyed();
    } finally {
      this.preempting.delete(key);
    }
  }
}
