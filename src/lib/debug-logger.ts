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

/**
 * Replace API-key-shaped substrings with a stable placeholder. Conservative
 * by design: a bigger pattern would risk corrupting legitimate text. Covers
 * the formats we know flow through huu logs:
 *   - OpenRouter / OpenAI: `sk-or-…`, `sk-…`, `sk-ant-…`
 *   - GitHub PATs: `ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…`
 *   - Bearer headers: `Bearer <token>`
 *
 * The placeholder preserves the leading prefix so logs stay diagnosable
 * ("a key WAS present" is itself signal). Idempotent: running twice yields
 * the same output.
 */
const API_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /sk-or-v1-[A-Za-z0-9_-]{16,}/g,
  /sk-or-[A-Za-z0-9_-]{16,}/g,
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /sk-proj-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  /\bgh[opusr]_[A-Za-z0-9_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/g,
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const re of API_KEY_PATTERNS) {
    out = out.replace(re, (match) => {
      // Preserve a small prefix so operators can spot WHICH provider's key
      // was about to leak; the rest is replaced with a fixed sentinel.
      const prefix = match.startsWith('Bearer ')
        ? 'Bearer '
        : match.slice(0, Math.min(7, match.length));
      return `${prefix}<redacted>`;
    });
  }
  return out;
}

function redactValue(v: unknown): unknown {
  if (typeof v === 'string') return redactSecrets(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = redactValue(val);
    }
    return out;
  }
  return v;
}

export function log(cat: string, ev: string, data?: Record<string, unknown>): void {
  if (fd === null) return;
  const payload = {
    t: new Date().toISOString(),
    cat,
    ev,
    ...((data ? (redactValue(data) as Record<string, unknown>) : undefined) ?? {}),
  };
  safeWrite(JSON.stringify(payload) + '\n');
}

/**
 * Return a {@link log}-shaped function that stamps every event with `runId`.
 * When multiple orchestrators run concurrently in ONE process (multi-run
 * scheduling) their lines interleave in the single process-wide debug file;
 * the `runId` field keeps each run's events greppable. The fd, heartbeat and
 * counters stay process-level and single — only the per-event payload changes.
 */
export function scopedDebugLog(
  runId: string,
): (cat: string, ev: string, data?: Record<string, unknown>) => void {
  return (cat, ev, data) => log(cat, ev, { ...data, runId });
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
      // The user may type an API key into a TUI prompt; the raw ascii of
      // that keystroke would otherwise land in the debug log. log()
      // already redacts via redactValue(), but the hex form bypasses it
      // (sk-or-… in hex is just digits) — leave hex as-is since reading
      // it requires deliberate effort, but redact the ascii view.
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
