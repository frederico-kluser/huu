import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveRunSentinel,
  readActiveRunSentinel,
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
});
