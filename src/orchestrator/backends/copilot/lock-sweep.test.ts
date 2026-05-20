import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepOrphanLocks } from './lock-sweep.js';

describe('sweepOrphanLocks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'huu-lock-sweep-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when the session-state dir does not exist', () => {
    expect(sweepOrphanLocks(join(tmpDir, 'nonexistent'))).toBe(0);
  });

  it('returns 0 when there are no lock files', () => {
    mkdirSync(join(tmpDir, 'state', 'session-1'), { recursive: true });
    writeFileSync(join(tmpDir, 'state', 'session-1', 'events.jsonl'), '');
    expect(sweepOrphanLocks(join(tmpDir, 'state'))).toBe(0);
  });

  it('removes locks whose PID is dead (ESRCH)', () => {
    // Use PID 1 as alive (init/launchd always exists), and pick a
    // very high PID that's almost certainly not in use as the dead one.
    const stateDir = join(tmpDir, 'state');
    mkdirSync(join(stateDir, 'session-A'), { recursive: true });
    const deadPid = 9999999; // ulimit on typical systems is < 4M
    const deadLock = join(stateDir, 'session-A', `inuse.${deadPid}.lock`);
    writeFileSync(deadLock, '');

    const removed = sweepOrphanLocks(stateDir);
    expect(removed).toBe(1);
    expect(existsSync(deadLock)).toBe(false);
  });

  it('keeps locks whose PID is alive', () => {
    const stateDir = join(tmpDir, 'state');
    mkdirSync(join(stateDir, 'session-B'), { recursive: true });
    const ourPid = process.pid; // definitely alive
    const aliveLock = join(stateDir, 'session-B', `inuse.${ourPid}.lock`);
    writeFileSync(aliveLock, '');

    const removed = sweepOrphanLocks(stateDir);
    expect(removed).toBe(0);
    expect(existsSync(aliveLock)).toBe(true);
  });

  it('ignores files that do not match the inuse.<pid>.lock pattern', () => {
    const stateDir = join(tmpDir, 'state');
    mkdirSync(join(stateDir, 'session-C'), { recursive: true });
    writeFileSync(join(stateDir, 'session-C', 'events.jsonl'), 'data');
    writeFileSync(join(stateDir, 'session-C', 'inuse.foo.lock'), 'bad-pid');
    writeFileSync(join(stateDir, 'session-C', 'random.lock'), 'noop');

    const removed = sweepOrphanLocks(stateDir);
    expect(removed).toBe(0);
    expect(existsSync(join(stateDir, 'session-C', 'events.jsonl'))).toBe(true);
  });

  it('sweeps across multiple session subdirectories', () => {
    const stateDir = join(tmpDir, 'state');
    mkdirSync(join(stateDir, 's1'), { recursive: true });
    mkdirSync(join(stateDir, 's2'), { recursive: true });
    const deadPid1 = 9999998;
    const deadPid2 = 9999997;
    writeFileSync(join(stateDir, 's1', `inuse.${deadPid1}.lock`), '');
    writeFileSync(join(stateDir, 's2', `inuse.${deadPid2}.lock`), '');

    const removed = sweepOrphanLocks(stateDir);
    expect(removed).toBe(2);
  });

  it('skips non-directory entries at the top level', () => {
    const stateDir = join(tmpDir, 'state');
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, 'a-stray-file'), 'x'); // not a dir
    expect(() => sweepOrphanLocks(stateDir)).not.toThrow();
  });
});
