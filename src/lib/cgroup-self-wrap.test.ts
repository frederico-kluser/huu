import { describe, expect, it } from 'vitest';
import {
  buildSystemdRunArgv,
  computeCgroupLimits,
  decideCgroupWrap,
} from './cgroup-self-wrap.js';

const GiB = 1024 ** 3;

describe('decideCgroupWrap', () => {
  const env = {};

  it('wraps a plain native Linux run', () => {
    const d = decideCgroupWrap([], env, 'linux');
    expect(d.shouldWrap).toBe(true);
  });

  it('never wraps off-Linux', () => {
    expect(decideCgroupWrap([], env, 'darwin').shouldWrap).toBe(false);
    expect(decideCgroupWrap([], env, 'win32').shouldWrap).toBe(false);
  });

  it('short-circuits when already wrapped (the re-exec marker)', () => {
    expect(decideCgroupWrap([], { HUU_CGROUP_WRAPPED: '1' }, 'linux').shouldWrap).toBe(false);
  });

  it('HUU_NO_CGROUP opts out', () => {
    expect(decideCgroupWrap([], { HUU_NO_CGROUP: '1' }, 'linux').shouldWrap).toBe(false);
    expect(decideCgroupWrap([], { HUU_NO_CGROUP: 'true' }, 'linux').shouldWrap).toBe(false);
  });

  it('skips inside the container (docker --memory owns the ceiling)', () => {
    expect(decideCgroupWrap([], { HUU_IN_CONTAINER: '1' }, 'linux').shouldWrap).toBe(false);
  });

  it('skips help and short-lived native subcommands', () => {
    expect(decideCgroupWrap(['--help'], env, 'linux').shouldWrap).toBe(false);
    expect(decideCgroupWrap(['status'], env, 'linux').shouldWrap).toBe(false);
    expect(decideCgroupWrap(['prune'], env, 'linux').shouldWrap).toBe(false);
    expect(decideCgroupWrap(['init-docker'], env, 'linux').shouldWrap).toBe(false);
  });

  it('still wraps flag-only invocations like --no-docker --web', () => {
    expect(decideCgroupWrap(['--no-docker', '--web'], env, 'linux').shouldWrap).toBe(true);
  });
});

describe('computeCgroupLimits', () => {
  it('sizes high/max from the OS reserve (host protection, not the dial)', () => {
    const total = 32 * GiB;
    const l = computeCgroupLimits(total, {});
    const reserve = total * 0.08; // 32 GiB desktop → 8% adaptive reserve
    expect(l.memoryHighBytes).toBe(Math.floor(total - reserve));
    expect(l.memoryMaxBytes).toBe(Math.floor(total - reserve / 2));
    expect(l.memoryMaxBytes).toBeGreaterThan(l.memoryHighBytes);
    expect(l.memorySwapMaxBytes).toBe(4096 * 1024 * 1024); // default 4 GiB
    expect(l.tasksMax).toBe(8192);
  });

  it('HUU_SWAP_MAX_MB overrides the scope swap allowance (0 = no swap)', () => {
    const l0 = computeCgroupLimits(32 * GiB, { HUU_SWAP_MAX_MB: '0' });
    expect(l0.memorySwapMaxBytes).toBe(0);
    const l8 = computeCgroupLimits(32 * GiB, { HUU_SWAP_MAX_MB: '8192' });
    expect(l8.memorySwapMaxBytes).toBe(8192 * 1024 * 1024);
    const bad = computeCgroupLimits(32 * GiB, { HUU_SWAP_MAX_MB: 'garbage' });
    expect(bad.memorySwapMaxBytes).toBe(4096 * 1024 * 1024);
  });
});

describe('buildSystemdRunArgv', () => {
  it('produces a foreground user scope with all four limits', () => {
    const limits = computeCgroupLimits(32 * GiB, {});
    const argv = buildSystemdRunArgv(limits, 'huu-123', ['node', 'cli.js', '--web']);
    expect(argv).toContain('--user');
    expect(argv).toContain('--scope');
    expect(argv).toContain('--collect');
    expect(argv).toContain('--unit=huu-123');
    expect(argv).toContain(`MemoryHigh=${limits.memoryHighBytes}`);
    expect(argv).toContain(`MemoryMax=${limits.memoryMaxBytes}`);
    expect(argv).toContain(`MemorySwapMax=${limits.memorySwapMaxBytes}`);
    expect(argv).toContain('TasksMax=8192');
    // Command comes after the `--` separator, untouched.
    const sep = argv.indexOf('--');
    expect(argv.slice(sep + 1)).toEqual(['node', 'cli.js', '--web']);
  });
});
