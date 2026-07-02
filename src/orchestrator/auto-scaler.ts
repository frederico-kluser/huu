import type { SystemMetrics } from '../lib/resource-monitor.js';
import type { AutoScaleStatus } from '../lib/types.js';
import { DEFAULT_RAM_PERCENT, clampPercent, ramBudgetBytes } from '../lib/budget.js';
import { log as dlog } from '../lib/debug-logger.js';

export interface AutoScalerConfig {
  resourceMonitor: () => SystemMetrics;
  /** Seed for the observed per-agent memory estimate (MiB). Default 1536 (pessimistic). */
  agentMemoryEstimateMb?: number;
  /**
   * RAM budget as a percent of total memory — the admission ceiling (replaces
   * the legacy safetyMarginPercent headroom math; see `src/lib/budget.ts`).
   * Default 85. Consumed by targetConcurrency()/headroomCapacity().
   */
  budgetPercent?: number;
  /**
   * Closed-loop controller SETPOINT: the target PSI `some avg10` (%) the adaptive
   * controller drives the machine toward (fill until ~this pressure, no thrash).
   * Default 0.5. The hard spawn freeze sits at `targetPsi × 2` (the cut band);
   * the controller cuts concurrency ×0.5 above the cut band and grows additively
   * below the setpoint. Ignored when PSI is unavailable (memPressureSome10 null).
   */
  targetPsi?: number;
  /**
   * Enable the closed-loop PSI controller (auto mode). Default true. When false,
   * the scaler is open-loop (Fase 1): the concurrency target IS the RAM budget
   * ceiling and the spawn freeze sits at `targetPsi` directly.
   */
  controllerEnabled?: boolean;
  stopThresholdPercent?: number;
  destroyThresholdPercent?: number;
  cooldownMs?: number;
  reEvaluationMs?: number;
  maxAgents?: number;
  /** Memory kept untouched as headroom margin, % of total. Default 10. */
  safetyMarginPercent?: number;
  /** Lower clamp for the observed per-agent estimate (MiB). Default 128. */
  minAgentMemoryMb?: number;
  /** Upper clamp for the observed per-agent estimate (MiB). Default 2048. */
  maxAgentMemoryMb?: number;
  /** EMA smoothing factor for the observed estimate. Default 0.2. */
  emaAlpha?: number;
}

/**
 * 'auto'   — the scaler drives the concurrency target from memory headroom.
 * 'manual' — the user pins concurrency; only the memory guard stays active
 *            (block spawns and kill the newest agent at the destroy threshold).
 * 'greedy' — flood: target one agent per queued task (capped at maxAgents),
 *            ignoring the headroom estimate. The memory guard (kill newest at
 *            the destroy threshold, requeue to TODO) is the sole backstop, so
 *            concurrency settles at ~the destroy threshold. Cooldown-damped:
 *            after a guard kill it waits out the cooldown before re-flooding,
 *            which avoids tight kill→respawn churn at the ceiling.
 */
export type AutoScaleMode = 'auto' | 'manual' | 'greedy';

type AutoScaleState = 'NORMAL' | 'SCALING_UP' | 'BACKING_OFF' | 'COOLDOWN' | 'DESTROYING';

// Pessimistic cold-start seed: a pi-coding-agent's real working set is ~0.5–1.5
// GiB, far above the old 250 MiB seed that let the scaler over-admit dozens of
// agents before the EMA corrected (the OOM incident). Start HIGH and let the
// EMA correct DOWN as real per-agent footprint is observed — admit cautiously,
// open the tap once it's confirmed to fit.
const DEFAULT_AGENT_MEMORY_ESTIMATE_MB = 1536;
const DEFAULT_STOP_THRESHOLD = 90;
const DEFAULT_DESTROY_THRESHOLD = 95;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_RE_EVALUATION_MS = 5_000;
const DEFAULT_MAX_AGENTS = 200;
const DEFAULT_SAFETY_MARGIN_PERCENT = 10;
const DEFAULT_MIN_AGENT_MEMORY_MB = 128;
// Raised 2048 → 4096: an agent whose TOOL SUBPROCESSES (vitest workers, npm
// installs, builds) push its attributed footprint past 2 GiB used to saturate
// the clamp, silently over-admitting — the 33-run freeze. The clamp is a
// sanity bound, not a planning target.
const DEFAULT_MAX_AGENT_MEMORY_MB = 4096;
const DEFAULT_EMA_ALPHA = 0.2;
/**
 * Asymmetric EMA (used when the caller does NOT pin `emaAlpha`): track UP fast,
 * DOWN slowly. Underestimating the footprint is the fatal failure mode (it
 * over-admits into an OOM/thrash); overestimating only costs idle slots for a
 * while. An explicit `emaAlpha` (env knob / caller config) restores the legacy
 * symmetric behavior.
 */
