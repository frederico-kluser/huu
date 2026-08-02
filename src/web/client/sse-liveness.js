/* Pure SSE liveness/backoff state machine behind the web client's watchdog.
   DOM-free on purpose so it unit-tests in Node (src/web/sse-liveness.test.js);
   app.js owns the EventSource, the timers and the reconnection side effects. */

/**
 * Track when the stream last proved itself alive and how aggressively to
 * retry. `connected()` arms the staleness clock at (re)connect time WITHOUT
 * resetting the backoff — only a received frame (`seen`) proves the link
 * actually works again, so a reconnect storm against a dead server still
 * backs off.
 */
export function createSseHealth({ staleMs = 60_000, baseMs = 1_000, maxMs = 30_000 } = {}) {
  let lastSeenAt = 0;
  let attempts = 0;
  return {
    connected(now) { lastSeenAt = now; },
    seen(now) { lastSeenAt = now; attempts = 0; },
    stale(now) { return lastSeenAt > 0 && now - lastSeenAt > staleMs; },
    nextDelay() { return Math.min(maxMs, baseMs * 2 ** Math.min(attempts++, 5)); },
    lastSeenAt() { return lastSeenAt; },
    attempts() { return attempts; },
  };
}

/**
 * Decide what the watchdog should do with the current stream. `readyState` is
 * numeric so the module tests in Node without an EventSource global:
 * 0 CONNECTING, 1 OPEN, 2 CLOSED.
 *
 * CLOSED is a PERMANENT EventSource failure (non-200 response, wrong
 * content-type, refused connection after retries) — the browser will never
 * retry it; only a new EventSource object recovers. OPEN-but-stale is the
 * zombie (half-open TCP) case that used to freeze the UI forever; CONNECTING-
 * but-stale is a native retry loop that never lands.
 */
export function sseAction({ readyState, stale }) {
  if (readyState === 2) return 'reconnect';
  return stale ? 'reconnect' : 'ok';
}
