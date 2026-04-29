import {
  makeCpuSampler,
  readDiskUsage,
  readSystemMetrics,
  type CpuSamplerState,
  type SystemMetrics,
} from '../lib/system-metrics.js';
import type { Orchestrator } from './index.js';

export interface AutoscalerOptions {
  /** Decision-tick period when no trip-wire is firing. Default 5000 ms. */
  cycleMs?: number;
  /** Metrics sampling period. Drives EMA smoothing and trip-wire detection. Default 1000 ms. */
  metricsIntervalMs?: number;
  /** Estimated RAM cost per agent at launch. Default 500 MiB. */
  agentCostBytes?: number;
  /** Target memory utilization for the scale-up calc — buffer below hardStopPct. Default 80%. */
  scaleUpTargetPct?: number;
  /** Above this on either CPU EMA or memory, do not create new agents. Default 90%. */
  hardStopPct?: number;
  /** Above this, kill the newest agent (re-enqueue) and start the kill cooldown. Default 95%. */
  tripWirePct?: number;
  /**
   * Cooldown after a kill before another kill is allowed. The user requested
   * "5 s if no improvement"; same value as the decision cycle. Default 5000 ms.
   */
  killCooldownMs?: number;
  /** EMA factor for CPU smoothing (α). Mem is unsmoothed. Default 0.3. */
  cpuEmaAlpha?: number;
  /** Disk usage threshold above which scale-up is blocked. Default 90%. */
  diskHardStopPct?: number;
  /** Disk usage above which the trip-wire fires. Default 95%. */
  diskTripWirePct?: number;
  /** Path to monitor for disk pressure (typically the worktree base dir). */
  diskPath?: string;
}

const DEFAULTS: Required<Omit<AutoscalerOptions, 'diskPath'>> = {
  cycleMs: 5000,
  metricsIntervalMs: 1000,
  agentCostBytes: 500 * 1024 * 1024,
  scaleUpTargetPct: 80,
  hardStopPct: 90,
  tripWirePct: 95,
  killCooldownMs: 5000,
  cpuEmaAlpha: 0.3,
  diskHardStopPct: 90,
  diskTripWirePct: 95,
};

interface AutoscalerLogger {
  log(entry: { level: 'info' | 'warn' | 'error'; message: string }): void;
}

/**
 * Resource-aware concurrency controller. Reads container-aware system metrics
 * (cgroup v2 when present, host fallback) and drives `Orchestrator` via
 * `setConcurrency()` and `killNewestAgent()`.
 *
 * Two independent loops:
 *  - sample loop @ metricsIntervalMs: collects metrics, updates the CPU EMA,
 *    and checks the trip-wire on every tick — so a 95%+ spike does not have
 *    to wait for the slower decision tick.
 *  - decision loop @ cycleMs: when not in cooldown, computes how many agents
 *    fit in the (target % - current usage) headroom and grows concurrency.
 *
 * The kill cooldown gates only kills, not scale-up, but in practice scale-up
 * is gated by the same memory pressure that triggered the kill — so the two
 * stay in sync without explicit coupling.
 */
export class Autoscaler {
  private readonly opts: Required<Omit<AutoscalerOptions, 'diskPath'>> & { diskPath?: string };
  private readonly sampler: CpuSamplerState = makeCpuSampler();
  private cpuEma = 0;
  private cpuEmaInitialized = false;
  private lastSnapshot: SystemMetrics | null = null;
  private lastDiskPercent = 0;
  private cooldownUntil = 0;
  private cycleTimer: NodeJS.Timeout | null = null;
  private sampleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly orch: Orchestrator,
    private readonly logger: AutoscalerLogger,
    options: AutoscalerOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  start(): void {
    if (this.cycleTimer || this.sampleTimer) return;
    // Take an immediate sample so the first decision tick has data.
    this.sample();
    this.sampleTimer = setInterval(() => this.sample(), this.opts.metricsIntervalMs);
    this.sampleTimer.unref?.();
    this.cycleTimer = setInterval(() => this.decisionTick(), this.opts.cycleMs);
    this.cycleTimer.unref?.();
  }

