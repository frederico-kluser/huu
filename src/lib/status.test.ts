import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findLatestDebugLog,
  reduceTail,
  resolveStatus,
  runStatusCli,
} from './status.js';

// Synthetic NDJSON helper. Times are absolute ms epoch — the parser
// reads `t` as ISO and falls back to 0 if invalid, so we always emit
// real ISO strings.
function ndjson(lines: Array<Record<string, unknown>>): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

const T0 = Date.parse('2026-04-28T20:00:00.000Z');

describe('findLatestDebugLog', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'huu-status-find-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when .huu/ does not exist', () => {
    expect(findLatestDebugLog(tmp)).toBeNull();
  });

  it('returns null when .huu/ exists but has no debug logs', () => {
    mkdirSync(join(tmp, '.huu'));
    writeFileSync(join(tmp, '.huu', 'unrelated.txt'), 'x');
    expect(findLatestDebugLog(tmp)).toBeNull();
  });

  it('picks the most recently modified debug-*.log', () => {
    const dir = join(tmp, '.huu');
    mkdirSync(dir);
    const older = join(dir, 'debug-2026-01-01.log');
    const newer = join(dir, 'debug-2026-04-28.log');
    writeFileSync(older, 'a\n');
    writeFileSync(newer, 'b\n');
    // Force a deterministic ordering: tmpfs / fast SSDs sometimes give
    // the two writes the same mtimeNs. utimesSync sets the mtime in
    // seconds-resolution which is enough for our find.
    const now = Date.now() / 1000;
    utimesSync(older, now - 60, now - 60);
    utimesSync(newer, now, now);
    expect(findLatestDebugLog(tmp)).toBe(newer);
  });
});

describe('reduceTail', () => {
  const ctx = { logPath: '/x/log', logSizeBytes: 0, logMtime: 0 };

  it('returns unknown phase on empty input', () => {
    const r = reduceTail(
      '',
      { logPath: null, logSizeBytes: null, logMtime: null },
      { now: T0, stalledAfterMs: 30_000 },
    );
    expect(r.phase).toBe('unknown');
    expect(r.lastEventAt).toBeNull();
  });

  it('classifies running when last event is recent', () => {
    const tail = ndjson([
      { t: iso(T0 - 5_000), cat: 'lifecycle', ev: 'cli_start', pid: 1 },
      { t: iso(T0 - 1_000), cat: 'orch', ev: 'spawn_start' },
      { t: iso(T0 - 200), cat: 'heartbeat', ev: 'tick', lagMs: 4 },
    ]);
    const r = reduceTail(
      tail,
      { ...ctx, logSizeBytes: tail.length },
      { now: T0, stalledAfterMs: 30_000 },
    );
    expect(r.phase).toBe('running');
    expect(r.startedAt).toBe(T0 - 5_000);
    expect(r.lastHeartbeatLagMs).toBe(4);
    expect(r.counters.spawns).toBe(1);
  });

  it('classifies stalled when nothing recent', () => {
    const tail = ndjson([
      { t: iso(T0 - 5 * 60_000), cat: 'orch', ev: 'spawn_start' },
    ]);
    const r = reduceTail(
      tail,
      { ...ctx, logSizeBytes: tail.length },
      { now: T0, stalledAfterMs: 30_000 },
    );
    expect(r.phase).toBe('stalled');
  });

  it('classifies finished on lifecycle.exit code 0', () => {
    const tail = ndjson([
      { t: iso(T0 - 60_000), cat: 'orch', ev: 'spawn_start' },
      { t: iso(T0 - 100), cat: 'lifecycle', ev: 'exit', code: 0 },
    ]);
    const r = reduceTail(
      tail,
      { ...ctx, logSizeBytes: tail.length },
      { now: T0, stalledAfterMs: 30_000 },
    );
    expect(r.phase).toBe('finished');
    expect(r.exit?.code).toBe(0);
  });

  it('classifies crashed on non-zero exit', () => {
    const tail = ndjson([
      { t: iso(T0 - 100), cat: 'lifecycle', ev: 'exit', code: 1 },
    ]);
    const r = reduceTail(
      tail,
      { ...ctx, logSizeBytes: tail.length },
      { now: T0, stalledAfterMs: 30_000 },
    );
    expect(r.phase).toBe('crashed');
  });

  it('classifies crashed on uncaughtException event', () => {
    const tail = ndjson([
      { t: iso(T0 - 50), cat: 'error', ev: 'uncaughtException', msg: 'boom' },
    ]);
    const r = reduceTail(
      tail,
      { ...ctx, logSizeBytes: tail.length },
      { now: T0, stalledAfterMs: 30_000 },
    );
    expect(r.phase).toBe('crashed');
    expect(r.crash?.reason).toBe('boom');
  });

  it('aggregates orchestrator counters', () => {
    const tail = ndjson([
      { t: iso(T0 - 5000), cat: 'orch', ev: 'stage_advance' },
      { t: iso(T0 - 4000), cat: 'orch', ev: 'spawn_start' },
      { t: iso(T0 - 3000), cat: 'orch', ev: 'spawn_start' },
      { t: iso(T0 - 2000), cat: 'orch', ev: 'stage_advance' },
      { t: iso(T0 - 1000), cat: 'orch', ev: 'spawn_start' },
    ]);
    const r = reduceTail(
      tail,
      { ...ctx, logSizeBytes: tail.length },
      { now: T0, stalledAfterMs: 30_000 },
    );
    expect(r.counters.stagesAdvanced).toBe(2);
    expect(r.counters.spawns).toBe(3);
  });

  it('drops the first (likely partial) line when tail is smaller than file', () => {
    // The first synthetic line has a malformed t; a lazy parser would
    // surface it as an error. The tail logic should simply drop it.
    const tail =
      'partial-or-malformed-leading-line\n' +
      ndjson([{ t: iso(T0 - 100), cat: 'orch', ev: 'spawn_start' }]);
    const r = reduceTail(
      tail,
      { ...ctx, logSizeBytes: tail.length + 1024 },
      { now: T0, stalledAfterMs: 30_000 },
    );
    expect(r.phase).toBe('running');
    expect(r.counters.spawns).toBe(1);
  });
});

