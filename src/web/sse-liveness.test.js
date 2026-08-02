import { describe, expect, it } from 'vitest';
import { createSseHealth, sseAction } from './client/sse-liveness.js';

// Regression spec for the frozen-view-until-refresh bug: the client's
// `es.onerror` was a no-op and no watchdog existed, so a half-open (zombie)
// EventSource — readyState OPEN, zero frames, no error event — froze the
// board forever. This state machine is what the watchdog now decides with.
describe('createSseHealth (staleness + backoff)', () => {
  const t0 = 1_000_000;

  it('is never stale before the first connect (no stream yet = nothing to save)', () => {
    const h = createSseHealth();
    expect(h.stale(t0 + 999_999)).toBe(false);
  });

  it('a connect that never delivers a frame goes stale after the threshold', () => {
    const h = createSseHealth({ staleMs: 60_000 });
    h.connected(t0);
    expect(h.stale(t0 + 59_000)).toBe(false);
    expect(h.stale(t0 + 60_001)).toBe(true);
  });

  it('any received frame (message or ping) refreshes liveness', () => {
    const h = createSseHealth({ staleMs: 60_000 });
    h.connected(t0);
    h.seen(t0 + 50_000);
    expect(h.stale(t0 + 100_000)).toBe(false);
    expect(h.stale(t0 + 110_001)).toBe(true);
  });

  it('backs off exponentially and caps: 1s 2s 4s 8s 16s 30s 30s…', () => {
    const h = createSseHealth();
    const delays = Array.from({ length: 7 }, () => h.nextDelay());
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it('a successful frame resets the backoff; a mere connect attempt does NOT', () => {
    const h = createSseHealth();
    h.nextDelay(); // 1s
    h.nextDelay(); // 2s
    h.connected(t0);                    // reconnect attempt against a dead server…
    expect(h.nextDelay()).toBe(4_000);  // …keeps escalating
    h.seen(t0 + 1);                     // a real frame proves the link works
    expect(h.nextDelay()).toBe(1_000);  // backoff restarts
  });
});

describe('sseAction (what the watchdog does)', () => {
  // readyState: 0 CONNECTING, 1 OPEN, 2 CLOSED (numeric — no EventSource in Node)
  it('leaves a fresh stream alone', () => {
    expect(sseAction({ readyState: 1, stale: false })).toBe('ok');
    expect(sseAction({ readyState: 0, stale: false })).toBe('ok'); // native retry in flight
  });

  it('reconnects a zombie: OPEN but silent past the threshold', () => {
    expect(sseAction({ readyState: 1, stale: true })).toBe('reconnect');
  });

  it('reconnects a native retry loop that never lands', () => {
    expect(sseAction({ readyState: 0, stale: true })).toBe('reconnect');
  });

  it('reconnects a CLOSED stream immediately — the browser never will', () => {
    expect(sseAction({ readyState: 2, stale: false })).toBe('reconnect');
    expect(sseAction({ readyState: 2, stale: true })).toBe('reconnect');
  });
});
