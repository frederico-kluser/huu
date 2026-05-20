import { openSync, closeSync, fstatSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Headless status reporter for huu runs. Parses the NDJSON debug log
 * the lifecycle layer writes to `<repo>/.huu/debug-<ISO>.log` and
 * answers three questions:
 *
 *   1. Is a run currently active in this repo?
 *   2. If yes, when was the last activity, and which stage / spawn?
 *   3. If no, did the last run exit cleanly?
 *
 * Pure logic — no console output, no process.exit. The CLI wrapper
 * decides output formatting and exit code.
 *
 * Reads only the last DEFAULT_TAIL_BYTES of the log so a multi-day
 * overnight run with hundreds of MB of heartbeats doesn't blow the
 * memory budget. NDJSON is line-delimited, so we drop the first
 * (potentially partial) line of the tail.
 */

const DEFAULT_TAIL_BYTES = 256 * 1024; // 256 KiB ≈ tens of seconds of heartbeats

export type RunPhase = 'running' | 'finished' | 'stalled' | 'crashed' | 'unknown';

export interface StatusReport {
  /** Path to the log we read; null when no run log exists in this repo. */
  logPath: string | null;
  logSizeBytes: number | null;
  /** When the log file was last modified (ms epoch). */
  logMtime: number | null;
  phase: RunPhase;
  /** Wall time of the last NDJSON event we could parse. */
  lastEventAt: number | null;
  /** Wall time of the last heartbeat tick. */
  lastHeartbeatAt: number | null;
  /** lagMs from the most recent heartbeat. */
  lastHeartbeatLagMs: number | null;
  /** Last non-heartbeat event for human-readable summary. */
  lastActivity: { cat: string; ev: string; t: number } | null;
  /** Lifecycle exit event, if present. */
  exit: { code: number; t: number } | null;
  /** Crash event, if present. */
  crash: { reason: string; t: number } | null;
  /** Aggregate counters from parsed events. */
  counters: {
    stagesAdvanced: number;
    spawns: number;
    errors: number;
  };
  /** When the run started, per the cli_start event. */
  startedAt: number | null;
}

export interface ResolveStatusOptions {
  /** Repo root to look in (must contain .huu/). */
  repoRoot: string;
  /** Override "now" for deterministic tests. */
  now?: number;
  /** Stall threshold — no events for more than this in ms = stalled. */
  stalledAfterMs?: number;
}

/**
 * Find the most recently-modified `debug-*.log` under `<repoRoot>/.huu/`.
 * Returns null when the .huu/ directory doesn't exist or has no logs.
 */
export function findLatestDebugLog(repoRoot: string): string | null {
  const dir = join(repoRoot, '.huu');
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  let best: { path: string; mtime: number } | null = null;
  for (const name of entries) {
    if (!name.startsWith('debug-') || !name.endsWith('.log')) continue;
    const path = join(dir, name);
    let mtime: number;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtime > best.mtime) best = { path, mtime };
  }
  return best?.path ?? null;
}

/** Read the trailing `bytes` of a file as utf-8. Returns '' on any error. */
export function tailFile(path: string, bytes: number): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    const start = Math.max(0, stat.size - bytes);
    const length = stat.size - start;
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* nothing */
      }
    }
  }
}

interface ParsedEvent {
  t: number; // epoch ms
  cat: string;
  ev: string;
  raw: Record<string, unknown>;
}

function parseLine(line: string): ParsedEvent | null {
  if (!line) return null;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const tStr = parsed.t;
    const cat = parsed.cat;
    const ev = parsed.ev;
    if (typeof tStr !== 'string' || typeof cat !== 'string' || typeof ev !== 'string') {
      return null;
    }
    const t = Date.parse(tStr);
    if (Number.isNaN(t)) return null;
    return { t, cat, ev, raw: parsed };
  } catch {
    return null;
  }
}

/**
 * Reduce a tail of NDJSON lines into a StatusReport. Exposed separately
 * so tests can drive it with synthetic lines instead of writing files.
 */
