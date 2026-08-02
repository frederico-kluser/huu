import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetProcessLogBridge,
  attachProcessLogSink,
  enqueueProcessLog,
  type ProcessLogEntry,
} from './process-log-bridge.js';

describe('process-log-bridge', () => {
  beforeEach(() => __resetProcessLogBridge());

  it('replays backlog to a new sink and then forwards new entries', () => {
    enqueueProcessLog({ level: 'warn', source: 'node-warning', message: 'pre' });
    const received: ProcessLogEntry[] = [];
    const detach = attachProcessLogSink((e) => received.push(e));
    expect(received).toHaveLength(1);
    expect(received[0].message).toBe('pre');

    enqueueProcessLog({ level: 'error', source: 'console', message: 'post' });
    expect(received).toHaveLength(2);
    expect(received[1].message).toBe('post');

    detach();
    enqueueProcessLog({ level: 'info', source: 'console', message: 'after-detach' });
    expect(received).toHaveLength(2);
  });

  it('caps the buffer at 500 entries', () => {
    for (let i = 0; i < 750; i++) {
      enqueueProcessLog({ level: 'info', source: 'console', message: `m${i}` });
    }
    const received: ProcessLogEntry[] = [];
    attachProcessLogSink((e) => received.push(e));
    expect(received).toHaveLength(500);
    expect(received[0].message).toBe('m250');
    expect(received[499].message).toBe('m749');
  });

  it('isolates sinks: a throwing sink does not break the producer or peers', () => {
    const good: ProcessLogEntry[] = [];
    attachProcessLogSink(() => {
      throw new Error('boom');
    });
    attachProcessLogSink((e) => good.push(e));
    expect(() =>
      enqueueProcessLog({ level: 'warn', source: 'console', message: 'x' }),
    ).not.toThrow();
    expect(good).toHaveLength(1);
  });

  it('detach is idempotent', () => {
    const detach = attachProcessLogSink(() => {});
    expect(() => {
      detach();
      detach();
    }).not.toThrow();
  });

  it('dedupes repeated emissions within the window (the ×8-per-burst warning storm)', () => {
    const received: ProcessLogEntry[] = [];
    attachProcessLogSink((e) => received.push(e));
    const warn = 'MaxListenersExceededWarning: Possible EventTarget memory leak detected.\n    at stack-frame-A';
    enqueueProcessLog({ level: 'warn', source: 'node-warning', message: warn });
    // Same headline, different stack frames — still the same signature.
    enqueueProcessLog({
      level: 'warn',
      source: 'node-warning',
      message: 'MaxListenersExceededWarning: Possible EventTarget memory leak detected.\n    at stack-frame-B',
    });
    enqueueProcessLog({ level: 'warn', source: 'node-warning', message: warn });
    expect(received).toHaveLength(1);
  });

  it('distinct messages and distinct sources pass through untouched', () => {
    const received: ProcessLogEntry[] = [];
    attachProcessLogSink((e) => received.push(e));
    enqueueProcessLog({ level: 'warn', source: 'node-warning', message: 'alpha' });
    enqueueProcessLog({ level: 'warn', source: 'node-warning', message: 'beta' });
    enqueueProcessLog({ level: 'warn', source: 'console', message: 'alpha' });
    expect(received).toHaveLength(3);
  });

  it('the first emission after the window carries the suppressed count', () => {
    vi.useFakeTimers();
    try {
      const received: ProcessLogEntry[] = [];
      attachProcessLogSink((e) => received.push(e));
      enqueueProcessLog({ level: 'warn', source: 'node-warning', message: 'noisy' });
      enqueueProcessLog({ level: 'warn', source: 'node-warning', message: 'noisy' });
      enqueueProcessLog({ level: 'warn', source: 'node-warning', message: 'noisy' });
      expect(received).toHaveLength(1);
      vi.advanceTimersByTime(61_000);
      enqueueProcessLog({ level: 'warn', source: 'node-warning', message: 'noisy' });
      expect(received).toHaveLength(2);
      expect(received[1].message).toContain('repeated 2×');
    } finally {
      vi.useRealTimers();
    }
  });
});
