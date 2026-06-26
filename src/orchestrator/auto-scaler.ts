import type { SystemMetrics } from '../lib/resource-monitor.js';
import type { AutoScaleStatus } from '../lib/types.js';

export interface AutoScalerConfig {
  resourceMonitor: () => SystemMetrics;
  /** Seed for the observed per-agent memory estimate (MiB). Default 250. */
  agentMemoryEstimateMb?: number;
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

const DEFAULT_AGENT_MEMORY_ESTIMATE_MB = 250;
const DEFAULT_STOP_THRESHOLD = 90;
const DEFAULT_DESTROY_THRESHOLD = 95;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_RE_EVALUATION_MS = 5_000;
const DEFAULT_MAX_AGENTS = 200;
const DEFAULT_SAFETY_MARGIN_PERCENT = 10;
const DEFAULT_MIN_AGENT_MEMORY_MB = 128;
const DEFAULT_MAX_AGENT_MEMORY_MB = 2048;
const DEFAULT_EMA_ALPHA = 0.2;
/** The percent margin never shrinks below this absolute floor. */
const MIN_SAFETY_MARGIN_BYTES = 512 * 1024 * 1024;
const POLL_INTERVAL_MS = 1_000;
const MIB = 1024 * 1024;

export class AutoScaler {
  private config: Required<AutoScalerConfig>;
  private currentMetrics: SystemMetrics;
  private state: AutoScaleState = 'NORMAL';
  private enabled = false;
  private mode: AutoScaleMode = 'auto';
  private activeAgentCount = 0;
  private pendingTaskCount = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
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

  constructor(config: AutoScalerConfig) {
    this.config = {
      resourceMonitor: config.resourceMonitor,
      agentMemoryEstimateMb: config.agentMemoryEstimateMb ?? DEFAULT_AGENT_MEMORY_ESTIMATE_MB,
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
  }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.baselineUsedBytes = this.currentMetrics.ramUsedBytes;
    this.pollMetrics();
    this.pollTimer = setInterval(() => this.pollMetrics(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.enabled = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
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

  getMode(): AutoScaleMode {
    return this.mode;
  }

  shouldSpawn(): boolean {
    if (!this.enabled) return true; // not polling — never gate the pool
    const { cpuPercent, ramPercent } = this.currentMetrics;
    if (this.mode === 'manual') {
      // Guard-only: respect the user's concurrency choice unless memory is
      // already at the destroy threshold (spawning would kill someone else).
      return ramPercent < this.config.destroyThresholdPercent;
    }
    if (this.mode === 'greedy') {
      // Flood up to the destroy threshold, then let the guard reclaim. Gate on
      // both CPU and RAM so the spawn line matches shouldDestroy()'s (CPU OR
      // RAM ≥ threshold) — otherwise we'd respawn into a CPU-driven kill.
      // Damped: hold off while cooling down from the last guard kill.
      if (this.state === 'COOLDOWN') return false;
      const { destroyThresholdPercent } = this.config;
      return cpuPercent < destroyThresholdPercent && ramPercent < destroyThresholdPercent;
    }
    if (this.state === 'COOLDOWN') return false;
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
   * Memory-headroom admission: how many agents fit in the claimable memory
   * after reserving a safety margin, on top of the ones already running.
   *
   *   margin     = max(total × safetyMarginPercent, 512 MiB)
   *   headroom   = max(0, available − margin)
   *   additional = floor(headroom / observedAgentBytes)
   *
   * Capped by pending work (never over-provision idle slots) and maxAgents;
   * never below 1 so the run always makes progress.
   */
  targetConcurrency(): number {
    const { ramTotalBytes, ramAvailableBytes } = this.currentMetrics;
    const { safetyMarginPercent, maxAgents } = this.config;
    if (this.mode === 'greedy') {
      // Flood: aim for one agent per queued task (never over-provision idle
      // slots), capped only by the hard ceiling. No headroom estimate — the
      // memory guard is what holds the line. shouldSpawn() still gates each
      // actual spawn at the destroy threshold.
      const ceiling = this.pendingTaskCount > 0
        ? Math.min(this.activeAgentCount + this.pendingTaskCount, maxAgents)
        : maxAgents;
      return Math.max(1, ceiling);
    }
    const margin = Math.max(
      ramTotalBytes * (safetyMarginPercent / 100),
      MIN_SAFETY_MARGIN_BYTES,
    );
    const headroom = Math.max(0, ramAvailableBytes - margin);
    const additional = Math.floor(headroom / this.observedAgentBytes);
    const ceiling = this.pendingTaskCount > 0
      ? Math.min(this.activeAgentCount + this.pendingTaskCount, maxAgents)
      : maxAgents;
    return Math.max(1, Math.min(this.activeAgentCount + additional, ceiling));
  }

  /**
   * Memory-headroom capacity WITHOUT the demand ceiling: active agents plus how
   * many more fit in the claimable RAM, capped only by maxAgents (never by
   * pending work). `targetConcurrency()` is this clamped down to actual demand;
   * the GlobalScheduler compares THIS to total demand to learn whether the
   * machine could absorb another admitted run (its admission signal).
   */
  headroomCapacity(): number {
    const { maxAgents } = this.config;
    if (this.mode === 'greedy') return maxAgents;
    const { ramTotalBytes, ramAvailableBytes } = this.currentMetrics;
    const margin = Math.max(
      ramTotalBytes * (this.config.safetyMarginPercent / 100),
      MIN_SAFETY_MARGIN_BYTES,
    );
    const headroom = Math.max(0, ramAvailableBytes - margin);
    const additional = Math.floor(headroom / this.observedAgentBytes);
    return Math.max(1, Math.min(this.activeAgentCount + additional, maxAgents));
  }

  /** Observed per-agent memory footprint in MiB (EMA, clamped). */
  observedAgentMemoryMb(): number {
    return Math.round(this.observedAgentBytes / MIB);
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
    };
  }

  private pollMetrics(): void {
    this.currentMetrics = this.config.resourceMonitor();
    this.sampleObservedAgentMemory();
    const { cpuPercent, ramPercent } = this.currentMetrics;
    const { stopThresholdPercent, destroyThresholdPercent } = this.config;

    if (this.state === 'COOLDOWN') {
      if (cpuPercent >= destroyThresholdPercent || ramPercent >= destroyThresholdPercent) {
        this.state = 'DESTROYING';
      } else if (Date.now() >= this.cooldownEndAt) {
        this.state = 'NORMAL';
      }
      return;
    }

    if (cpuPercent >= destroyThresholdPercent || ramPercent >= destroyThresholdPercent) {
      this.state = 'DESTROYING';
    } else if (cpuPercent >= stopThresholdPercent || ramPercent >= stopThresholdPercent) {
      this.state = 'BACKING_OFF';
    } else {
      this.state = 'NORMAL';
    }
  }

  /**
   * Feed the EMA with (used − baseline) / activeAgents. The baseline is the
   * usage with zero agents running, re-captured whenever the pool drains so
   * unrelated host activity doesn't permanently skew the attribution.
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
    const sample = (ramUsedBytes - this.baselineUsedBytes) / this.activeAgentCount;
    if (sample <= 0) return;
    const { emaAlpha, minAgentMemoryMb, maxAgentMemoryMb } = this.config;
    const next = emaAlpha * sample + (1 - emaAlpha) * this.observedAgentBytes;
    this.observedAgentBytes = Math.min(
      maxAgentMemoryMb * MIB,
      Math.max(minAgentMemoryMb * MIB, next),
    );
  }
}