export function reduceTail(
  tail: string,
  context: { logPath: string | null; logSizeBytes: number | null; logMtime: number | null },
  opts: { now: number; stalledAfterMs: number },
): StatusReport {
  const report: StatusReport = {
    logPath: context.logPath,
    logSizeBytes: context.logSizeBytes,
    logMtime: context.logMtime,
    phase: 'unknown',
    lastEventAt: null,
    lastHeartbeatAt: null,
    lastHeartbeatLagMs: null,
    lastActivity: null,
    exit: null,
    crash: null,
    counters: { stagesAdvanced: 0, spawns: 0, errors: 0 },
    startedAt: null,
  };
  if (!tail) {
    report.phase = context.logPath ? 'unknown' : 'unknown';
    return report;
  }

  // The tail probably starts mid-line (we sliced at a byte boundary), so
  // drop the first line unless we read from offset 0. We can't tell from
  // here; safest is to always drop it. For tiny logs the caller passes
  // the whole content and the first line is genuinely the first record —
  // we lose it. Acceptable: tiny logs are rare and never the steady state.
  const lines = tail.split('\n');
  const startIdx = (context.logSizeBytes ?? Infinity) > tail.length ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const ev = parseLine(lines[i]);
    if (!ev) continue;
    if (ev.t > (report.lastEventAt ?? 0)) report.lastEventAt = ev.t;

    if (ev.cat === 'lifecycle' && ev.ev === 'cli_start') {
      report.startedAt = ev.t;
    } else if (ev.cat === 'lifecycle' && ev.ev === 'exit') {
      const code = typeof ev.raw.code === 'number' ? ev.raw.code : 0;
      report.exit = { code, t: ev.t };
    } else if (ev.cat === 'error') {
      const reason =
        typeof ev.raw.msg === 'string'
          ? ev.raw.msg
          : typeof ev.raw.reason === 'string'
            ? ev.raw.reason
            : ev.ev;
      report.crash = { reason, t: ev.t };
      report.counters.errors += 1;
    } else if (ev.cat === 'heartbeat' && ev.ev === 'tick') {
      report.lastHeartbeatAt = ev.t;
      const lag = ev.raw.lagMs;
      if (typeof lag === 'number') report.lastHeartbeatLagMs = lag;
    } else {
      // Non-heartbeat, non-lifecycle, non-error: counts as activity.
      report.lastActivity = { cat: ev.cat, ev: ev.ev, t: ev.t };
      if (ev.cat === 'orch' && ev.ev === 'stage_advance') {
        report.counters.stagesAdvanced += 1;
      }
      if (ev.cat === 'orch' && ev.ev === 'spawn_start') {
        report.counters.spawns += 1;
      }
    }
  }

  // Phase reduction. Order matters: an exit takes precedence over a
  // crash, a crash over stalled, stalled over running.
  if (report.exit) {
    report.phase = report.exit.code === 0 ? 'finished' : 'crashed';
  } else if (report.crash) {
    report.phase = 'crashed';
  } else if (report.lastEventAt !== null) {
    const idleMs = opts.now - report.lastEventAt;
    report.phase = idleMs > opts.stalledAfterMs ? 'stalled' : 'running';
  } else {
    report.phase = 'unknown';
  }

  return report;
}

/**
 * Top-level: locate the most recent debug log under `repoRoot`, read its
 * tail, and return a StatusReport. When no log exists, returns a report
 * with phase=unknown and logPath=null.
 */
export function resolveStatus(opts: ResolveStatusOptions): StatusReport {
  const now = opts.now ?? Date.now();
  const stalledAfterMs = opts.stalledAfterMs ?? 30_000;
  const logPath = findLatestDebugLog(opts.repoRoot);
  if (!logPath) {
    return reduceTail(
      '',
      { logPath: null, logSizeBytes: null, logMtime: null },
      { now, stalledAfterMs },
    );
  }
  let logSize: number;
  let logMtime: number;
  try {
    const s = statSync(logPath);
    logSize = s.size;
    logMtime = s.mtimeMs;
  } catch {
    return reduceTail(
      '',
      { logPath, logSizeBytes: null, logMtime: null },
      { now, stalledAfterMs },
    );
  }
  const tail = tailFile(logPath, DEFAULT_TAIL_BYTES);
  return reduceTail(
    tail,
    { logPath, logSizeBytes: logSize, logMtime },
    { now, stalledAfterMs },
  );
}

// ─────────── CLI rendering ───────────

