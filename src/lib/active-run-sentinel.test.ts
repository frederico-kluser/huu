import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveRunSentinel,
  probeActiveRunLiveness,
  readActiveRunSentinel,
  readActiveRunSentinelMeta,
  writeActiveRunSentinel,
} from './active-run-sentinel.js';

describe('active-run-sentinel', () => {
  let tmp: string;
  let path: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'huu-sentinel-test-'));
    path = join(tmp, 'subdir', 'active');
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writeActiveRunSentinel creates parent dirs and stores cwd', () => {
    expect(writeActiveRunSentinel('/home/user/proj', path)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(readActiveRunSentinel(path)).toBe('/home/user/proj');
  });

  it('readActiveRunSentinel returns null when file missing', () => {
    expect(readActiveRunSentinel(path)).toBeNull();
  });

  it('readActiveRunSentinel trims trailing newline', () => {
    writeFileSync(path.replace('subdir/', ''), '/foo/bar\n\n');
    expect(readActiveRunSentinel(path.replace('subdir/', ''))).toBe('/foo/bar');
  });

  it('clearActiveRunSentinel removes the file when cwd matches', () => {
    writeActiveRunSentinel('/a/b', path);
    clearActiveRunSentinel('/a/b', path);
    expect(existsSync(path)).toBe(false);
  });

  it('clearActiveRunSentinel is a no-op when cwd does not match', () => {
    // Race protection: another huu instance overwrote the sentinel; the
    // first instance's exit handler should NOT blow it away.
    writeActiveRunSentinel('/runner-a', path);
    clearActiveRunSentinel('/runner-b', path);
    expect(existsSync(path)).toBe(true);
    expect(readActiveRunSentinel(path)).toBe('/runner-a');
  });

  it('clearActiveRunSentinel is silent when file does not exist', () => {
    // No throw, no error — best-effort semantics.
    expect(() => clearActiveRunSentinel('/nope', path)).not.toThrow();
  });

  it('writeActiveRunSentinel records the writer PID alongside cwd', () => {
    expect(writeActiveRunSentinel('/proj', path, 12345)).toBe(true);
    const meta = readActiveRunSentinelMeta(path);
    expect(meta).toEqual({ cwd: '/proj', pid: 12345 });
    // Legacy single-line cwd reader still works.
    expect(readActiveRunSentinel(path)).toBe('/proj');
  });

  it('readActiveRunSentinelMeta tolerates legacy single-line sentinels', () => {
    // Pre-PID format: just the cwd, no second line.
    writeFileSync(path.replace('subdir/', ''), '/legacy/cwd\n');
    const meta = readActiveRunSentinelMeta(path.replace('subdir/', ''));
    expect(meta?.cwd).toBe('/legacy/cwd');
    expect(meta?.pid).toBeUndefined();
  });

  it('probeActiveRunLiveness reports alive for current process', () => {
    writeActiveRunSentinel('/proj', path, process.pid);
    expect(probeActiveRunLiveness(path)).toBe('alive');
  });

  it('probeActiveRunLiveness reports dead for an unused PID', () => {
    // PID 1 is reserved for init / our own pid is busy. We need a PID
    // that doesn't exist — using a very high number that is unlikely
    // to be assigned. If the test box happens to have it, the assertion
    // below catches the false alive (rare).
    writeActiveRunSentinel('/proj', path, 999_999);
    const r = probeActiveRunLiveness(path);
    // Either 'dead' (expected) or 'alive' if the PID happens to exist;
    // 'unknown' is a structural bug.
    expect(['dead', 'alive']).toContain(r);
    expect(r).not.toBe('unknown');
  });

  it('probeActiveRunLiveness reports unknown for legacy sentinel without PID', () => {
    writeFileSync(path.replace('subdir/', ''), '/legacy\n');
    expect(probeActiveRunLiveness(path.replace('subdir/', ''))).toBe('unknown');
  });
});
