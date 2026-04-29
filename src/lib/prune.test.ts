import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findStaleCidfiles,
  runPruneCli,
  type HuuContainer,
  type StaleCidfile,
} from './prune.js';

describe('findStaleCidfiles', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'huu-prune-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty when the cidfile dir does not exist', () => {
    expect(findStaleCidfiles(join(tmp, 'nope'))).toEqual([]);
  });

  it('skips files that do not match the cid-<pid>- pattern', () => {
    writeFileSync(join(tmp, 'random.txt'), 'x');
    writeFileSync(join(tmp, 'cid-not-a-pid.id'), 'x');
    expect(findStaleCidfiles(tmp)).toEqual([]);
  });

  it('does not flag a cidfile whose PID is the current (alive) process', () => {
    const path = join(tmp, `cid-${process.pid}-alive.id`);
    writeFileSync(path, 'fake-cid');
    expect(findStaleCidfiles(tmp)).toEqual([]);
  });

  it('flags cidfiles whose recorded PID is dead', () => {
    // PID 999999 is essentially guaranteed not to exist on a fresh
    // system; pid_max is typically 4194304 but most live systems sit
    // well under 999999.
    const path = join(tmp, `cid-999999-dead.id`);
    writeFileSync(path, 'dead-cid');
    const result = findStaleCidfiles(tmp);
    expect(result).toHaveLength(1);
    expect(result[0]?.pid).toBe(999999);
    expect(result[0]?.cid).toBe('dead-cid');
    expect(result[0]?.path).toBe(path);
  });

  it('handles unreadable cidfiles by reporting cid=null', () => {
    const path = join(tmp, `cid-999998-empty.id`);
    writeFileSync(path, ''); // empty file -> trim() yields '' -> null
    const result = findStaleCidfiles(tmp);
    expect(result).toHaveLength(1);
    expect(result[0]?.cid).toBeNull();
  });
});

describe('runPruneCli', () => {
  let outLines: string[];
  let errLines: string[];
  const stdout = (l: string) => outLines.push(l);
  const stderr = (l: string) => errLines.push(l);

  beforeEach(() => {
    outLines = [];
    errLines = [];
  });

  function fakeContainer(overrides: Partial<HuuContainer> = {}): HuuContainer {
    return {
      id: 'abc123def4567890',
      image: 'ghcr.io/owner/huu:latest',
      parentPid: 1234,
      parentAlive: false,
      createdAt: '2026-04-28T12:00:00Z',
      status: 'Up 5 minutes',
      ...overrides,
    };
  }

  function fakeCidfile(overrides: Partial<StaleCidfile> = {}): StaleCidfile {
    return {
      path: '/tmp/huu-cids/cid-1234-x.id',
      pid: 1234,
      cid: 'abc123def456',
      ...overrides,
    };
  }

  it('prints "no huu containers" when nothing exists (no mutation)', () => {
    const code = runPruneCli({
      args: [],
      stdout,
      stderr,
      containerLister: () => [],
      cidfileLister: () => [],
    });
    expect(code).toBe(0);
    expect(outLines.join('\n')).toContain('no huu containers');
  });

  it('--list prints containers and stale cidfiles without mutation', () => {
    const killed: string[] = [];
    const unlinked: string[] = [];
    const code = runPruneCli({
      args: ['--list'],
      stdout,
      stderr,
      containerLister: () => [fakeContainer({ parentAlive: true })],
      cidfileLister: () => [fakeCidfile()],
      killer: (cid) => {
        killed.push(cid);
        return true;
      },
      unlinker: (p) => {
        unlinked.push(p);
      },
    });
    expect(code).toBe(0);
    expect(killed).toEqual([]);
    expect(unlinked).toEqual([]);
    const out = outLines.join('\n');
    expect(out).toContain('huu containers');
    expect(out).toContain('abc123def456'); // truncated id
    expect(out).toContain('[parent alive]');
    expect(out).toContain('stale cidfiles');
  });

  it('--dry-run prints "would kill" and does not mutate', () => {
    const killed: string[] = [];
    const code = runPruneCli({
      args: ['--dry-run'],
      stdout,
      stderr,
      containerLister: () => [fakeContainer()],
      cidfileLister: () => [],
      killer: (cid) => {
        killed.push(cid);
        return true;
      },
    });
    expect(code).toBe(0);
    expect(killed).toEqual([]);
    expect(outLines.join('\n')).toMatch(/would kill 1/);
  });

  it('--json --list emits parseable output', () => {
    const code = runPruneCli({
      args: ['--list', '--json'],
      stdout,
      stderr,
      containerLister: () => [fakeContainer()],
      cidfileLister: () => [fakeCidfile()],
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(outLines.join('\n'));
    expect(parsed.containers).toHaveLength(1);
    expect(parsed.staleCidfiles).toHaveLength(1);
  });

  it('bare prune kills containers and removes cidfiles', () => {
    const killed: string[] = [];
    const unlinked: string[] = [];
    const code = runPruneCli({
      args: [],
      stdout,
      stderr,
      containerLister: () => [fakeContainer()],
      cidfileLister: () => [fakeCidfile()],
      killer: (cid) => {
        killed.push(cid);
        return true;
      },
      unlinker: (p) => {
        unlinked.push(p);
      },
    });
    expect(code).toBe(0);
    expect(killed).toEqual(['abc123def4567890']);
    expect(unlinked).toEqual(['/tmp/huu-cids/cid-1234-x.id']);
    expect(outLines.join('\n')).toContain('killed abc123def456');
  });

  it('returns non-zero when a kill fails', () => {
    const code = runPruneCli({
      args: [],
      stdout,
      stderr,
      containerLister: () => [fakeContainer()],
      cidfileLister: () => [],
      killer: () => false,
    });
    expect(code).toBe(1);
    expect(errLines.join('\n')).toMatch(/failed to kill/);
  });

  it('returns non-zero when a cidfile unlink fails', () => {
    const code = runPruneCli({
      args: [],
      stdout,
      stderr,
      containerLister: () => [],
      cidfileLister: () => [fakeCidfile()],
      unlinker: () => {
        throw new Error('EACCES');
      },
    });
    expect(code).toBe(1);
    expect(errLines.join('\n')).toMatch(/failed to remove/);
  });
});