  stop(): void {
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    this.cycleTimer = null;
    this.sampleTimer = null;
  }

  private sample(): void {
    const m = readSystemMetrics(this.sampler);
    this.lastSnapshot = m;

    if (!this.cpuEmaInitialized) {
      this.cpuEma = m.cpuPercent;
      this.cpuEmaInitialized = true;
    } else {
      const a = this.opts.cpuEmaAlpha;
      this.cpuEma = a * m.cpuPercent + (1 - a) * this.cpuEma;
    }

    if (this.opts.diskPath) {
      const d = readDiskUsage(this.opts.diskPath);
      if (d) this.lastDiskPercent = d.percent;
    }

    // Trip-wire runs on every sample (not gated by cycleMs) so a sudden spike
    // is preempted within metricsIntervalMs (~1 s) instead of waiting up to
    // cycleMs (~5 s) for the next decision tick.
    this.checkTripWire();
  }

  private checkTripWire(): void {
    if (Date.now() < this.cooldownUntil) return;
    if (!this.lastSnapshot) return;

    const memHot = this.lastSnapshot.memPercent >= this.opts.tripWirePct;
    const cpuHot = this.cpuEma >= this.opts.tripWirePct;
    const diskHot = this.lastDiskPercent >= this.opts.diskTripWirePct;
    if (!memHot && !cpuHot && !diskHot) return;

    const reason = memHot ? 'trip_wire_mem' : cpuHot ? 'trip_wire_cpu' : 'trip_wire_disk';
    const killed = this.orch.killNewestAgent(reason);
    if (killed) {
      this.cooldownUntil = Date.now() + this.opts.killCooldownMs;
      this.logger.log({
        level: 'warn',
        message: `autoscale ${reason}: mem=${this.lastSnapshot.memPercent.toFixed(0)}% cpu=${this.cpuEma.toFixed(0)}% disk=${this.lastDiskPercent.toFixed(0)}% — killed newest, cooldown ${this.opts.killCooldownMs}ms`,
      });
    }
    // If killNewestAgent returned false (no eligible victim — e.g., everything
    // is finalizing), do NOT start the cooldown. The next sample will retry
    // immediately, which is the correct behavior under sustained pressure.
  }

  private decisionTick(): void {
    if (Date.now() < this.cooldownUntil) return;
    if (!this.lastSnapshot) return;

    const memPct = this.lastSnapshot.memPercent;
    const cpuPct = this.cpuEma;

    // Hard-stop: pressure too high to grow safely.
    if (
      memPct >= this.opts.hardStopPct ||
      cpuPct >= this.opts.hardStopPct ||
      this.lastDiskPercent >= this.opts.diskHardStopPct
    ) {
      return;
    }

    const pending = this.orch.getPendingCount();
    if (pending === 0) return;

    const targetBytes = this.lastSnapshot.memTotalBytes * (this.opts.scaleUpTargetPct / 100);
    const availableBytes = Math.max(0, targetBytes - this.lastSnapshot.memUsedBytes);
    const room = Math.floor(availableBytes / this.opts.agentCostBytes);
    if (room <= 0) return;

    const active = this.orch.getActiveCount();
    const toAdd = Math.min(pending, room);
    const desired = active + toAdd;

    // setConcurrency clamps to MIN_INSTANCES on the lower side and MAX_INSTANCES_AUTO
    // on the upper. If desired equals the current limit, setConcurrency is a no-op.
    this.orch.setConcurrency(desired);
    this.logger.log({
      level: 'info',
      message: `autoscale tick: mem=${memPct.toFixed(0)}% cpu=${cpuPct.toFixed(0)}% pending=${pending} active=${active} room=${room} → target=${desired}`,
    });
  }
}
