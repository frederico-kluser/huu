import { describe, it, expect } from 'vitest';
import {
  classifyError,
  nextDelayMs,
  maxDelayMs,
  shouldRetry,
  checkTimeout,
  getPhaseTimeouts,
  DEFAULT_TIMEOUT_CONFIG,
} from '../timeout-policy.js';
import type { TimeoutConfig } from '../timeout-policy.js';

describe('classifyError', () => {
  it('classifies timeout as retryable', () => {
    expect(classifyError('Connection timeout').errorClass).toBe('retryable');
  });

  it('classifies 429 as retryable', () => {
    expect(classifyError('Rate limit 429 exceeded').errorClass).toBe('retryable');
  });

  it('classifies 500 as retryable', () => {
    expect(classifyError('Internal server error 500').errorClass).toBe('retryable');
  });

  it('classifies 503 as retryable', () => {
    expect(classifyError('Service unavailable 503').errorClass).toBe('retryable');
  });

  it('classifies ECONNRESET as retryable', () => {
    expect(classifyError('ECONNRESET').errorClass).toBe('retryable');
  });

  it('classifies overloaded as retryable', () => {
    expect(classifyError('Server overloaded, try again').errorClass).toBe('retryable');
  });

  it('classifies SQLITE_BUSY as retryable', () => {
    expect(classifyError('SQLITE_BUSY: database is locked').errorClass).toBe('retryable');
  });

  it('classifies permission denied as permanent', () => {
    expect(classifyError('permission denied').errorClass).toBe('permanent');
  });

  it('classifies validation failure as permanent', () => {
    expect(classifyError('validation failed: missing field').errorClass).toBe('permanent');
  });

  it('classifies invalid prompt as permanent', () => {
    expect(classifyError('invalid prompt format').errorClass).toBe('permanent');
  });

  it('classifies unknown errors as permanent', () => {
    expect(classifyError('some weird error').errorClass).toBe('permanent');
  });
});

describe('nextDelayMs', () => {
  it('returns value within expected range', () => {
    for (let i = 0; i < 100; i++) {
      const delay = nextDelayMs(0, 1000, 30000);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1000);
    }
  });

  it('caps at maximum', () => {
    for (let i = 0; i < 100; i++) {
      const delay = nextDelayMs(10, 1000, 5000);
      expect(delay).toBeLessThanOrEqual(5000);
    }
  });
});

describe('maxDelayMs', () => {
  it('doubles with each attempt', () => {
    expect(maxDelayMs(0, 1000, 100000)).toBe(1000);
    expect(maxDelayMs(1, 1000, 100000)).toBe(2000);
    expect(maxDelayMs(2, 1000, 100000)).toBe(4000);
    expect(maxDelayMs(3, 1000, 100000)).toBe(8000);
  });

  it('caps at capMs', () => {
    expect(maxDelayMs(10, 1000, 5000)).toBe(5000);
  });
});

describe('shouldRetry', () => {
  const config: TimeoutConfig = {
    ...DEFAULT_TIMEOUT_CONFIG,
    maxAttempts: 3,
    backoffBaseMs: 100,
    backoffCapMs: 1000,
    maxRetryWindowMs: 60_000,
  };

  it('retries on retryable error', () => {
    const result = shouldRetry({
      errorMsg: 'timeout occurred',
      attempt: 0,
      config,
      elapsedMs: 0,
    });
    expect(result.shouldRetry).toBe(true);
    expect(result.nextAttempt).toBe(1);
  });

  it('does not retry permanent error', () => {
    const result = shouldRetry({
      errorMsg: 'permission denied',
      attempt: 0,
      config,
      elapsedMs: 0,
    });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('permanent');
  });

  it('does not retry after max attempts', () => {
    const result = shouldRetry({
      errorMsg: 'timeout',
      attempt: 3,
      config,
      elapsedMs: 0,
    });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toBe('max_attempts_exceeded');
  });

  it('does not retry when window exceeded', () => {
    const result = shouldRetry({
      errorMsg: 'timeout',
      attempt: 0,
      config: { ...config, maxRetryWindowMs: 0 },
      elapsedMs: 1,
    });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toBe('retry_window_exceeded');
  });
});

describe('checkTimeout', () => {
  it('returns ok when within soft timeout', () => {
    const result = checkTimeout(1000, 'execution');
    expect(result.status).toBe('ok');
    expect(result.softRemainingMs).toBeGreaterThan(0);
    expect(result.hardRemainingMs).toBeGreaterThan(0);
  });

  it('returns soft_timeout between soft and hard', () => {
    const phase = getPhaseTimeouts('execution');
    const result = checkTimeout(phase.soft + 1000, 'execution');
    expect(result.status).toBe('soft_timeout');
  });

  it('returns hard_timeout past hard limit', () => {
    const phase = getPhaseTimeouts('execution');
    const result = checkTimeout(phase.hard + 1000, 'execution');
    expect(result.status).toBe('hard_timeout');
    expect(result.hardRemainingMs).toBe(0);
  });

  it('uses phase-specific timeouts', () => {
    const spawn = getPhaseTimeouts('spawn');
    const exec = getPhaseTimeouts('execution');
    expect(spawn.hard).toBeLessThan(exec.hard);
  });
});