const DEFAULT_EMA_ALPHA_UP = 0.5;
const DEFAULT_EMA_ALPHA_DOWN = 0.05;
/**
 * An agent younger than this is still GROWING toward its steady-state working
 * set (a pi agent ramps for many seconds after spawn), so (a) it is charged
 * against the budget as a reservation rather than trusted to `used`, and (b)
 * the footprint EMA never samples while one is present — young agents look
 * cheap and used to drag the estimate down, re-opening admission that the
 * grown agents then blew through (the over-admission spiral).
 */
export const MATURE_AGE_MS = 45_000;
/**
 * Closed-loop PSI controller (Fase 2.2 — senpai/TMO + Netflix AIMD/Vegas). The
 * controller drives a `controlledLimit` toward the RAM budget ceiling using PSI
 * as feedback: grow additively while pressure is below the setpoint, cut
 * multiplicatively above the cut band, hold in between. PSI rises BEFORE RAM%
 * saturates, so this fills the machine to ~the setpoint without thrash.
 */
const DEFAULT_TARGET_PSI = 0.5; // setpoint: target `some avg10` (%)
const PSI_CUT_BAND_MULT = 2; // cut + hard-freeze at targetPsi × this (= 1%)
const VEGAS_ALPHA_MIN = 3; // additive-increase floor (Vegas alpha)
const VEGAS_ALPHA_FRAC = 0.1; // additive increase = 10% of the current limit
const AIMD_CUT = 0.5; // multiplicative decrease on a pressure cut
const CONTROLLER_HOLD_MS = 5_000; // suppress re-ramp for ~5 ticks after a cut
const POLL_INTERVAL_MS = 1_000;
/**
 * Adaptive cadence: when usage nears the budget or PSI warms up, sample at
 * 250 ms instead of 1 s. The 1 Hz poll left a window in which N runs' spawn
 * bursts were all admitted against the SAME stale reading; near the edge the
 * window must shrink faster than the burst can grow.
 */
const PRESSURE_POLL_INTERVAL_MS = 250;
/**
 * Relief valve for the mature-cohort EMA gate: pipelines whose tasks finish in
 * under MATURE_AGE_MS never present a mature cohort, which would pin the
 * estimate at the pessimistic seed FOREVER (permanent under-admission for
 * fast/stub workloads). Accept one young-cohort sample per this window — at
 * the slow DOWN alpha that drifts ≤5% per window, far too slow to re-open the
 * over-admission spiral — and trust the estimate (drop the seed floor) after
 * EMA_RELIEF_TRUST_SAMPLES consecutive windows of evidence.
 */
const EMA_RELIEF_MS = 120_000;
const EMA_RELIEF_TRUST_SAMPLES = 5;
const MIB = 1024 * 1024;

