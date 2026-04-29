import { mkdirSync, openSync, writeSync, closeSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Process-wide diagnostic logger. Writes one NDJSON event per line to
 * `<cwd>/.huu/debug-<ISO>.log`. Designed to diagnose freezes where the
 * keyboard stops responding — captures stdin bytes (raw), useInput
 * dispatches, navigation transitions, git invocations, orchestrator phases,
 * and a 200ms heartbeat with event-loop lag so we can tell exactly when
 * (and where) the process stopped making progress.
 *
 * The logger uses `appendFileSync` per event. At the rates we care about
 * (single-digit thousands per second worst case) that is well within the
 * cost budget, and synchronous writes guarantee the line lands on disk
 * before a freeze prevents flushing.
 */

let fd: number | null = null;
let logPath = '';
let heartbeatTimer: NodeJS.Timeout | null = null;
let lastHeartbeatAt = 0;
const HEARTBEAT_MS = 200;
const counters: Record<string, number> = {};

function safeWrite(line: string): void {
  if (fd === null) return;
  try {
    writeSync(fd, line);
  } catch {
    /* disk full / fd closed / EPIPE — there's nothing useful we can do */
  }
}

export function log(cat: string, ev: string, data?: Record<string, unknown>): void {
  if (fd === null) return;
  const payload = { t: new Date().toISOString(), cat, ev, ...(data ?? {}) };
  safeWrite(JSON.stringify(payload) + '\n');
}

export function bump(name: string): void {
  counters[name] = (counters[name] ?? 0) + 1;
}

export function getLogPath(): string {
  return logPath;
}

/**
 * Initialize the logger. Idempotent: a second call is a no-op so we don't
 * end up with duplicate heartbeat timers if the CLI gets re-entered (tests).
 */
export function initDebugLogger(repoRoot: string): string {
  if (fd !== null) return logPath;

  const dir = join(repoRoot, '.huu');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  logPath = join(dir, `debug-${ts}.log`);
  fd = openSync(logPath, 'a');

  log('lifecycle', 'cli_start', {
    cwd: process.cwd(),
    argv: process.argv,
    pid: process.pid,
    node: process.version,
    platform: process.platform,
    isTTY: Boolean(process.stdin.isTTY),
  });

  // Heartbeat with event-loop lag estimate. If `lagMs` spikes from ~0 to
  // hundreds, we know the loop was blocked synchronously (CPU work or sync
  // I/O). If heartbeat lines stop appearing entirely, the loop is dead.
  lastHeartbeatAt = Date.now();
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    const lag = now - lastHeartbeatAt - HEARTBEAT_MS;
    lastHeartbeatAt = now;
    const snapshot = { ...counters };
    for (const k of Object.keys(counters)) counters[k] = 0;
    log('heartbeat', 'tick', {
      lagMs: lag,
      activeHandles:
        (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()
          .length ?? -1,
      activeRequests:
        (process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.()
          .length ?? -1,
      counters: snapshot,
    });
  }, HEARTBEAT_MS);
  heartbeatTimer.unref?.();

  // Stdin tap. We add a 'data' listener — additive to whatever Ink
  // attaches via its readable handler. This shows us EXACTLY which bytes
  // the kernel/terminal delivered. If keys go dead but bytes still appear
  // here, the problem is downstream (Ink not dispatching). If bytes stop
  // appearing, the problem is upstream (terminal/raw mode/credentials
  // helper stealing stdin).
  try {
    process.stdin.on('data', (chunk: Buffer) => {
      log('stdin', 'data', {
        hex: chunk.toString('hex'),
        len: chunk.length,
        ascii: chunk
          .toString('utf8')
          .replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`),
      });
    });
  } catch {
    /* stdin not available */
  }

  process.on('SIGINT', () => log('signal', 'SIGINT'));
  process.on('SIGTERM', () => log('signal', 'SIGTERM'));
  process.on('SIGHUP', () => log('signal', 'SIGHUP'));
  process.on('exit', (code) => {
    log('lifecycle', 'exit', { code });
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* nothing */
      }
      fd = null;
    }
  });
  process.on('uncaughtException', (err) =>
    log('error', 'uncaughtException', {
      msg: err.message,
      stack: err.stack,
    }),
  );
  process.on('unhandledRejection', (reason) =>
    log('error', 'unhandledRejection', { reason: String(reason) }),
  );

  return logPath;
}
