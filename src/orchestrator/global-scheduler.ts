import { AutoScaler } from './auto-scaler.js';
import { PressureLadder, HEALTHY_VERDICT, type PressureVerdict } from './pressure-ladder.js';
import { SystemMetricsSampler, type SystemMetrics } from '../lib/resource-monitor.js';
import { resolveRamPercent } from '../lib/budget.js';
import { noKernelCeilingWarning } from '../lib/ram-doctor.js';
import { resolveRamTuning } from '../lib/ram-tuning.js';
import { log as dlog } from '../lib/debug-logger.js';

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

/**
 * Scheduler re-evaluation + memory-guard cadence. Matches the single-run pool
 * guard (POLL_INTERVAL_MS = 500ms) so multi-run sheds RAM at the same rate —
 * the in-pool guard is OFF in subordinate mode, making this tick the sole
 * killer.
 */
const SCHED_TICK_MS = 500;
/**
 * Accelerated cadence under host pressure (ladder level ≥ 2): one victim per
 * tick stays the rule (each preemption's freed RAM is observed before the next
 * decision), so shedding VELOCITY comes from ticking faster — ~6/s instead of
 * 2/s — while the data between decisions stays fresh.
 */
const SCHED_PRESSURE_TICK_MS = 150;
/**
 * Overflow guard on a single run's demand. Real bounding is the global budget
 * B (≤ AutoScaler maxAgents); this only stops a bogus getDemand() (e.g. a
 * runaway count) from skewing the distribution. Set well above any real B so
 * it never caps a legitimately busy top-priority run.
 */
const HARD_PER_RUN_CEILING = 512;
/**
 * Coalescing window for event-pushed re-grants (notifyAgentLifecycle). Exits
 * arrive in bursts (a stage draining); recompute is pure and cheap, but once
 * per burst is enough — and 25 ms is still 20× faster than the 500 ms poll
 * tick the release used to wait for.
 */
const NOTIFY_DEBOUNCE_MS = 25;

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
   * `reason` is the pressure-ladder verdict that fired (surfaced in the run
   * log so a preemption at low container-RAM% is diagnosable).
   */
  destroyAgent(agentId: number, reason?: string): Promise<void>;
  /**
   * Optional (Fase 2.3): PAUSE + requeue one task agent instead of killing it —
   * preserve its worktree + pi session so it resumes from where it left off
   * when headroom returns. Same cross-run victim as a kill; the run falls back
   * to destroyAgent internally when no checkpoint is possible, so the scheduler
   * always has a working preemption. A driver without it ⇒ kill (legacy).
   * `reason` as in {@link destroyAgent}.
   */
  pauseAgent?(agentId: number, reason?: string): Promise<void>;
  /**
   * Optional: receive the scheduler's single metrics read so the run's dormant
   * AutoScaler can surface live RAM%/CPU% in the UI without polling the machine
   * itself (which would corrupt the shared CPU delta). Display-only.
   */
  acceptMetrics?(metrics: SystemMetrics): void;
  /**
   * Optional: reservation-accounting inputs — spawns in flight plus live agents
   * younger than the maturation window. The scheduler SUMS these across runs and
   * feeds the budget scaler so a multi-run spawn burst is charged against the
   * budget before its RAM becomes visible in `used`. A driver without it simply
   * contributes zero reservations (legacy behavior).
   */
  spawnStats?(): { spawning: number; young: number };
  /**
   * Optional: live RESERVED agents — the CheckStep judge (9998) and the
   * integration conflict resolver (9999). Counted into the global budget on
   * the demand AND active side (their RAM is already in `used`; leaving them
   * out under-counted B and let admission stack new runs on top of invisible
   * judges), but NEVER into {@link activeAgentAges} — reserved agents are
   * mandatory singletons and must never be preemption victims. A driver
   * without it contributes zero (legacy behavior).
   */
  reservedLiveCount?(): number;
  /**
   * Optional: nudge the run's sleeping pool to re-read its grant NOW. Called
   * by {@link GlobalScheduler.recomputeGrants} when the run's grant RISES —
   * without it a slot freed by another run's exit sits idle until the
   * beneficiary's next 500 ms poll tick. Must be a cheap no-op while the pool
   * is awake or between stages. Drains need no nudge: the pool re-reads its
   * (lowered) grant on its own tick and simply stops spawning.
   */
  wakeup?(): void;
}