function formatDurationMs(ms: number): string {
  if (ms < 0) return '0s';
  if (ms < 1_000) return `${ms}ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m - h * 60;
  return `${h}h ${rm}m ${rs}s`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KiB`;
  return `${(b / 1024 / 1024).toFixed(1)} MiB`;
}

export function renderStatusText(report: StatusReport, now: number, repoRoot: string): string {
  const lines: string[] = [];
  lines.push(`huu status — ${repoRoot}`);
  if (!report.logPath) {
    lines.push('  no run log found in .huu/ (no past or current runs in this repo)');
    return lines.join('\n');
  }
  lines.push(`  log:           ${report.logPath} (${formatBytes(report.logSizeBytes ?? 0)})`);
  lines.push(`  status:        ${report.phase}`);
  if (report.startedAt !== null) {
    lines.push(`  started:       ${formatDurationMs(now - report.startedAt)} ago`);
  }
  if (report.lastEventAt !== null) {
    lines.push(`  last event:    ${formatDurationMs(now - report.lastEventAt)} ago`);
  }
  if (report.lastActivity) {
    lines.push(
      `  last activity: ${formatDurationMs(now - report.lastActivity.t)} ago (${report.lastActivity.cat}.${report.lastActivity.ev})`,
    );
  }
  if (report.lastHeartbeatAt !== null) {
    const lag =
      report.lastHeartbeatLagMs !== null ? `, lag=${report.lastHeartbeatLagMs}ms` : '';
    lines.push(`  heartbeat:     ${formatDurationMs(now - report.lastHeartbeatAt)} ago${lag}`);
  }
  lines.push(
    `  counters:      stages=${report.counters.stagesAdvanced} spawns=${report.counters.spawns} errors=${report.counters.errors}`,
  );
  if (report.exit) {
    lines.push(`  exit:          code=${report.exit.code} (${formatDurationMs(now - report.exit.t)} ago)`);
  }
  if (report.crash) {
    lines.push(`  crash:         ${report.crash.reason} (${formatDurationMs(now - report.crash.t)} ago)`);
  }
  return lines.join('\n');
}

export interface RunStatusCliOptions {
  args: string[];
  cwd: string;
  /** Test seam — defaults to Date.now(). */
  now?: number;
  /** Test seam — defaults to console.log/console.error. */
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

/**
 * CLI entry point. Returns an exit code:
 *   0 — running or finished cleanly
 *   1 — stalled or crashed
 *   2 — no log found
 *
 * Recognized flags:
 *   --json                Machine-readable output.
 *   --liveness            Suppress text output; exit 0 unless stalled or
 *                         crashed. Maps to Docker HEALTHCHECK semantics:
 *                         "is the container ACTIVELY broken?" — idle, no
 *                         active run, or a clean finish all count as 0.
 *   --stalled-after <s>   Override the stall threshold (seconds; default 30).
 */
export function runStatusCli(opts: RunStatusCliOptions): number {
  const stdout = opts.stdout ?? ((l: string) => console.log(l));
  const stderr = opts.stderr ?? ((l: string) => console.error(l));
  const now = opts.now ?? Date.now();

  const json = opts.args.includes('--json');
  const liveness = opts.args.includes('--liveness');
  let stalledAfterMs = 30_000;
  for (let i = 0; i < opts.args.length; i++) {
    if (opts.args[i] === '--stalled-after' && opts.args[i + 1]) {
      const sec = Number(opts.args[i + 1]);
      if (!Number.isNaN(sec) && sec > 0) stalledAfterMs = sec * 1_000;
      i++;
    }
  }

  const report = resolveStatus({ repoRoot: opts.cwd, now, stalledAfterMs });

  if (liveness) {
    return report.phase === 'stalled' || report.phase === 'crashed' ? 1 : 0;
  }

  if (json) {
    stdout(JSON.stringify(report, null, 2));
  } else {
    stdout(renderStatusText(report, now, opts.cwd));
  }

  if (!report.logPath) return 2;
  if (report.phase === 'stalled' || report.phase === 'crashed') {
    if (!json) {
      stderr(
        report.phase === 'stalled'
          ? `(no events in over ${Math.round(stalledAfterMs / 1000)}s — may be stuck)`
          : `(crash detected — see log for details)`,
      );
    }
    return 1;
  }
  return 0;
}