describe('resolveStatus end-to-end', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'huu-status-e2e-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reports unknown when no log exists', () => {
    const r = resolveStatus({ repoRoot: tmp, now: T0 });
    expect(r.phase).toBe('unknown');
    expect(r.logPath).toBeNull();
  });

  it('reads a real log file and reports running', () => {
    const dir = join(tmp, '.huu');
    mkdirSync(dir);
    const logPath = join(dir, 'debug-2026-04-28T20-00-00.log');
    writeFileSync(
      logPath,
      ndjson([
        { t: iso(T0 - 200), cat: 'lifecycle', ev: 'cli_start' },
        { t: iso(T0 - 100), cat: 'orch', ev: 'spawn_start' },
      ]),
    );
    const r = resolveStatus({ repoRoot: tmp, now: T0 });
    expect(r.phase).toBe('running');
    expect(r.logPath).toBe(logPath);
    expect((r.logSizeBytes ?? 0) > 0).toBe(true);
  });
});

describe('runStatusCli', () => {
  let tmp: string;
  let outLines: string[];
  let errLines: string[];
  const stdout = (l: string) => outLines.push(l);
  const stderr = (l: string) => errLines.push(l);

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'huu-status-cli-'));
    outLines = [];
    errLines = [];
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeLog(events: Array<Record<string, unknown>>) {
    const dir = join(tmp, '.huu');
    mkdirSync(dir);
    writeFileSync(join(dir, 'debug-test.log'), ndjson(events));
  }

  it('exits 2 when no log found', () => {
    const code = runStatusCli({ args: [], cwd: tmp, now: T0, stdout, stderr });
    expect(code).toBe(2);
    expect(outLines.join('\n')).toContain('no run log found');
  });

  it('exits 0 when running', () => {
    writeLog([
      { t: iso(T0 - 100), cat: 'lifecycle', ev: 'cli_start' },
      { t: iso(T0 - 50), cat: 'orch', ev: 'spawn_start' },
    ]);
    const code = runStatusCli({ args: [], cwd: tmp, now: T0, stdout, stderr });
    expect(code).toBe(0);
    expect(outLines.join('\n')).toContain('status:        running');
  });

  it('exits 1 when stalled', () => {
    writeLog([{ t: iso(T0 - 5 * 60_000), cat: 'orch', ev: 'spawn_start' }]);
    const code = runStatusCli({ args: [], cwd: tmp, now: T0, stdout, stderr });
    expect(code).toBe(1);
    expect(outLines.join('\n')).toContain('status:        stalled');
    expect(errLines.join('\n')).toContain('may be stuck');
  });

  it('--liveness exits 0 for a healthy running pipeline and stays silent', () => {
    writeLog([{ t: iso(T0 - 100), cat: 'orch', ev: 'spawn_start' }]);
    const code = runStatusCli({
      args: ['--liveness'],
      cwd: tmp,
      now: T0,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(outLines).toEqual([]);
    expect(errLines).toEqual([]);
  });

  it('--liveness exits 0 for a finished run (clean exit isnt unhealthy)', () => {
    writeLog([{ t: iso(T0 - 100), cat: 'lifecycle', ev: 'exit', code: 0 }]);
    const code = runStatusCli({
      args: ['--liveness'],
      cwd: tmp,
      now: T0,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
  });

  it('--liveness exits 0 when no log exists (idle container is healthy)', () => {
    const code = runStatusCli({
      args: ['--liveness'],
      cwd: tmp,
      now: T0,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
  });

  it('--liveness exits 1 when stalled', () => {
    writeLog([{ t: iso(T0 - 5 * 60_000), cat: 'orch', ev: 'spawn_start' }]);
    const code = runStatusCli({
      args: ['--liveness'],
      cwd: tmp,
      now: T0,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
  });

  it('--liveness exits 1 when crashed', () => {
    writeLog([{ t: iso(T0 - 100), cat: 'lifecycle', ev: 'exit', code: 1 }]);
    const code = runStatusCli({
      args: ['--liveness'],
      cwd: tmp,
      now: T0,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
  });

  it('--json emits parseable output', () => {
    writeLog([
      { t: iso(T0 - 100), cat: 'lifecycle', ev: 'cli_start' },
      { t: iso(T0 - 50), cat: 'orch', ev: 'spawn_start' },
    ]);
    const code = runStatusCli({
      args: ['--json'],
      cwd: tmp,
      now: T0,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(outLines.join('\n'));
    expect(parsed.phase).toBe('running');
    expect(parsed.counters.spawns).toBe(1);
  });

  it('--stalled-after lets caller widen the stall window', () => {
    writeLog([{ t: iso(T0 - 60_000), cat: 'orch', ev: 'spawn_start' }]);
    // With default 30s threshold, this would be stalled. Override to 120s.
    const code = runStatusCli({
      args: ['--stalled-after', '120'],
      cwd: tmp,
      now: T0,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(outLines.join('\n')).toContain('status:        running');
  });
});
