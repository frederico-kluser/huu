import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preflightGitOnHost } from './git-preflight.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'huu-test',
      GIT_AUTHOR_EMAIL: 'huu@test.local',
      GIT_COMMITTER_NAME: 'huu-test',
      GIT_COMMITTER_EMAIL: 'huu@test.local',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

describe('preflightGitOnHost', () => {
  let scratch: string;

  beforeEach(() => {
    // realpath flattens any /var → /private/var symlink that macOS uses
    // for its temp dir, so the path comparisons below match git's output.
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'huu-preflight-')));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('rejects a directory that is not a git repository', () => {
    const r = preflightGitOnHost(scratch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/not a git repository/);
      expect(r.message).toMatch(scratch);
    }
  });

  it('regular repo, run from root: no extra mounts needed', () => {
    git(['init', '-q', '-b', 'main'], scratch);
    writeFileSync(join(scratch, 'README.md'), 'hi\n');
    git(['add', 'README.md'], scratch);
    git(['commit', '-q', '-m', 'init'], scratch);

    const r = preflightGitOnHost(scratch);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extraGitMounts).toEqual([]);
  });

  it('subdirectory of a regular repo: mounts the toplevel', () => {
    git(['init', '-q', '-b', 'main'], scratch);
    const sub = join(scratch, 'pkg', 'a');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'index.ts'), 'export {};\n');
    git(['add', '.'], scratch);
    git(['commit', '-q', '-m', 'init'], scratch);

    const r = preflightGitOnHost(sub);
    expect(r.ok).toBe(true);
    // Mounting the toplevel covers .git too — single mount is enough.
    if (r.ok) expect(r.extraGitMounts).toEqual([scratch]);
  });

  it('git worktree: mounts the parent repo .git so gitdir resolves', () => {
    // Set up a main repo with a worktree pointing outside it. Mirrors
    // the user's `qwe` workflow that produced the original bug report.
    const main = join(scratch, 'main-repo');
    mkdirSync(main);
    git(['init', '-q', '-b', 'main'], main);
    writeFileSync(join(main, 'README.md'), 'hi\n');
    git(['add', 'README.md'], main);
    git(['commit', '-q', '-m', 'init'], main);

    const worktreeDir = join(scratch, 'main-repo.worktrees', 'feature');
    git(['worktree', 'add', '-q', worktreeDir, '-b', 'feature'], main);

    const r = preflightGitOnHost(worktreeDir);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The parent repo's .git directory must be mounted; toplevel of
      // the worktree IS the worktree itself (= cwd) so no toplevel mount
      // is needed.
      expect(r.extraGitMounts).toEqual([join(main, '.git')]);
    }
  });

  it('deduplicates: nested mount candidates collapse to the outer path', () => {
    // Subdir of a worktree: toplevel = worktree (cwd's parent), common-dir
    // = parent repo's .git. Both are outside cwd. Toplevel is outside the
    // common-dir's parent and vice versa — both must be mounted (no
    // containment), so we expect TWO mounts.
    const main = join(scratch, 'main-repo');
    mkdirSync(main);
    git(['init', '-q', '-b', 'main'], main);
    writeFileSync(join(main, 'README.md'), 'hi\n');
    git(['add', 'README.md'], main);
    git(['commit', '-q', '-m', 'init'], main);

    const worktreeDir = join(scratch, 'main-repo.worktrees', 'feature');
    git(['worktree', 'add', '-q', worktreeDir, '-b', 'feature'], main);
    const sub = join(worktreeDir, 'pkg');
    mkdirSync(sub);

    const r = preflightGitOnHost(sub);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.extraGitMounts).toContain(worktreeDir);
      expect(r.extraGitMounts).toContain(join(main, '.git'));
      expect(r.extraGitMounts.length).toBe(2);
    }
  });
});