export class AutoScaler {
  private config: Required<AutoScalerConfig>;
  private currentMetrics: SystemMetrics;
  private state: AutoScaleState = 'NORMAL';
  private enabled = false;
  private mode: AutoScaleMode = 'auto';
  private activeAgentCount = 0;
  private pendingTaskCount = 0;
  /**
   * Reservation accounting (the burst-overshoot fix): agents whose RAM is not
   * yet (fully) visible in `ramUsedBytes`. `spawningCount` = spawn in flight
   * (invisible until the next sample); `youngCount` = live but younger than
   * MATURE_AGE_MS (partially materialized, still growing). Both charge the
   * budget in budgetAdditional().
   */
  private spawningCount = 0;
  private youngCount = 0;
  /** True once the EMA has accepted at least one mature-cohort sample. */
  private emaHasMatureSample = false;
  /** Last accepted EMA sample (any kind) — paces the young-cohort relief valve. */
  private lastEmaSampleAt = 0;
  /** Consecutive relief-valve samples — trust the EMA after enough evidence. */
  private reliefSampleCount = 0;
  /** Last 1 Hz control tick — the fast pressure poll must not speed up the
      controller/EMA, whose constants are tuned per-second. */
  private lastSlowTickAt = 0;
  /** Whether the caller pinned emaAlpha (legacy symmetric smoothing). */
  private readonly emaAlphaExplicit: boolean;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownEndAt = 0;
  private destroyedAt = 0;
  /**
   * RAM in use when no agents were running — everything above it is
   * attributed to the agents. Re-captured whenever the pool drains to zero.
   */
  private baselineUsedBytes: number | null = null;
  /** EMA of the observed per-agent memory footprint, in bytes. */
  private observedAgentBytes: number;
  private guardKillCount = 0;
  /**
   * Closed-loop controller state (Fase 2.2). The PSI-driven concurrency target,
   * bounded by the RAM budget ceiling. 0 = not yet seeded (first poll seeds it to
   * the budget ceiling). `controllerHoldUntil` suppresses re-ramp after a cut.
   */
  private controlledLimit = 0;
  private controllerHoldUntil = 0;