/** Returned to a run on register(); pass back to unregister(). */
export interface RunDriverHandle {
  readonly runId: string;
  /**
   * Registration counter (monotonic). Historically this WAS the priority key;
   * the EFFECTIVE priority is now `RunSlot.priority` (an explicit caller value
   * when given, else this seq). Still returned for stable identity / tie-break.
   */
  readonly seq: number;
}

interface RunSlot {
  driver: RunDriver;
  /** Registration counter — stable tie-break, and the default priority. */
  seq: number;
  /**
   * Authoritative priority (lower = higher priority). Defaults to `seq`, so the
   * single-run and legacy paths are byte-identical; the multi-run front-ends
   * pass an explicit value (web queue index, TUI selection index, run-many spec
   * index) so the FIRST project in the user's list is always highest priority —
   * independent of the order these concurrently-started runs happen to reach
   * register(). That call order is a RACE (each run registers only AFTER its own
   * async preflight), which is exactly why priority must be caller-authoritative.
   */
  priority: number;
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
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pending event-pushed re-grant (notifyAgentLifecycle debounce). */
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Operator announcement sink (constructor opt) — see notifyAgentLifecycle. */
  private readonly onAnnounce?: (line: string) => void;
  private ticking = false;
  private stopped = true;
  private lastBudget = 0;
  private lastRemaining = 0;
  /** Live agents + in-flight spawns across all runs (last recompute). */
  private lastBusyTotal = 0;
  /** Live agents incl. reserved judge/merge agents (last recompute). */
  private lastActiveTotal = 0;
  /** Live reserved judge/merge agents across all runs (last recompute). */
  private lastReservedTotal = 0;
  /** Graded pressure verdicts (swap/PSI-full/budget-aware) — see PressureLadder. */
  private readonly ladder = new PressureLadder();
  private lastPressure: PressureVerdict = HEALTHY_VERDICT;
  private lastLoggedPressureLevel = 0;
  /**
   * One reservation set shared by every subordinate run's PortAllocator, so two
   * concurrent runs (each with their own agentId space) never hand out the same
   * physical port window. See PortAllocatorOptions.sharedReservedPorts.
   */
  readonly sharedReservedPorts = new Set<number>();
  /**
   * Fase 2.3: prefer pausing the cross-run victim (preserve its work) over
   * killing it. On by default; HUU_NO_PAUSE=1 reverts to kill+requeue. The
   * driver still falls back to a kill when no checkpoint is possible.
   */
  private readonly pauseInsteadOfKill = process.env.HUU_NO_PAUSE !== '1';

  constructor(
    opts: {
      sampler?: SystemMetricsSampler;
      resourceMonitor?: () => SystemMetrics;
      /** Inject a pre-built budget scaler (tests pass a started one). */
      budget?: AutoScaler;
      /**
       * Operator-facing announcement sink (e.g. the web serve terminal). One
       * line per agent EXIT with the global counts, emitted only in TRUE
       * multi-run (>1 admitted run) — single-run already narrates its own run
       * log, and cross-run slot movement is what's otherwise invisible.
       */
      onAnnounce?: (line: string) => void;
      /**
       * Machine-global RAM dial for the budget scaler. Front-ends pass
       * `effectiveRamPercent()` so the PERSISTED dial is honored; omitted falls
       * back to `HUU_RAM_PERCENT`/default. Resolved by the caller on purpose —
       * reading the config store from in here would make every scheduler's
       * budget depend on ambient home-dir state.
       */
      budgetPercent?: number;
    } = {},
  ) {
    this.onAnnounce = opts.onAnnounce;
    this.sampler = opts.sampler ?? new SystemMetricsSampler();
    const monitor = opts.resourceMonitor ?? (() => this.sampler.sample());
    this.budget =
      opts.budget ??
      new AutoScaler({
        resourceMonitor: monitor,
        budgetPercent: resolveRamPercent(opts.budgetPercent),
        // Evidence-based env knobs (HUU_AGENT_MEM_SEED_MB / _EMA_ALPHA);
        // omitted keys keep the pessimistic OOM-safe defaults.
        ...resolveRamTuning(),
      });
    this.budget.setMode('auto');
  }

