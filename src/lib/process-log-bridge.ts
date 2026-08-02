/**
 * Process-wide capture of console.* and Node `warning` events so they
 * land in the TUI's "Logs (all)" panel instead of bleeding above the
 * Ink frame and corrupting the rendered kanban.
 *
 * Producers: the cli.tsx bootstrap (see installLogCaptures) calls
 * `enqueueProcessLog()` for every patched console method and every
 * `process.on('warning')` event.
 *
 * Consumers: the orchestrator attaches via `attachProcessLogSink()`
 * when it starts a run; the call drains the backlog synchronously,
 * then forwards every subsequent enqueue. Detach is idempotent.
 */
export type ProcessLogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface ProcessLogEntry {
  timestamp: number;
  level: ProcessLogLevel;
  source: 'console' | 'node-warning';
  message: string;
}

const MAX_BUFFER = 500;
const buffer: ProcessLogEntry[] = [];
const sinks = new Set<(entry: ProcessLogEntry) => void>();

/**
 * Repeated-emission dedupe: process-wide warnings can fire in bursts (the pi
 * SDK's MaxListenersExceededWarning re-fired every few seconds for the whole
 * run), and every emission fans out to EVERY attached sink — with 8 admitted
 * runs one noisy warning became 8 log lines per burst, burying the useful
 * signal. Signature = source + first line (stack frames vary, the headline
 * doesn't). Within the window a repeat is dropped and counted; the next
 * emission after the window carries a `(repeated N×…)` suffix so nothing is
 * silently lost.
 */
const DEDUPE_WINDOW_MS = 60_000;
const MAX_DEDUPE_ENTRIES = 100;
const recentBySignature = new Map<string, { at: number; suppressed: number }>();

export function enqueueProcessLog(entry: Omit<ProcessLogEntry, 'timestamp'>): void {
  const now = Date.now();
  const signature = `${entry.source}:${entry.message.split('\n', 1)[0]}`;
  const seen = recentBySignature.get(signature);
  if (seen && now - seen.at < DEDUPE_WINDOW_MS) {
    seen.suppressed++;
    return;
  }
  const suffix =
    seen && seen.suppressed > 0
      ? ` (repeated ${seen.suppressed}× in the last minute)`
      : '';
  recentBySignature.set(signature, { at: now, suppressed: 0 });
  if (recentBySignature.size > MAX_DEDUPE_ENTRIES) {
    // Evict the stalest signature — bounded memory, never throws.
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of recentBySignature) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) recentBySignature.delete(oldestKey);
  }

  const full: ProcessLogEntry = { ...entry, message: entry.message + suffix, timestamp: now };
  buffer.push(full);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  for (const sink of sinks) {
    try {
      sink(full);
    } catch {
      /* a misbehaving sink must not break the producer */
    }
  }
}

export function attachProcessLogSink(sink: (entry: ProcessLogEntry) => void): () => void {
  if (sinks.has(sink)) return () => sinks.delete(sink);
  for (const entry of buffer) {
    try {
      sink(entry);
    } catch {
      /* same rationale */
    }
  }
  sinks.add(sink);
  return () => sinks.delete(sink);
}

/** Test seam: drop the buffer + every sink + the dedupe window. */
export function __resetProcessLogBridge(): void {
  buffer.length = 0;
  sinks.clear();
  recentBySignature.clear();
}
