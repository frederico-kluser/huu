import { beforeEach, describe, expect, it } from 'vitest';
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
});
