import type { SystemMetrics } from '../lib/resource-monitor.js';
import type { AutoScaleStatus } from '../lib/types.js';

export interface AutoScalerConfig {
  resourceMonitor: () => SystemMetrics;
  agentMemoryEstimateMb?: number;
  stopThresholdPercent?: number;
  destroyThresholdPercent?: number;
  cooldownMs?: number;
  reEvaluationMs?: number;
  maxAgents?: number;
}

type AutoScaleState = 'NORMAL' | 'SCALING_UP' | 'BACKING_OFF' | 'COOLDOWN' | 'DESTROYING';

const DEFAULT_AGENT_MEMORY_ESTIMATE_MB = 250;
const DEFAULT_STOP_THRESHOLD = 90;
const DEFAULT_DESTROY_THRESHOLD = 95;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_RE_EVALUATION_MS = 5_000;
const DEFAULT_MAX_AGENTS = 200;
const POLL_INTERVAL_MS = 1_000;

export class AutoScaler {
  private config: Required<AutoScalerConfig>;
  private currentMetrics: SystemMetrics;
  private state: AutoScaleState = 'NORMAL';
  private enabled = false;
  private activeAgentCount = 0;
  private pendingTaskCount = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownEndAt = 0;
  private destroyedAt = 0;

  constructor(config: AutoScalerConfig) {
    this.config = {
      resourceMonitor: config.resourceMonitor,
      agentMemoryEstimateMb: config.agentMemoryEstimateMb ?? DEFAULT_AGENT_MEMORY_ESTIMATE_MB,
      stopThresholdPercent: config.stopThresholdPercent ?? DEFAULT_STOP_THRESHOLD,
      destroyThresholdPercent: config.destroyThresholdPercent ?? DEFAULT_DESTROY_THRESHOLD,
      cooldownMs: config.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      reEvaluationMs: config.reEvaluationMs ?? DEFAULT_RE_EVALUATION_MS,
      maxAgents: config.maxAgents ?? DEFAULT_MAX_AGENTS,
    };
    this.currentMetrics = config.resourceMonitor();
  }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
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
  }

  shouldSpawn(): boolean {
    if (!this.enabled) return false;
    if (this.state === 'COOLDOWN') return false;
    const { cpuPercent, ramPercent } = this.currentMetrics;
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

  targetConcurrency(): number {
    const { ramTotalBytes } = this.currentMetrics;
    const { agentMemoryEstimateMb, maxAgents } = this.config;
    const agentBytes = agentMemoryEstimateMb * 1024 * 1024;
    const kickstart = Math.floor(ramTotalBytes / agentBytes);
    // When no tasks are queued, use kickstart as the target (clamped to maxAgents).
    // When tasks are queued, cap at pendingTaskCount to avoid over-provisioning.
    const ceiling = this.pendingTaskCount > 0
      ? Math.min(this.pendingTaskCount, maxAgents)
      : maxAgents;
    return Math.max(1, Math.min(kickstart, ceiling));
  }

  notifyAgentDestroyed(): void {
    this.activeAgentCount = Math.max(0, this.activeAgentCount - 1);
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

  getStatus(): AutoScaleStatus {
    const now = Date.now();
    const cooldownRemainingMs = this.cooldownEndAt > now ? this.cooldownEndAt - now : 0;
    return {
      enabled: this.enabled,
      state: this.state,
      cooldownRemainingMs,
      cpuPercent: this.currentMetrics.cpuPercent,
      ramPercent: this.currentMetrics.ramPercent,
    };
  }

  private pollMetrics(): void {
    this.currentMetrics = this.config.resourceMonitor();
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
}
