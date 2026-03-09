// Health checker — watchdog for stuck/crashed agents
//
// Responsible for:
// - Detecting agents that stopped sending heartbeats
// - Layered remediation: steer → abort → retry → escalate
// - Exponential backoff with jitter for retries
// - Circuit breaker to prevent infinite restart loops

import type { AgentSlot, OrchestratorConfig } from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'warning' | 'stuck' | 'dead';

export interface AgentHealthReport {
  taskId: string;
  runId: string;
  agentName: string;
  status: HealthStatus;
  lastHeartbeatAge: number;
  retryCount: number;
  recommendation: HealthRecommendation;
}

export type HealthRecommendation = 'none' | 'steer' | 'abort' | 'retry' | 'escalate';

export interface HealthCheckResult {
  reports: AgentHealthReport[];
  stuckCount: number;
  deadCount: number;
}

// ── Configuration ────────────────────────────────────────────────────

export interface HealthConfig {
  /** Time without heartbeat before warning (ms). */
  warningThresholdMs: number;
  /** Time without heartbeat before stuck (ms). Default: stuckTimeoutMs from config. */
  stuckThresholdMs: number;
  /** Time without heartbeat before dead (ms). */
  deadThresholdMs: number;
  /** Maximum retries before permanent escalation. */
  maxRetries: number;
}

const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  warningThresholdMs: 15_000,
  stuckThresholdMs: 45_000,
  deadThresholdMs: 120_000,
  maxRetries: 3,
};

// ── Health Checker ───────────────────────────────────────────────────

export class HealthChecker {
  private readonly config: HealthConfig;

  constructor(config?: Partial<HealthConfig>) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  /**
   * Check health of all active agent slots.
   */
  check(activeSlots: Map<string, AgentSlot>, now: number): HealthCheckResult {
    const reports: AgentHealthReport[] = [];
    let stuckCount = 0;
    let deadCount = 0;

    for (const slot of activeSlots.values()) {
      const heartbeatAge = now - slot.lastHeartbeat;
      const status = this.determineStatus(heartbeatAge);
      const recommendation = this.recommend(status, slot.retryCount);

      if (status === 'stuck') stuckCount++;
      if (status === 'dead') deadCount++;

      reports.push({
        taskId: slot.taskId,
        runId: slot.runId,
        agentName: slot.agentName,
        status,
        lastHeartbeatAge: heartbeatAge,
        retryCount: slot.retryCount,
        recommendation,
      });
    }

    return { reports, stuckCount, deadCount };
  }

  /**
   * Determine health status based on heartbeat age.
   */
  private determineStatus(heartbeatAge: number): HealthStatus {
    if (heartbeatAge >= this.config.deadThresholdMs) return 'dead';
    if (heartbeatAge >= this.config.stuckThresholdMs) return 'stuck';
    if (heartbeatAge >= this.config.warningThresholdMs) return 'warning';
    return 'healthy';
  }

  /**
   * Recommend action based on status and retry count.
   */
  private recommend(status: HealthStatus, retryCount: number): HealthRecommendation {
    switch (status) {
      case 'healthy':
        return 'none';
      case 'warning':
        return 'steer';
      case 'stuck':
        if (retryCount < this.config.maxRetries) return 'abort';
        return 'escalate';
      case 'dead':
        if (retryCount < this.config.maxRetries) return 'retry';
        return 'escalate';
    }
  }
}

// ── Backoff ──────────────────────────────────────────────────────────

/**
 * Compute backoff delay with exponential backoff + jitter.
 * baseMs * 2^retryCount + random jitter
 */
export function computeBackoffMs(
  retryCount: number,
  baseMs: number = 1000,
  maxMs: number = 60_000,
): number {
  const exponential = baseMs * Math.pow(2, retryCount);
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, maxMs);
}

/**
 * Update heartbeat for an agent slot.
 */
export function updateHeartbeat(slot: AgentSlot, now: number): void {
  slot.lastHeartbeat = now;
}

// ── Backpressure ─────────────────────────────────────────────────────

export interface BackpressureConfig {
  minDelayMs: number;
  maxDelayMs: number;
  loadFactor: number;
}

/**
 * Compute adaptive loop delay based on current load.
 * When active agents are near capacity, increase delay to reduce polling overhead.
 */
export function computeLoopDelay(
  activeCount: number,
  maxConcurrent: number,
  tickDurationMs: number,
  config: BackpressureConfig,
): number {
  if (activeCount === 0) {
    // Idle: use max delay
    return config.maxDelayMs;
  }

  // Load ratio 0..1
  const loadRatio = Math.min(activeCount / Math.max(maxConcurrent, 1), 1);

  // Base delay: higher load → shorter delay (more responsive monitoring needed)
  const baseDelay = config.minDelayMs + (1 - loadRatio) * (config.maxDelayMs - config.minDelayMs);

  // Adjust for tick duration: if ticks are slow, don't add much delay
  const tickAdjustment = Math.min(tickDurationMs * config.loadFactor, config.maxDelayMs / 2);

  return Math.max(config.minDelayMs, Math.min(baseDelay - tickAdjustment, config.maxDelayMs));
}
