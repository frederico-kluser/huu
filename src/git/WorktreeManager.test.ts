import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import {
  WorktreeManager,
  WorktreeError,
  parseWorktreePorcelain,
} from './WorktreeManager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The default branch after `git init` + first commit. */
let defaultBranch: string;

async function createTempRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huu-wt-test-'));
  const git = simpleGit({ baseDir: dir });
  await git.init();
  await git.raw(['config', 'user.email', 'test@huu.dev']);
  await git.raw(['config', 'user.name', 'HUU Test']);

  // Create initial commit so branches can exist
  const readmePath = path.join(dir, 'README.md');
  fs.writeFileSync(readmePath, '# Test Repo\n');
  await git.add('.');
  await git.commit('initial commit');

  // Detect default branch name (master or main depending on git config)
  defaultBranch = (await git.raw(['branch', '--show-current'])).trim();

  return dir;
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorktreeManager', () => {
  let repoDir: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    repoDir = await createTempRepo();
    manager = new WorktreeManager(repoDir);
  });

  afterEach(() => {
    cleanupDir(repoDir);
  });

  // -------------------------------------------------------------------------
  // Deterministic naming
  // -------------------------------------------------------------------------

  describe('deterministic naming', () => {
    it('maps agentId to branch name', () => {
      expect(manager.branchNameFor('builder-1')).toBe(
        'huu-agent/builder-1',
      );
    });

    it('maps agentId to worktree path', () => {
      const expected = path.join(repoDir, '.huu-worktrees', 'builder-1');
      expect(manager.worktreePathFor('builder-1')).toBe(expected);
    });

    it('extracts agentId from branch name', () => {
      expect(
        manager.agentIdFromBranch('refs/heads/huu-agent/builder-1'),
      ).toBe('builder-1');
      expect(
        manager.agentIdFromBranch('huu-agent/builder-1'),
      ).toBe('builder-1');
    });

    it('returns undefined for non-huu branch', () => {
      expect(manager.agentIdFromBranch('refs/heads/main')).toBeUndefined();
    });

    it('extracts agentId from path', () => {
      const wtPath = path.join(repoDir, '.huu-worktrees', 'tester-2');
      expect(manager.agentIdFromPath(wtPath)).toBe('tester-2');
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe('validation', () => {
    it('rejects empty agentId', async () => {
      await expect(manager.create('', defaultBranch)).rejects.toThrow(
        WorktreeError,
      );
    });

    it('rejects agentId with invalid chars', async () => {
      await expect(manager.create('bad/id', defaultBranch)).rejects.toThrow(
        WorktreeError,
      );
      await expect(manager.create('bad id', defaultBranch)).rejects.toThrow(
        WorktreeError,
      );
    });

    it('rejects non-existent base branch', async () => {
      await expect(
        manager.create('agent-1', 'no-such-branch'),
      ).rejects.toThrow(WorktreeError);
    });
  });

  // -------------------------------------------------------------------------
  // create / list / remove (happy path)
  // -------------------------------------------------------------------------

  describe('create / list / remove', () => {
    it('creates a worktree and lists it', async () => {
      const info = await manager.create('agent-1', defaultBranch);

      expect(info.agentId).toBe('agent-1');
      expect(info.branch).toBe('refs/heads/huu-agent/agent-1');
      expect(info.locked).toBe(true);
      expect(fs.existsSync(info.path)).toBe(true);

      const listed = await manager.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.agentId).toBe('agent-1');
    });

    it('creates worktree without lock', async () => {
      const info = await manager.create('agent-no-lock', defaultBranch, {
        lock: false,
      });
      expect(info.locked).toBe(false);
    });

    it('removes a worktree and its branch', async () => {
      await manager.create('agent-2', defaultBranch);
      await manager.remove('agent-2');

      const listed = await manager.list();
      expect(listed).toHaveLength(0);

      // Branch should be deleted
      const git = simpleGit({ baseDir: repoDir });
      const branches = await git.branch();
      expect(branches.all).not.toContain('huu-agent/agent-2');
    });

    it('removes without deleting branch when requested', async () => {
      await manager.create('agent-keep-branch', defaultBranch);
      await manager.remove('agent-keep-branch', { deleteBranch: false });

      const listed = await manager.list();
      expect(listed).toHaveLength(0);

      // Branch should still exist
      const git = simpleGit({ baseDir: repoDir });
      const branches = await git.branch();
      expect(branches.all).toContain('huu-agent/agent-keep-branch');
    });

    it('remove is idempotent', async () => {
      await manager.create('agent-3', defaultBranch);
      await manager.remove('agent-3');

      // Second remove should not throw
      await expect(manager.remove('agent-3')).resolves.toBeUndefined();
    });

    it('remove on non-existent agent is a no-op', async () => {
      await expect(
        manager.remove('never-existed'),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getGit
  // -------------------------------------------------------------------------

  describe('getGit', () => {
    it('returns isolated SimpleGit for a worktree', async () => {
      await manager.create('agent-git', defaultBranch);
      const git = await manager.getGit('agent-git');

      // Verify it's scoped to the worktree directory
      const status = await git.status();
      expect(status.isClean()).toBe(true);
    });

    it('cached instance is returned on repeat calls', async () => {
      await manager.create('agent-cache', defaultBranch);
      const git1 = await manager.getGit('agent-cache');
      const git2 = await manager.getGit('agent-cache');
      expect(git1).toBe(git2);
    });

    it('throws for non-existent agent', async () => {
      await expect(manager.getGit('no-agent')).rejects.toThrow(
        WorktreeError,
      );
    });

    it('cache is invalidated after remove', async () => {
      await manager.create('agent-inv', defaultBranch);
      await manager.getGit('agent-inv');
      await manager.remove('agent-inv');

      await expect(manager.getGit('agent-inv')).rejects.toThrow(
        WorktreeError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Parallel agents do not corrupt refs
  // -------------------------------------------------------------------------

  describe('concurrency', () => {
    it('creates multiple agents concurrently without corruption', async () => {
      const ids = Array.from({ length: 5 }, (_, i) => `concurrent-${i}`);

      await Promise.all(ids.map((id) => manager.create(id, defaultBranch)));

      const listed = await manager.list();
      expect(listed).toHaveLength(5);

      const branches = new Set(listed.map((w) => w.branch));
      expect(branches.size).toBe(5);

      // Each should have its own directory
      for (const info of listed) {
        expect(fs.existsSync(info.path)).toBe(true);
      }
    });

    it('parallel operations in different worktrees do not interfere', async () => {
      await manager.create('par-a', defaultBranch);
      await manager.create('par-b', defaultBranch);

      const gitA = await manager.getGit('par-a');
      const gitB = await manager.getGit('par-b');

      // Write different files in each
      const infoA = (await manager.list()).find(
        (w) => w.agentId === 'par-a',
      )!;
      const infoB = (await manager.list()).find(
        (w) => w.agentId === 'par-b',
      )!;

      fs.writeFileSync(path.join(infoA.path, 'a.txt'), 'from A');
      fs.writeFileSync(path.join(infoB.path, 'b.txt'), 'from B');

      // Commit in parallel
      await Promise.all([
        (async () => {
          await gitA.add('.');
          await gitA.commit('commit from A');
        })(),
        (async () => {
          await gitB.add('.');
          await gitB.commit('commit from B');
        })(),
      ]);

      const statusA = await gitA.status();
      const statusB = await gitB.status();
      expect(statusA.isClean()).toBe(true);
      expect(statusB.isClean()).toBe(true);

      // Verify files only exist in their respective worktrees
      expect(fs.existsSync(path.join(infoA.path, 'a.txt'))).toBe(true);
      expect(fs.existsSync(path.join(infoA.path, 'b.txt'))).toBe(false);
      expect(fs.existsSync(path.join(infoB.path, 'b.txt'))).toBe(true);
      expect(fs.existsSync(path.join(infoB.path, 'a.txt'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Branch-in-use protection
  // -------------------------------------------------------------------------

  describe('branch conflict', () => {
    it('rejects creating a worktree when branch is already in use', async () => {
      await manager.create('dup-agent', defaultBranch);

      await expect(manager.create('dup-agent', defaultBranch)).rejects.toThrow(
        /already checked out/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle: stale detection + prune
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('detects stale worktree after directory removal', async () => {
      const info = await manager.create('stale-agent', defaultBranch, {
        lock: false,
      });

      // Manually remove the directory
      fs.rmSync(info.path, { recursive: true, force: true });

      const stale = await manager.detectStale();
      expect(stale.length).toBeGreaterThanOrEqual(1);
      expect(stale.some((s) => s.agentId === 'stale-agent')).toBe(true);
    });

    it('pruneStale dry-run does not remove metadata', async () => {
      const info = await manager.create('prune-dry', defaultBranch, {
        lock: false,
      });
      fs.rmSync(info.path, { recursive: true, force: true });

      await manager.pruneStale({ dryRun: true });

      // Metadata should still exist (prunable)
      const raw = await manager.listRaw();
      const stillThere = raw.find(
        (r) => r.branch === 'refs/heads/huu-agent/prune-dry',
      );
      expect(stillThere).toBeDefined();
    });

    it('pruneStale real mode removes stale metadata', async () => {
      const info = await manager.create('prune-real', defaultBranch, {
        lock: false,
      });
      fs.rmSync(info.path, { recursive: true, force: true });

      await manager.pruneStale({ dryRun: false });

      // Metadata should be gone
      const raw = await manager.listRaw();
      const found = raw.find(
        (r) => r.branch === 'refs/heads/huu-agent/prune-real',
      );
      expect(found).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Force removal of dirty worktree
  // -------------------------------------------------------------------------

  describe('force removal', () => {
    it('force removes a dirty worktree', async () => {
      const info = await manager.create('dirty-agent', defaultBranch);

      // Make the worktree dirty
      fs.writeFileSync(
        path.join(info.path, 'dirty.txt'),
        'uncommitted changes',
      );

      // Force should succeed even with dirty state + lock
      await manager.remove('dirty-agent', { force: true });

      const listed = await manager.list();
      expect(listed).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Porcelain parser unit tests
// ---------------------------------------------------------------------------

describe('parseWorktreePorcelain', () => {
  it('parses a simple worktree entry', () => {
    const input =
      'worktree /path/to/main\nHEAD abc123\nbranch refs/heads/main\n\0';
    const result = parseWorktreePorcelain(input);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: '/path/to/main',
      head: 'abc123',
      branch: 'refs/heads/main',
      detached: false,
      locked: false,
      prunable: false,
      bare: false,
    });
  });

  it('parses locked with reason', () => {
    const input =
      'worktree /path/wt\nHEAD abc\nbranch refs/heads/feat\nlocked huu-agent:builder\n\0';
    const result = parseWorktreePorcelain(input);

    expect(result[0]!.locked).toBe(true);
    expect(result[0]!.lockReason).toBe('huu-agent:builder');
  });

  it('parses locked without reason', () => {
    const input =
      'worktree /path/wt\nHEAD abc\nbranch refs/heads/feat\nlocked\n\0';
    const result = parseWorktreePorcelain(input);

    expect(result[0]!.locked).toBe(true);
    expect(result[0]!.lockReason).toBeUndefined();
  });

  it('parses prunable with reason', () => {
    const input =
      'worktree /path/wt\nHEAD abc\nbranch refs/heads/feat\nprunable gitdir file points to non-existent location\n\0';
    const result = parseWorktreePorcelain(input);

    expect(result[0]!.prunable).toBe(true);
    expect(result[0]!.prunableReason).toBe(
      'gitdir file points to non-existent location',
    );
  });

  it('parses detached HEAD', () => {
    const input = 'worktree /path/wt\nHEAD abc\ndetached\n\0';
    const result = parseWorktreePorcelain(input);

    expect(result[0]!.detached).toBe(true);
    expect(result[0]!.branch).toBeUndefined();
  });

  it('parses bare worktree', () => {
    const input = 'worktree /path/bare\nHEAD abc\nbare\n\0';
    const result = parseWorktreePorcelain(input);

    expect(result[0]!.bare).toBe(true);
  });

  it('parses multiple records', () => {
    const input = [
      'worktree /path/main\nHEAD aaa\nbranch refs/heads/main\n',
      'worktree /path/wt1\nHEAD bbb\nbranch refs/heads/feat1\nlocked reason1\n',
      'worktree /path/wt2\nHEAD ccc\nbranch refs/heads/feat2\n',
    ].join('\0') + '\0';

    const result = parseWorktreePorcelain(input);
    expect(result).toHaveLength(3);
    expect(result[1]!.lockReason).toBe('reason1');
  });

  it('returns empty array for empty input', () => {
    expect(parseWorktreePorcelain('')).toEqual([]);
    expect(parseWorktreePorcelain('  ')).toEqual([]);
  });
});