  constructor(config: AutoScalerConfig) {
    this.config = {
      resourceMonitor: config.resourceMonitor,
      agentMemoryEstimateMb: config.agentMemoryEstimateMb ?? DEFAULT_AGENT_MEMORY_ESTIMATE_MB,
      budgetPercent: config.budgetPercent ?? DEFAULT_RAM_PERCENT,
      targetPsi: config.targetPsi ?? DEFAULT_TARGET_PSI,
      controllerEnabled: config.controllerEnabled ?? true,
      stopThresholdPercent: config.stopThresholdPercent ?? DEFAULT_STOP_THRESHOLD,
      destroyThresholdPercent: config.destroyThresholdPercent ?? DEFAULT_DESTROY_THRESHOLD,
      cooldownMs: config.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      reEvaluationMs: config.reEvaluationMs ?? DEFAULT_RE_EVALUATION_MS,
      maxAgents: config.maxAgents ?? DEFAULT_MAX_AGENTS,
      safetyMarginPercent: config.safetyMarginPercent ?? DEFAULT_SAFETY_MARGIN_PERCENT,
      minAgentMemoryMb: config.minAgentMemoryMb ?? DEFAULT_MIN_AGENT_MEMORY_MB,
      maxAgentMemoryMb: config.maxAgentMemoryMb ?? DEFAULT_MAX_AGENT_MEMORY_MB,
      emaAlpha: config.emaAlpha ?? DEFAULT_EMA_ALPHA,
    };
    this.currentMetrics = config.resourceMonitor();
    this.observedAgentBytes = this.config.agentMemoryEstimateMb * MIB;
    this.emaAlphaExplicit = config.emaAlpha !== undefined;
  }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.baselineUsedBytes = this.currentMetrics.ramUsedBytes;
    // The young-cohort relief valve opens only after a FULL window of runtime
    // — the cold start (the over-admission spiral's window) stays protected.
    this.lastEmaSampleAt = Date.now();
    // One structured line per scaler start so RAM-tuning sessions can see the
    // EFFECTIVE memory model (seed/alpha/clamps/budget) a run began with.
    dlog('scaler', 'config', {
      seedMb: this.config.agentMemoryEstimateMb,
      emaAlpha: this.emaAlphaExplicit ? this.config.emaAlpha : null,
      minMb: this.config.minAgentMemoryMb,
      maxMb: this.config.maxAgentMemoryMb,
      budgetPercent: this.config.budgetPercent,
      targetPsi: this.config.targetPsi,
    });
    this.pollMetrics();
    this.schedulePoll();
  }

  /**
   * Self-rescheduling poll with ADAPTIVE cadence: 1 Hz at rest, 250 ms once
   * usage nears the budget or PSI warms up — the stale-reading window between
   * samples must shrink faster than a multi-run spawn burst can grow.
   */
  private schedulePoll(): void {
    if (!this.enabled) return;
    this.pollTimer = setTimeout(() => {
      this.pollMetrics();
      this.schedulePoll();
    }, this.pollDelayMs());
    this.pollTimer.unref?.();
  }

  private pollDelayMs(): number {
    const { ramTotalBytes, ramUsedBytes, memPressureSome10 } = this.currentMetrics;
    const budgetBytes = ramBudgetBytes(ramTotalBytes, this.config.budgetPercent);
    const nearBudget = budgetBytes > 0 && ramUsedBytes > budgetBytes * 0.8;
    const psiWarm =
      memPressureSome10 !== null && memPressureSome10 >= this.config.targetPsi / 2;
    return nearBudget || psiWarm ? PRESSURE_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
  }

  stop(): void {
    this.enabled = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.state = 'NORMAL';
    this.cooldownEndAt = 0;
    this.destroyedAt = 0;
    this.baselineUsedBytes = null;
  }

  setMode(mode: AutoScaleMode): void {
    this.mode = mode;
  }

  /** Update the RAM budget percent (the machine-global dial changed at runtime). */
  setBudgetPercent(pct: number): void {
    this.config.budgetPercent = clampPercent(pct);
  }

  getMode(): AutoScaleMode {
    return this.mode;
  }

  /** True while start()ed (polling and holding fresh metrics), any mode. */
  isActive(): boolean {
    return this.enabled;
  }

  /**
   * Hard spawn-freeze PSI threshold. With the controller ON, it sits at the cut
   * band (`targetPsi × 2`) so the controller can operate AT its setpoint without
   * the binary gate fighting it; OFF (open-loop / Fase 1) it sits at the setpoint.
   */
  private psiFreezeThreshold(): number {
    return this.config.controllerEnabled
      ? this.config.targetPsi * PSI_CUT_BAND_MULT
      : this.config.targetPsi;
  }

  shouldSpawn(): boolean {
    if (!this.enabled) return true; // not polling — never gate the pool
    const { cpuPercent, ramPercent, memPressureSome10 } = this.currentMetrics;
    if (this.mode === 'manual') {
      // Guard-only: respect the user's pinned concurrency unless memory is
      // already at the destroy threshold (spawning would kill someone else).
      // PSI does NOT gate manual — the user asked for an exact pool size.
      return ramPercent < this.config.destroyThresholdPercent;
    }
    // PSI front-brake (auto + greedy): freeze admission once memory pressure
    // crosses the threshold. PSI rises BEFORE RAM% saturates, so this catches a
    // burst the lagging RAM gate would miss. Null PSI (macOS / no CONFIG_PSI /
    // unreadable) → skip and fall back to the RAM gate below.
    const psiBlocked =
      memPressureSome10 !== null && memPressureSome10 >= this.psiFreezeThreshold();
    if (this.mode === 'greedy') {
      // BUDGET-GREEDY: flood one agent per queued task, but only while the RAM
      // BUDGET (the dial) still has headroom — MAX means "fill the ceiling I
      // configured aggressively", not "ignore the ceiling". The old greedy
      // flooded to the 95% destroy line, which a swapping host reaches only
      // after it is already thrashing (the 33-run freeze). Reservations for
      // in-flight spawns are charged, so a burst can't overshoot the dial.
      // Damped: hold off while cooling down from the last guard kill.
      if (this.state === 'COOLDOWN') return false;
      if (psiBlocked) return false;
      if (this.budgetAdditional() <= 0) return false;
      const { destroyThresholdPercent } = this.config;
      return cpuPercent < destroyThresholdPercent && ramPercent < destroyThresholdPercent;
    }
    if (this.state === 'COOLDOWN') return false;
    if (psiBlocked) return false;
    const { stopThresholdPercent } = this.config;
    if (cpuPercent >= stopThresholdPercent || ramPercent >= stopThresholdPercent) {
      return false;
    }
    return true;
  }

  shouldDestroy(): boolean {
    if (!this.enabled) return false;
    if (this.activeAgentCount <= 0) return false;
    const { cpuPercent, ramPercent } = this.currentMetrics;
    const { destroyThresholdPercent } = this.config;
    return cpuPercent >= destroyThresholdPercent || ramPercent >= destroyThresholdPercent;
  }

  /**
   * The per-agent byte figure admission plans with. Until the EMA has accepted
   * at least one MATURE-cohort sample, the pessimistic seed acts as a floor —
   * early samples of still-growing agents used to drag the estimate down and
   * re-open admission (the over-admission spiral). Once a mature sample exists
   * the EMA is trusted both ways, so genuinely-small agents (stub runs) still
   * open the tap.
   */
  private chargeBytes(): number {
    if (this.emaHasMatureSample) return this.observedAgentBytes;
    return Math.max(this.observedAgentBytes, this.config.agentMemoryEstimateMb * MIB);
  }

  /**
   * How many MORE agents fit under the RAM BUDGET (the % dial — now the
   * admission invariant, replacing the legacy available−margin headroom):
   *
   *   budget     = ramBudgetBytes(total, budgetPercent)   // % of total, OS-reserve-floored
   *   reserved   = spawning × charge + young × charge/2
   *   headroom   = max(0, budget − used − reserved)
   *   additional = floor(headroom / charge)
   *
   * Uses ramUsedBytes (real used, cgroup-aware) vs the budget, NOT
   * ramAvailableBytes vs a margin. The reservation term is the burst-overshoot
   * fix: an in-flight spawn is invisible to `used` until the next sample and a
   * young agent has only partially materialized, yet both WILL grow to ~charge
   * bytes — without the reservation, N runs each admit against the same stale
   * reading and the budget is blown before it is ever observed.
   */
  private budgetAdditional(): number {
    const { ramTotalBytes, ramUsedBytes } = this.currentMetrics;
    const budgetBytes = ramBudgetBytes(ramTotalBytes, this.config.budgetPercent);
    const charge = this.chargeBytes();
    const reserved = this.spawningCount * charge + Math.ceil((this.youngCount * charge) / 2);
    const headroom = Math.max(0, budgetBytes - ramUsedBytes - reserved);
    return Math.floor(headroom / charge);
  }

  /**
   * active + how many more fit under the RAM budget, capped at maxAgents — the
   * HARD RAM ceiling the closed-loop controller operates strictly within.
   */
  private budgetCeiling(): number {
    return Math.max(
      1,
      Math.min(this.activeAgentCount + this.budgetAdditional(), this.config.maxAgents),
    );
  }

  /**
   * The concurrency limit to admit up to. When the closed-loop controller is
   * actively driving (auto + enabled + PSI available), this is the poll-managed
   * `controlledLimit`. Otherwise it is the RAM budget ceiling computed LIVE — so
   * the open-loop path (PSI unavailable / controller off, and the multi-run
   * scheduler that calls syncCounts()+targetConcurrency() synchronously each
   * tick) reflects the current counts immediately, exactly like Fase 1.
   */
  private effectiveLimit(): number {
    const controllerActive =
      this.config.controllerEnabled &&
      this.mode === 'auto' &&
      this.currentMetrics.memPressureSome10 !== null;
    if (controllerActive && this.controlledLimit >= 1) return this.controlledLimit;
    return this.budgetCeiling();
  }

  /**
   * Closed-loop PSI controller (Fase 2.2 — senpai/TMO + Netflix AIMD/Vegas).
   * Drives `controlledLimit` toward the RAM budget ceiling: ADDITIVE increase
   * below the setpoint, MULTIPLICATIVE cut above the cut band, HOLD in the
   * hysteresis band between. The RAM budget is the hard ceiling — the controller
   * never exceeds it. Open-loop fallback (Fase 1: target = budget ceiling) when
   * the controller is off, the mode isn't auto, or PSI is unavailable.
   */
  private updateController(): void {
    const ceiling = this.budgetCeiling();
    const psi = this.currentMetrics.memPressureSome10;
    if (!this.config.controllerEnabled || this.mode !== 'auto' || psi === null) {
      this.controlledLimit = ceiling;
      return;
    }
    if (this.controlledLimit < 1) this.controlledLimit = ceiling; // first-poll seed
    const cutBand = this.config.targetPsi * PSI_CUT_BAND_MULT;
    if (psi >= cutBand) {
      // Multiplicative decrease + brief no-ramp hold (anti-oscillation).
      this.controlledLimit = Math.max(1, Math.floor(this.controlledLimit * AIMD_CUT));
      this.controllerHoldUntil = Date.now() + CONTROLLER_HOLD_MS;
    } else if (
      psi < this.config.targetPsi &&
      this.state !== 'COOLDOWN' &&
      Date.now() >= this.controllerHoldUntil
    ) {
      // Additive increase (Vegas alpha) while there's headroom and no recent cut.
      const alpha = Math.max(VEGAS_ALPHA_MIN, Math.ceil(VEGAS_ALPHA_FRAC * this.controlledLimit));
      this.controlledLimit += alpha;
    }
    // else: hysteresis band (targetPsi ≤ psi < cutBand) → hold.
    // The RAM budget is the hard ceiling; PSI controls strictly WITHIN it.
    this.controlledLimit = Math.max(1, Math.min(this.controlledLimit, ceiling));
  }

  /**
   * Admission target: active agents plus how many more fit under the RAM budget,
   * capped by pending work (never over-provision idle slots) and maxAgents;
   * never below 1 so the run always makes progress.
   */
  targetConcurrency(): number {
    const { maxAgents } = this.config;
    if (this.mode === 'greedy') {
      // Flood: aim for one agent per queued task (never over-provision idle
      // slots), capped only by the hard ceiling. No budget estimate — the
      // memory guard is what holds the line. shouldSpawn() still gates each
      // actual spawn at the destroy threshold (and PSI).
      const ceiling = this.pendingTaskCount > 0
        ? Math.min(this.activeAgentCount + this.pendingTaskCount, maxAgents)
        : maxAgents;
      return Math.max(1, ceiling);
    }
    const demandCeiling = this.pendingTaskCount > 0
      ? Math.min(this.activeAgentCount + this.pendingTaskCount, maxAgents)
      : maxAgents;
    return Math.max(1, Math.min(this.effectiveLimit(), demandCeiling));
  }

  /**
   * Budget capacity WITHOUT the demand ceiling: active agents plus how many more
   * fit under the RAM budget, capped only by maxAgents (never by pending work).
   * `targetConcurrency()` is this clamped down to actual demand; the
   * GlobalScheduler compares THIS to total demand to learn whether the machine
   * could absorb another admitted run (its admission signal).
   */
  headroomCapacity(): number {
    const { maxAgents } = this.config;
    if (this.mode === 'greedy') return maxAgents;
    return Math.max(1, Math.min(this.effectiveLimit(), maxAgents));
  }

  /** Observed per-agent memory footprint in MiB (EMA, clamped). */
  observedAgentMemoryMb(): number {
    return Math.round(this.observedAgentBytes / MIB);
  }

  /** The RAM budget in bytes under the current dial (0 when totals unknown). */
  budgetBytes(): number {
    return ramBudgetBytes(this.currentMetrics.ramTotalBytes, this.config.budgetPercent);
  }

  /** Current dial percent (clamped). */
  budgetPercent(): number {
    return this.config.budgetPercent;
  }

  /** The per-agent planning charge in bytes (EMA, seed-floored until mature). */
  plannedChargeBytes(): number {
    return this.chargeBytes();
  }

  /**
   * RAM bytes still free under the budget dial with reservations charged —
   * the byte-denominated admission signal (slots = this ÷ charge).
   */
  headroomBytesRemaining(): number {
    const { ramTotalBytes, ramUsedBytes } = this.currentMetrics;
    const budgetBytes = ramBudgetBytes(ramTotalBytes, this.config.budgetPercent);
    const charge = this.chargeBytes();
    const reserved = this.spawningCount * charge + Math.ceil((this.youngCount * charge) / 2);
    return Math.max(0, budgetBytes - ramUsedBytes - reserved);
  }

  notifyAgentDestroyed(): void {
    this.activeAgentCount = Math.max(0, this.activeAgentCount - 1);
    this.guardKillCount++;
    this.state = 'COOLDOWN';
    this.destroyedAt = Date.now();
    this.cooldownEndAt = Date.now() + this.config.cooldownMs;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }
    this.cooldownTimer = setTimeout(() => {
      if (this.state === 'COOLDOWN') {
        this.state = 'NORMAL';
      }
      this.cooldownTimer = null;
    }, this.config.cooldownMs);
  }

  notifyAgentSpawned(): void {
    this.activeAgentCount++;
  }

  notifyAgentCompleted(): void {
    this.activeAgentCount = Math.max(0, this.activeAgentCount - 1);
  }

  notifyTaskQueued(count: number): void {
    this.pendingTaskCount = count;
  }

  /**
   * Overwrite the active/pending counts directly. Used by the GlobalScheduler,
   * which drives ONE budget AutoScaler from the SUM of every run's counts each
   * tick — `targetConcurrency()` then returns the GLOBAL slot budget and
   * `shouldDestroy()` reflects global pressure. Single-run orchestrators keep
   * using notifyAgentSpawned/Completed + notifyTaskQueued and never call this.
   */
  syncCounts(activeTotal: number, pendingTotal: number): void {
    this.activeAgentCount = Math.max(0, Math.floor(activeTotal));
    this.pendingTaskCount = Math.max(0, Math.floor(pendingTotal));
  }

  /**
   * Report in-flight spawn + young-agent counts for reservation accounting
   * (see budgetAdditional). Called each tick by BOTH paths: the single-run
   * pool loop with its own counts, and the GlobalScheduler with the sums
   * across all subordinate runs. Also gates the footprint EMA — while any
   * spawn is in flight or any agent is young, the cohort is not mature and
   * sampling would understate the real footprint.
   */
  syncReservations(spawningCount: number, youngCount: number): void {
    this.spawningCount = Math.max(0, Math.floor(spawningCount));
    this.youngCount = Math.max(0, Math.floor(youngCount));
  }

  /**
   * Inject externally-sampled metrics instead of polling this scaler's own
   * resourceMonitor. In multi-run mode the GlobalScheduler owns the single
   * SystemMetricsSampler and forwards its reading to each subordinate run's
   * DORMANT scaler, so per-run AutoScaleStatus (the RAM%/CPU% the UI shows)
   * stays live without every scaler independently polling the machine — which
   * would corrupt the shared CPU delta. Display-only: a dormant scaler is
   * never `start()`ed, so this never drives a spawn/kill decision.
   */
  acceptMetrics(metrics: SystemMetrics): void {
    this.currentMetrics = metrics;
  }

  /**
   * The latest metrics this scaler is working from. The GlobalScheduler reads
   * its budget scaler's metrics once per tick and pushes them into each
   * subordinate run's dormant scaler via {@link acceptMetrics}, so per-run
   * RAM%/CPU% displays stay live without every scaler polling the machine.
   */
  metrics(): SystemMetrics {
    return this.currentMetrics;
  }

  getStatus(): AutoScaleStatus {
    const now = Date.now();
    const cooldownRemainingMs = this.cooldownEndAt > now ? this.cooldownEndAt - now : 0;
    return {
      enabled: this.enabled && this.mode === 'auto',
      mode: this.mode,
      state: this.state,
      cooldownRemainingMs,
      cpuPercent: this.currentMetrics.cpuPercent,
      ramPercent: this.currentMetrics.ramPercent,
      observedAgentMemoryMb: this.observedAgentMemoryMb(),
      ramAvailableMb: Math.round(this.currentMetrics.ramAvailableBytes / MIB),
      guardKillCount: this.guardKillCount,
      controlledLimit: this.effectiveLimit(),
      targetPsi: this.config.targetPsi,
    };
  }

  private pollMetrics(): void {
    this.currentMetrics = this.config.resourceMonitor();
    // The adaptive 250 ms cadence exists so the GATES see fresh data near the
    // edge — the controller's additive step and the EMA alphas are tuned for
    // 1 Hz, so those run on a SLOW tick regardless of the poll rate (4× the
    // Vegas increase per second would overshoot into the cut band exactly
    // when the machine is near the budget).
    const now = Date.now();
    const slowTick = now - this.lastSlowTickAt >= POLL_INTERVAL_MS;
    if (slowTick) {
      this.lastSlowTickAt = now;
      this.sampleObservedAgentMemory();
    }
    const { cpuPercent, ramPercent } = this.currentMetrics;
    const { stopThresholdPercent, destroyThresholdPercent } = this.config;

    if (this.state === 'COOLDOWN') {
      if (cpuPercent >= destroyThresholdPercent || ramPercent >= destroyThresholdPercent) {
        this.state = 'DESTROYING';
      } else if (Date.now() >= this.cooldownEndAt) {
        this.state = 'NORMAL';
      }
      // No early return: the closed-loop PSI controller still updates below (it
      // may cut on pressure, but won't re-ramp while state === 'COOLDOWN').
    } else if (cpuPercent >= destroyThresholdPercent || ramPercent >= destroyThresholdPercent) {
      this.state = 'DESTROYING';
    } else if (cpuPercent >= stopThresholdPercent || ramPercent >= stopThresholdPercent) {
      this.state = 'BACKING_OFF';
    } else {
      this.state = 'NORMAL';
    }

    if (slowTick) this.updateController();
  }

  /**
   * Feed the EMA with (used − baseline) / activeAgents. The baseline is the
   * usage with zero agents running, re-captured whenever the pool drains so
   * unrelated host activity doesn't permanently skew the attribution.
   *
   * MATURE-COHORT GATE: never sample while a spawn is in flight or any agent is
   * younger than MATURE_AGE_MS — young agents look cheap and used to drag the
   * estimate down exactly when admission decisions mattered most (the N-run
   * cold start). Under constant churn the EMA simply holds its last (or seed)
   * value — pessimistic, which is the safe direction.
   *
   * ASYMMETRIC SMOOTHING (unless the caller pinned emaAlpha): track UP fast
   * (underestimating over-admits into a freeze), DOWN slowly (overestimating
   * only costs idle slots).
   */
  private sampleObservedAgentMemory(): void {
    const { ramUsedBytes } = this.currentMetrics;
    if (this.activeAgentCount <= 0) {
      this.baselineUsedBytes = ramUsedBytes;
      return;
    }
    if (this.baselineUsedBytes === null) {
      this.baselineUsedBytes = ramUsedBytes;
      return;
    }
    const youngCohort = this.spawningCount > 0 || this.youngCount > 0;
    if (youngCohort) {
      // Relief valve: fast tasks never present a mature cohort — without it
      // the estimate would pin at the seed forever. One sample per window.
      if (Date.now() - this.lastEmaSampleAt < EMA_RELIEF_MS) return;
    }
    const sample = (ramUsedBytes - this.baselineUsedBytes) / this.activeAgentCount;
    if (sample <= 0) return;
    const { minAgentMemoryMb, maxAgentMemoryMb } = this.config;
    const emaAlpha = this.emaAlphaExplicit
      ? this.config.emaAlpha
      : sample >= this.observedAgentBytes
        ? DEFAULT_EMA_ALPHA_UP
        : DEFAULT_EMA_ALPHA_DOWN;
    const prev = this.observedAgentBytes;
    const next = emaAlpha * sample + (1 - emaAlpha) * this.observedAgentBytes;
    this.observedAgentBytes = Math.min(
      maxAgentMemoryMb * MIB,
      Math.max(minAgentMemoryMb * MIB, next),
    );
    this.lastEmaSampleAt = Date.now();
    if (!youngCohort) {
      this.emaHasMatureSample = true;
      this.reliefSampleCount = 0;
    } else if (!this.emaHasMatureSample) {
      // Enough consecutive relief windows = the young cohort IS the steady
      // state (fast tasks) — trust the estimate, drop the seed floor.
      this.reliefSampleCount++;
      if (this.reliefSampleCount >= EMA_RELIEF_TRUST_SAMPLES) this.emaHasMatureSample = true;
    }
    // Observability for seed calibration: log SIGNIFICANT footprint moves only
    // (≥64MiB or ≥10% of the prior estimate) so the 1 Hz poll stays quiet.
    const deltaBytes = Math.abs(this.observedAgentBytes - prev);
    if (deltaBytes >= 64 * MIB || deltaBytes >= prev * 0.1) {
      dlog('scaler', 'ema_move', {
        fromMb: Math.round(prev / MIB),
        toMb: Math.round(this.observedAgentBytes / MIB),
        activeAgents: this.activeAgentCount,
      });
    }
  }
}
