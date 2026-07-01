/**
 * Process-level crash guard — the single authoritative `uncaughtException` /
 * `unhandledRejection` handler, and the one place that decides EXIT vs SURVIVE.
 *
 * Why this exists: a long-lived multi-run host (the web server) was killed
 * outright by a SINGLE uncaught error escaping to the process top — e.g. a
 * detached `setTimeout` inside a third-party agent extension touching a stale
 * session ctx. One agent's library bug took down the whole fleet (5 concurrent
 * runs + the server). Per-run AWAITED errors are already isolated (each run's
 * `orch.start()` is `.catch()`-ed and marks only that run errored); the gap is
 * ASYNC/uncaught errors that never reach that catch.
 *
 * Behaviour:
 *   - Default (one-shot `huu auto`, the TUI): FATAL — log richly, run the
 *     cleanup, `process.exit(1)`. Exiting a one-shot with a non-zero code is
 *     correct, and a TUI left in a corrupted state is not worth resuming.
 *   - Resilient mode (opt-in, set by the web server once it is listening):
 *     CONTAIN — log (deduped), keep the process + every other run alive. A
 *     wedged run is still caught by the per-card timeout, so it self-recovers.
 *     A genuine meltdown still bails: {@link isErrorStorm} exits when MANY
 *     DISTINCT errors hit in a short window (widespread corruption) or the total
 *     rate is extreme (a CPU-pinning error loop) — but a single benign error
 *     repeating forever is survived and its log spam suppressed.
 *
 * This module is DI-friendly (inject `now` + cleanup) and keeps the exit/survive
 * policy in pure, unit-tested helpers.
 */
import { log as dlog } from './debug-logger.js';

export interface ErrEntry {
  /** Timestamp (ms). */
  t: number;
  /** Stable signature so repeats of the SAME error are recognised. */
  sig: string;
}

export interface StormConfig {
  /** Sliding window to evaluate, ms. */
  windowMs: number;
  /** Bail once this many DISTINCT signatures appear in the window. */
  distinctMax: number;
  /** Bail once this many TOTAL errors appear in the window (CPU-pin loop). */
  totalMax: number;
}

export interface CrashGuardConfig {
  /** Best-effort cleanup on the FATAL path (e.g. restore the terminal). */
  onFatalCleanup?: () => void;
  /** Injectable clock for tests. */
  now?: () => number;
  storm?: Partial<StormConfig>;
  /** Min ms between log lines for the SAME signature (spam suppression). */
  logThrottleMs?: number;
}

let resilient = false;

/** Flip the guard into "keep the process alive" mode (long-lived server host). */
export function setResilient(value: boolean): void {
  resilient = value;
}
export function isResilient(): boolean {
  return resilient;
}

/**
 * Pure meltdown detector. Entries MUST be chronological (ascending `t`). Returns
 * true when — within the trailing `windowMs` — either too many DISTINCT
 * signatures appear (a broad cascade ⇒ likely corrupted state) OR the total
 * count is extreme (a tight error loop pinning the CPU). A single signature
 * repeating at a moderate rate is NOT a storm.
 */
export function isErrorStorm(entries: readonly ErrEntry[], now: number, cfg: StormConfig): boolean {
  const cutoff = now - cfg.windowMs;
  let total = 0;
  const sigs = new Set<string>();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.t < cutoff) break;
    total++;
    sigs.add(e.sig);
    if (sigs.size >= cfg.distinctMax || total >= cfg.totalMax) return true;
  }
  return false;
}

/** A short, stable signature for an error: name + message head + first frame. */
export function errorSignature(err: unknown): string {
  if (err instanceof Error) {
    const frame =
      (err.stack ?? '').split('\n').find((l) => l.trim().startsWith('at'))?.trim() ?? '';
    return `${err.name}:${(err.message ?? '').slice(0, 120)}|${frame.slice(0, 160)}`;
  }
  return String(err).slice(0, 200);
}

function snapshot(): Record<string, number> {
  const p = process as unknown as {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  };
  return {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
    activeHandles: p._getActiveHandles?.().length ?? -1,
    activeRequests: p._getActiveRequests?.().length ?? -1,
  };
}

function clampEnv(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw != null ? Math.floor(Number(raw)) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

/**
 * Install the authoritative process-level handlers. Call EXACTLY ONCE, and make
 * sure no OTHER `uncaughtException`/`unhandledRejection` handler also calls
 * `process.exit` (a sibling exit would pre-empt the survive decision). Handlers
 * that only LOG (debug-logger) are fine to coexist.
 */
export function installCrashGuard(cfg: CrashGuardConfig = {}): void {
  const now = cfg.now ?? (() => Date.now());
  const storm: StormConfig = {
    windowMs: cfg.storm?.windowMs ?? clampEnv('HUU_CRASH_STORM_WINDOW_MS', 10_000, 500, 600_000),
    distinctMax: cfg.storm?.distinctMax ?? clampEnv('HUU_CRASH_STORM_DISTINCT', 15, 2, 100_000),
    totalMax: cfg.storm?.totalMax ?? clampEnv('HUU_CRASH_STORM_TOTAL', 500, 10, 1_000_000),
  };
  const throttleMs = cfg.logThrottleMs ?? 5_000;
  const entries: ErrEntry[] = [];
  const lastLogged = new Map<string, number>();
  const counts = new Map<string, number>();

  const handle = (kind: 'uncaughtException' | 'unhandledRejection', err: unknown): void => {
    const t = now();
    const sig = errorSignature(err);
    entries.push({ t, sig });
    if (entries.length > 1024) entries.splice(0, entries.length - 1024);
    const count = (counts.get(sig) ?? 0) + 1;
    counts.set(sig, count);
    const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);

    // Deduped structured log: first hit of a signature, then at most 1/throttle.
    const shouldLog = t - (lastLogged.get(sig) ?? -Infinity) >= throttleMs;
    if (shouldLog) {
      lastLogged.set(sig, t);
      try {
        dlog('error', 'crashguard', {
          kind,
          resilient,
          count,
          sig,
          stack: stack.slice(0, 2000),
          ...snapshot(),
        });
      } catch {
        /* logging must never itself throw us out */
      }
    }

    if (!resilient) {
      cfg.onFatalCleanup?.();
      try {
        process.stderr.write(`${kind}: ${stack}\n`);
      } catch {
        /* stderr may be closed */
      }
      process.exit(1);
      return;
    }

    // Resilient (long-lived host): survive unless it's a genuine meltdown.
    if (isErrorStorm(entries, t, storm)) {
      try {
        process.stderr.write(
          `huu: fatal error storm (window ${Math.round(storm.windowMs / 1000)}s) — exiting to avoid a wedged process. Last: ${stack.split('\n')[0]}\n`,
        );
      } catch {
        /* ignore */
      }
      cfg.onFatalCleanup?.();
      process.exit(1);
      return;
    }
    if (shouldLog) {
      try {
        process.stderr.write(
          `huu: contained ${kind} (server stays up; ${count}× this error): ${stack.split('\n')[0]}\n`,
        );
      } catch {
        /* ignore */
      }
    }
  };

  process.on('uncaughtException', (err) => handle('uncaughtException', err));
  process.on('unhandledRejection', (reason) => handle('unhandledRejection', reason));
}
