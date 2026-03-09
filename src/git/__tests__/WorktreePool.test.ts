import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { WorktreeManager } from '../WorktreeManager.js';
import { WorktreePool } from '../WorktreePool.js';

let tmpDir: string;
let manager: WorktreeManager;
let pool: WorktreePool;
let defaultBranch: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huu-pool-test-'));

  // Initialize a git repo with an initial commit
  const git = simpleGit({ baseDir: tmpDir });
  await git.init();
  await git.raw(['config', 'user.email', 'test@test.com']);
  await git.raw(['config', 'user.name', 'Test']);
  await git.raw(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
  await git.add('.');
  await git.commit('initial');

  // Detect default branch name (may be main, master, etc.)
  const branchOutput = await git.raw(['branch', '--show-current']);
  defaultBranch = branchOutput.trim();

  manager = new WorktreeManager(tmpDir);
  pool = new WorktreePool(manager, { maxPoolSize: 3 });
});

afterEach(async () => {
  try {
    await pool.drain();
  } catch {
    // Best effort cleanup
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('WorktreePool', () => {
  it('creates a new worktree on first acquire (cold path)', async () => {
    const lease = await pool.acquire('agent-1', defaultBranch);

    expect(lease.cold).toBe(true);
    expect(lease.worktreePath).toBeTruthy();
    expect(fs.existsSync(lease.worktreePath)).toBe(true);
    expect(pool.stats.coldCreations).toBe(1);
    expect(pool.stats.warmReuses).toBe(0);
    expect(pool.stats.leased).toBe(1);
  });

  it('reuses an idle worktree on second acquire (warm path)', async () => {
    // First acquire + recycle
    const lease1 = await pool.acquire('agent-1', defaultBranch);
    await pool.recycle(lease1.worktreeId, defaultBranch);

    expect(pool.stats.idle).toBe(1);

    // Second acquire should reuse
    const lease2 = await pool.acquire('agent-2', defaultBranch);

    expect(lease2.cold).toBe(false);
    expect(pool.stats.warmReuses).toBe(1);
    expect(pool.stats.leased).toBe(1);
    expect(pool.stats.idle).toBe(0);
  });

  it('ensures worktree is clean after recycle', async () => {
    const lease = await pool.acquire('agent-clean', defaultBranch);

    // Dirty the worktree
    await lease.git.raw(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(lease.worktreePath, 'dirty.txt'), 'dirty');
    await lease.git.add('.');
    await lease.git.commit('dirty commit');

    // Recycle
    await pool.recycle(lease.worktreeId, defaultBranch);

    // Acquire again
    const lease2 = await pool.acquire('agent-clean-2', defaultBranch);

    // Should be clean
    const status = await lease2.git.raw(['status', '--porcelain']);
    expect(status.trim()).toBe('');

    // The dirty file should not exist
    expect(fs.existsSync(path.join(lease2.worktreePath, 'dirty.txt'))).toBe(false);
  });

  it('respects pool size cap', async () => {
    // Acquire and recycle 3 (max pool size)
    const leases = [];
    for (let i = 0; i < 4; i++) {
      const lease = await pool.acquire(`agent-${i}`, defaultBranch);
      leases.push(lease);
    }

    // Recycle all
    for (const lease of leases) {
      await pool.recycle(lease.worktreeId, defaultBranch);
    }

    // Pool should have at most maxPoolSize idle
    expect(pool.stats.idle).toBeLessThanOrEqual(3);
  });

  it('provides accurate stats', async () => {
    expect(pool.stats.total).toBe(0);
    expect(pool.stats.idle).toBe(0);
    expect(pool.stats.leased).toBe(0);

    const lease = await pool.acquire('agent-stats', defaultBranch);
    expect(pool.stats.total).toBe(1);
    expect(pool.stats.leased).toBe(1);

    await pool.recycle(lease.worktreeId, defaultBranch);
    expect(pool.stats.idle).toBe(1);
    expect(pool.stats.leased).toBe(0);
    expect(pool.stats.recycleCount).toBe(0); // first time doesn't increment recycleCount
  });

  it('drain removes all non-leased worktrees', async () => {
    const lease1 = await pool.acquire('agent-drain-1', defaultBranch);
    await pool.recycle(lease1.worktreeId, defaultBranch);

    expect(pool.stats.idle).toBe(1);

    await pool.drain();

    expect(pool.stats.idle).toBe(0);
    expect(pool.stats.total).toBe(0);
  });

  it('reconcile removes quarantined entries', async () => {
    const lease = await pool.acquire('agent-reconcile', defaultBranch);

    // Manually corrupt the worktree path to trigger quarantine on recycle
    const poolEntry = (pool as unknown as { entries: Map<string, { state: string }> }).entries;
    for (const entry of poolEntry.values()) {
      if (entry.state === 'leased') {
        entry.state = 'quarantined';
      }
    }

    const result = await pool.reconcile();
    expect(result.removed).toBeGreaterThanOrEqual(1);
  });

  it('handles concurrent acquire/recycle without collision', async () => {
    // Multiple agents acquiring concurrently
    const acquirePromises = Array.from({ length: 3 }, (_, i) =>
      pool.acquire(`concurrent-${i}`, defaultBranch),
    );

    const leases = await Promise.all(acquirePromises);

    // All should be different worktrees
    const paths = new Set(leases.map((l) => l.worktreePath));
    expect(paths.size).toBe(3);

    // Recycle all concurrently
    await Promise.all(
      leases.map((l) => pool.recycle(l.worktreeId, defaultBranch)),
    );

    expect(pool.stats.leased).toBe(0);
  });
});
