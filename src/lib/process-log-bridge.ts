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

export function enqueueProcessLog(entry: Omit<ProcessLogEntry, 'timestamp'>): void {
  const full: ProcessLogEntry = { ...entry, timestamp: Date.now() };
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

/** Test seam: drop the buffer + every sink. */
export function __resetProcessLogBridge(): void {
  buffer.length = 0;
  sinks.clear();
}