  /** Begin sampling + the re-grant/guard tick. Idempotent. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // The budget's internal poll is the SOLE caller of the sampler — one sample
    // per second (250 ms near the edge), so the single CPU-delta snapshot is
    // never corrupted.
    this.budget.start();
    void this.tick();
    this.scheduleTick();
  }

  /**
   * Self-rescheduling tick with pressure-adaptive cadence: 500 ms at rest,
   * 150 ms while the ladder reports host pressure (level ≥ 2) so one-victim-
   * per-tick shedding still drains a runaway fleet in seconds.
   */
  private scheduleTick(): void {
    if (this.stopped) return;
    const delay = this.lastPressure.level >= 2 ? SCHED_PRESSURE_TICK_MS : SCHED_TICK_MS;
    this.tickTimer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleTick());
    }, delay);
    this.tickTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.budget.stop();
  }

  /**
   * Event-push slot release — a run announces an agent lifecycle change
   * (normal completion, final failure, guard kill/pause, reserved
   * judge/merge exit) so the freed slot is re-granted NOW instead of on the
   * next 500 ms poll tick. This is the user-facing contract "agents globally
   * announce when they stop": the freed capacity moves to the next run within
   * the debounce window, and the beneficiary's pool is nudged awake by the
   * grant-rise wakeup in {@link recomputeGrants}.
   *
   * Deliberately NEVER calls `budget.notifyAgentDestroyed()`: that arms the
   * 30 s spawn COOLDOWN meant for guard preemptions — wiring it to normal
   * completions would freeze the fleet after every finished task. Pressure
   * gates are unaffected: `remaining`/`shouldSpawn()` re-check the ladder and
   * the post-storm calm hold at read time, so a push can't bypass them.
   */
  notifyAgentLifecycle(ev: {
    runId: string;
    agentId: number;
    event: 'spawn' | 'exit';
    reserved?: boolean;
    cause?: string;
  }): void {
    if (this.stopped && this.slots.length === 0) return;
    dlog('scheduler', 'agent_lifecycle', ev);
    if (ev.event === 'exit') this.announceExit(ev);
    if (this.notifyTimer) return; // coalesce the burst
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.recomputeGrants();
    }, NOTIFY_DEBOUNCE_MS);
    this.notifyTimer.unref?.();
  }

  /**
   * One operator-facing line per agent exit — the visible half of "agents
   * globally announce when they stop". Gated to TRUE multi-run (>1 admitted
   * run). Live counts are fresh sync reads; B/remaining come from the last
   * recompute (≤1 tick stale — the debounced push lands ~25 ms later).
   */
  private announceExit(ev: { runId: string; agentId: number; cause?: string }): void {
    if (!this.onAnnounce || this.slots.length <= 1) return;
    let live = 0;
    let reserved = 0;
    for (const s of this.slots) {
      live += s.driver.activeAgentAges().length;
      reserved += Math.max(0, s.driver.reservedLiveCount?.() ?? 0);
    }
    live += reserved;
    const what =
      ev.agentId === 9998 ? 'judge' : ev.agentId === 9999 ? 'merge resolver' : `agent ${ev.agentId}`;
    this.onAnnounce(
      `${what} (run ${ev.runId.slice(0, 8)}) ${ev.cause ?? 'exited'} — ` +
        `global live ${live}${reserved > 0 ? ` (${reserved} judge/merge)` : ''}, ` +
        `B ${this.lastBudget}, remaining ${this.remaining}`,
    );
  }

  /**
   * Update the machine-global RAM budget dial at runtime (e.g. the web Setting
   * changed between runs). Applies to the single budget AutoScaler that governs
   * every subordinate run.
   */
  setBudgetPercent(pct: number): void {
    this.budget.setBudgetPercent(pct);
  }

  /**
   * Admit a run. Returns a handle for later unregister(). Re-grants at once.
   *
   * `priority` (lower = higher priority) makes this run's rank AUTHORITATIVE to
   * the caller's list order rather than the order register() is called — the
   * multi-run front-ends start their runs concurrently, so register-call order
   * is a race. Omit it and priority falls back to registration order (single-run
   * / legacy path: unchanged).
   */
  register(driver: RunDriver, priority?: number): RunDriverHandle {
    const seq = this.seqCounter++;
    this.slots.push({ driver, seq, priority: priority ?? seq });
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

  /** Global RAM/CPU spawn gate (the budget's headroom check + pressure freeze). */
  shouldSpawn(): boolean {
    // Host pressure (L2/L3): the machine is genuinely at risk — full freeze.
    // The freeze extends through the post-storm CALM window so every paused
    // run doesn't resume at once the instant avg10 dips below the line (the
    // thundering herd that re-drained the pool every ~15 s).
    if (this.lastPressure.level >= 2 || this.ladder.spawnHold()) return false;
    // Budget enforcement (L1): freeze growth, but with a FLOOR OF ONE — when
    // the overshoot comes from OUTSIDE huu (browser/IDE holding RAM past a low
    // dial), zero live agents would mean zero progress FOREVER. One agent is
    // the degrade-to-sequential guarantee, mirrored by the guard's L1
    // min-survivor rule. 'cpu'-kind L1 defers to the budget gate below (which
    // already handles CPU per mode).
    if (this.lastPressure.level === 1 && this.lastPressure.kind === 'budget' && this.lastBusyTotal > 0) {
      return false;
    }
    return this.budget.shouldSpawn();
  }

  /** Latest graded pressure verdict (level 0–3) — observability + admission. */
  get pressure(): PressureVerdict {
    return this.lastPressure;
  }

  /** RAM bytes still free under the dial (reservations charged) — admission input. */
  headroomBytes(): number {
    return this.budget.headroomBytesRemaining();
  }

  /** Per-agent planning charge in bytes (EMA, seed-floored until mature). */
  agentChargeBytes(): number {
    return this.budget.plannedChargeBytes();
  }

  /**
   * Total bytes the dial allows. Together with {@link headroomBytes} and
   * {@link agentChargeBytes} this completes the structural `AdmissionBudgetSource`
   * that `computeAdmissionContext` consumes — callers no longer have to build a
   * whole {@link budgetTelemetry} object to read one number.
   */
  budgetBytes(): number {
    return this.budget.budgetBytes();
  }

  /**
   * Machine-global budget snapshot for observability surfaces (the web
   * `{type:'budget'}` SSE frame, `huu status`). Derived, read-only.
   *
   * Deliberately EXCLUDED from all counts: the pre-run assistant/recon
   * helpers (feasibility checks, file suggestions) — one-shot HTTP chat
   * completions outside any pool, gone before the run registers. Counting
   * them would add surface for no admission value.
   */
  budgetTelemetry(): {
    budgetPercent: number;
    budgetBytes: number;
    usedBytes: number;
    totalBytes: number;
    ramPercent: number;
    psiSome10: number | null;
    psiFull10: number | null;
    swapTotalBytes: number | null;
    swapFreeBytes: number | null;
    observedAgentMemoryMb: number;
    pressureLevel: number;
    pressureReason: string;
    budgetB: number;
    remaining: number;
    liveRuns: number;
    /** Live agents across all runs INCLUDING reserved judge/merge agents. */
    liveAgents: number;
    /** Live reserved judge/merge agents (9998/9999) across all runs. */
    reservedAgents: number;
    containerAware: boolean;
    hostTotalBytes: number | null;
    hostAvailableBytes: number | null;
    hostClampActive: boolean;
    noKernelCeiling: boolean;
  } {
    const m = this.budget.metrics();
    const status = this.budget.getStatus();
    return {
      budgetPercent: this.budget.budgetPercent(),
      budgetBytes: this.budget.budgetBytes(),
      usedBytes: m.ramUsedBytes,
      totalBytes: m.ramTotalBytes,
      ramPercent: m.ramPercent,
      psiSome10: m.memPressureSome10,
      psiFull10: m.memPressureFull10,
      swapTotalBytes: m.swapTotalBytes,
      swapFreeBytes: m.swapFreeBytes,
      observedAgentMemoryMb: this.budget.observedAgentMemoryMb(),
      pressureLevel: this.lastPressure.level,
      pressureReason: this.lastPressure.reason,
      budgetB: this.lastBudget,
      remaining: this.remaining,
      liveRuns: this.slots.length,
      liveAgents: this.lastActiveTotal,
      reservedAgents: this.lastReservedTotal,
      containerAware: m.containerAware,
      hostTotalBytes: m.hostMemTotalBytes,
      hostAvailableBytes: m.hostMemAvailableBytes,
      hostClampActive: status.hostClampActive ?? false,
      noKernelCeiling: noKernelCeilingWarning(m) !== null,
    };
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
   * Forced to 0 under host pressure (ladder ≥ 2) AND through the post-storm
   * calm window: admitting a NEW run seconds after the guard drained the pool
   * (the incident admitted a 9th project mid-storm) would fight the guard.
   */
  get remaining(): number {
    if (this.lastPressure.level >= 2 || this.ladder.spawnHold()) return 0;
    return this.lastRemaining;
  }

  /**
   * Recompute every run's grant from the current global budget. Pure w.r.t the
   * machine — reads each driver's demand once, syncs the budget's global
   * counts, then distributes top-down by priority.
   */
  recomputeGrants(): void {
    // Order by authoritative priority (lower first); seq breaks ties so the
    // ordering is total and stable across recomputes.
    const ordered = [...this.slots].sort((a, b) => a.priority - b.priority || a.seq - b.seq);

    let activeTotal = 0;
    let pendingTotal = 0;
    let spawningTotal = 0;
    let youngTotal = 0;
    let reservedTotal = 0;
    const demands: number[] = [];
    for (const s of ordered) {
      // Reserved judge/merge agents sit on the ACTIVE side of the budget:
      // their RAM is already in `used` and their slot is in the run's demand,
      // so excluding them under-counted B and inflated `remaining` — the
      // admission signal then pulled in new runs on top of invisible judges.
      const reserved = Math.max(0, s.driver.reservedLiveCount?.() ?? 0);
      const active = s.driver.activeAgentAges().length + reserved;
      const demand = Math.max(0, s.driver.getDemand());
      demands.push(demand);
      activeTotal += active;
      pendingTotal += Math.max(0, demand - active);
      reservedTotal += reserved;
      const stats = s.driver.spawnStats?.();
      if (stats) {
        spawningTotal += Math.max(0, stats.spawning);
        youngTotal += Math.max(0, stats.young);
      }
    }

    // Drive the ONE budget AutoScaler from the SUM across all runs, so
    // targetConcurrency() returns the GLOBAL slot budget — including the
    // reservation charge for spawns/young agents whose RAM `used` can't see yet.
    this.budget.syncCounts(activeTotal, pendingTotal);
    this.budget.syncReservations(spawningTotal, youngTotal);
    this.lastBusyTotal = activeTotal + spawningTotal;
    this.lastActiveTotal = activeTotal;
    this.lastReservedTotal = reservedTotal;
    const B = this.budget.targetConcurrency();
    this.lastBudget = B;

    const granted = distributeBudget(demands, B);
    ordered.forEach((s, i) => {
      const prev = this.grants.get(s.driver.runId) ?? 0;
      this.grants.set(s.driver.runId, granted[i]!);
      // Push the freed slot to its beneficiary: without the nudge the pool
      // sleeps out its 500 ms tick before reading the raised grant. Rise
      // only — a drain is enforced the moment the pool re-reads its grant,
      // and waking it early for that buys nothing.
      if (granted[i]! > prev) s.driver.wakeup?.();
    });

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
    // Lowest priority first (highest priority NUMBER); seq breaks ties.
    const ordered = [...this.slots].sort((a, b) => b.priority - a.priority || b.seq - a.seq);
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
      this.pushMetrics();
      await this.enforceMemoryGuard();
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Forward the budget scaler's single machine read into each subordinate run's
   * dormant scaler, so per-run RAM%/CPU% (and the guard-kill log line, which
   * reads the dormant scaler) stay live instead of frozen at run-start.
   */
  private pushMetrics(): void {
    const m = this.budget.metrics();
    for (const s of this.slots) s.driver.acceptMetrics?.(m);
  }

  /**
   * Graded memory guard. The PressureLadder replaces the single RAM/CPU ≥ 95%
   * trigger (which a swapping host never crosses — it thrash-freezes first):
   *
   *   L1 (used > dial, sustained) — BUDGET ENFORCEMENT: the dial is a contract,
   *      not advice. Preempt the lowest-priority run's newest agent until usage
   *      returns under the dial; damped so each dispose's freed RAM lands in
   *      `used` before the next decision. Never drains the machine below one
   *      live agent — degrade to sequential, never to zero.
   *   L2/L3 (host pressure/thrash: avail+swap floors, PSI full, swap-in, or the
   *      legacy ≥ 95% line) — preempt every tick, with the tick accelerated to
   *      SCHED_PRESSURE_TICK_MS. May drain to zero; the pool self-resumes via
   *      shouldSpawn() once pressure clears (paused agents keep their worktree
   *      + session, so nothing is lost).
   *
   * One preemption per invocation stays the rule — velocity comes from the
   * faster tick, freshness from re-reading metrics between victims. Fase 2.3:
   * PAUSE the victim (preserve worktree + session, resume on headroom) by
   * default; HUU_NO_PAUSE=1 or a driver without pauseAgent ⇒ legacy kill.
   */
  private async enforceMemoryGuard(): Promise<void> {
    // An unstarted budget holds stale constructor-time metrics — never preempt
    // on those (mirrors the legacy shouldDestroy() enabled-gate).
    if (!this.budget.isActive()) return;
    const verdict = this.ladder.evaluate(this.budget.metrics(), this.budget.budgetBytes());
    this.lastPressure = verdict;
    if (verdict.level !== this.lastLoggedPressureLevel) {
      dlog('scheduler', 'pressure_level', {
        level: verdict.level,
        reason: verdict.reason,
        overshootMb: Math.round(verdict.overshootBytes / (1024 * 1024)),
      });
      this.lastLoggedPressureLevel = verdict.level;
    }
    if (verdict.level === 0) return;
    if (!this.ladder.preemptAllowed(verdict.level)) return;

    // L1 progress guarantee: budget enforcement never preempts the LAST live
    // agent on the machine — the system degrades to sequential, not to zero.
    if (verdict.level === 1) {
      const totalActive = this.slots.reduce(
        (n, s) => n + s.driver.activeAgentAges().length,
        0,
      );
      if (totalActive <= 1) return;
    }

    const victim = this.selectGlobalVictim();
    if (!victim) return;
    const key = `${victim.runId}#${victim.agentId}`;
    this.preempting.add(key);
    try {
      dlog('scheduler', 'guard_preempt', {
        level: verdict.level,
        reason: verdict.reason,
        runId: victim.runId,
        agentId: victim.agentId,
      });
      if (this.pauseInsteadOfKill && victim.driver.pauseAgent) {
        await victim.driver.pauseAgent(victim.agentId, verdict.reason);
      } else {
        await victim.driver.destroyAgent(victim.agentId, verdict.reason);
      }
      this.budget.notifyAgentDestroyed();
      this.ladder.notePreempt(verdict.level);
    } finally {
      this.preempting.delete(key);
    }
  }
}
