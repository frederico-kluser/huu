// Agent timeout + retry strategy (5.2.3)
//
// Two-level timeouts (soft + hard), error classification,
// exponential backoff with full jitter, and retry budget management.

// ── Types ────────────────────────────────────────────────────────────

export interface TimeoutConfig {
  /** Soft timeout: signal degradation, request heartbeat (ms). */
  softTimeoutMs: number;
  /** Hard timeout: abort attempt, evaluate retry (ms). */
  hardTimeoutMs: number;
  /** Maximum retry attempts per task. */
  maxAttempts: number;
  /** Base delay for exponential backoff (ms). */
  backoffBaseMs: number;
  /** Cap for exponential backoff (ms). */
  backoffCapMs: number;
  /** Total time budget for all retries of a single task (ms). */
  maxRetryWindowMs: number;
}

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  softTimeoutMs: 5 * 60 * 1000,   // 5 minutes
  hardTimeoutMs: 10 * 60 * 1000,  // 10 minutes
  maxAttempts: 3,
  backoffBaseMs: 1000,
  backoffCapMs: 30_000,
  maxRetryWindowMs: 30 * 60 * 1000, // 30 minutes total
};

// ── Phase-specific timeouts ──────────────────────────────────────────

export type TaskPhase = 'spawn' | 'execution' | 'merge_handoff';

const PHASE_TIMEOUTS: Record<TaskPhase, { soft: number; hard: number }> = {
  spawn: { soft: 30_000, hard: 60_000 },
  execution: { soft: 5 * 60 * 1000, hard: 10 * 60 * 1000 },
  merge_handoff: { soft: 60_000, hard: 2 * 60 * 1000 },
};

export function getPhaseTimeouts(phase: TaskPhase): { soft: number; hard: number } {
  return PHASE_TIMEOUTS[phase];
}

// ── Error classification ─────────────────────────────────────────────

export type ErrorClass = 'retryable' | 'permanent';

export interface ClassifiedError {
  errorClass: ErrorClass;
  reason: string;
  originalError: string;
}

const RETRYABLE_PATTERNS = [
  /timeout/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /429/,
  /rate.?limit/i,
  /5\d{2}\b/,
  /overloaded/i,
  /temporary/i,
  /lock.?timeout/i,
  /busy/i,
  /SQLITE_BUSY/,
  /EAGAIN/,
] as const;

const PERMANENT_PATTERNS = [
  /4\d{2}\b(?!.*429)/, // 4xx except 429
  /invalid.*prompt/i,
  /permission.?denied/i,
  /authentication/i,
  /authorization/i,
  /validation.*fail/i,
  /not.?found/i,
  /schema.*error/i,
] as const;

export function classifyError(errorMsg: string): ClassifiedError {
  // Check retryable first (includes 429/5xx/timeout which should always retry)
  for (const pattern of RETRYABLE_PATTERNS) {
    if (pattern.test(errorMsg)) {
      return { errorClass: 'retryable', reason: 'matches_retryable_pattern', originalError: errorMsg };
    }
  }

  // Check permanent
  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(errorMsg)) {
      return { errorClass: 'permanent', reason: 'matches_permanent_pattern', originalError: errorMsg };
    }
  }

  // Default: permanent (conservative — don't retry unknown errors)
  return { errorClass: 'permanent', reason: 'unknown_error_type', originalError: errorMsg };
}

// ── Backoff with full jitter ─────────────────────────────────────────

/**
 * Compute delay with exponential backoff + full jitter.
 * Formula: random(0, min(cap, base * 2^attempt))
 */
export function nextDelayMs(attempt: number, baseMs: number, capMs: number): number {
  const max = Math.min(capMs, baseMs * Math.pow(2, attempt));
  return Math.floor(Math.random() * (max + 1));
}

/**
 * Deterministic version for testing — returns the max delay without jitter.
 */
export function maxDelayMs(attempt: number, baseMs: number, capMs: number): number {
  return Math.min(capMs, baseMs * Math.pow(2, attempt));
}

// ── Retry decision ───────────────────────────────────────────────────

export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
  delayMs: number;
  nextAttempt: number;
}

export function shouldRetry(params: {
  errorMsg: string;
  attempt: number;
  config: TimeoutConfig;
  elapsedMs: number;
}): RetryDecision {
  const { errorMsg, attempt, config, elapsedMs } = params;
  const classified = classifyError(errorMsg);

  // Permanent error — never retry
  if (classified.errorClass === 'permanent') {
    return { shouldRetry: false, reason: `permanent_error: ${classified.reason}`, delayMs: 0, nextAttempt: attempt };
  }

  // Max attempts exceeded
  if (attempt >= config.maxAttempts) {
    return { shouldRetry: false, reason: 'max_attempts_exceeded', delayMs: 0, nextAttempt: attempt };
  }

  // Retry window budget exceeded
  const delay = nextDelayMs(attempt, config.backoffBaseMs, config.backoffCapMs);
  if (elapsedMs + delay > config.maxRetryWindowMs) {
    return { shouldRetry: false, reason: 'retry_window_exceeded', delayMs: 0, nextAttempt: attempt };
  }

  return {
    shouldRetry: true,
    reason: `retryable: ${classified.reason}`,
    delayMs: delay,
    nextAttempt: attempt + 1,
  };
}

// ── Timeout checker ──────────────────────────────────────────────────

export type TimeoutStatus = 'ok' | 'soft_timeout' | 'hard_timeout';

export interface TimeoutCheckResult {
  status: TimeoutStatus;
  elapsedMs: number;
  phase: TaskPhase;
  softRemainingMs: number;
  hardRemainingMs: number;
}

export function checkTimeout(
  elapsedMs: number,
  phase: TaskPhase,
  config?: TimeoutConfig,
): TimeoutCheckResult {
  const phaseTimeouts = getPhaseTimeouts(phase);
  const softMs = config?.softTimeoutMs ?? phaseTimeouts.soft;
  const hardMs = config?.hardTimeoutMs ?? phaseTimeouts.hard;

  let status: TimeoutStatus = 'ok';
  if (elapsedMs >= hardMs) {
    status = 'hard_timeout';
  } else if (elapsedMs >= softMs) {
    status = 'soft_timeout';
  }

  return {
    status,
    elapsedMs,
    phase,
    softRemainingMs: Math.max(0, softMs - elapsedMs),
    hardRemainingMs: Math.max(0, hardMs - elapsedMs),
  };
}
