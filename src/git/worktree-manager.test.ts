import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorktreeManager } from './worktree-manager.js';
import { GitClient } from './git-client.js';

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

async function initRepo(): Promise<{ scratch: string; baseCommit: string }> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'huu-wtmgr-')));
  git(['init', '-q', '-b', 'main'], scratch);
  writeFileSync(join(scratch, 'README.md'), 'hi\n');
  git(['add', 'README.md'], scratch);
  git(['commit', '-q', '-m', 'init'], scratch);
  const client = new GitClient(scratch);
  const baseCommit = await client.exec('rev-parse HEAD');
  return { scratch, baseCommit };
}

describe('WorktreeManager — branch rollback on addWorktree failure', () => {
  let scratch: string;
  let baseCommit: string;

  beforeEach(async () => {
    const r = await initRepo();
    scratch = r.scratch;
    baseCommit = r.baseCommit;
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('rolls back the branch when integration worktree creation fails', async () => {
    const mgr = new WorktreeManager(scratch, 'run-x', baseCommit);

    // Force `git worktree add <path>` to fail by pre-creating a non-empty
    // file at the worktree path. git refuses to add a worktree where a
    // non-directory file already exists.
    const branchName = 'huu/run-x/integration';
    // Find the path the manager will try to use, and block it.
    // (Using the same naming convention as branch-namer.)
    const wtPath = join(scratch, '.huu-worktrees', 'run-x', 'integration');
    const parent = join(scratch, '.huu-worktrees', 'run-x');
    require('node:fs').mkdirSync(parent, { recursive: true });
    require('node:fs').writeFileSync(wtPath, 'blocker');

    await expect(mgr.createIntegrationWorktree()).rejects.toBeDefined();

    // The branch must NOT survive the failed creation — otherwise a
    // retry hits "branch already exists" and the run can't recover.
    const client = new GitClient(scratch);
    expect(await client.branchExists(branchName)).toBe(false);
  });

  it('rolls back the branch when agent worktree creation fails', async () => {
    const mgr = new WorktreeManager(scratch, 'run-y', baseCommit);

    const wtPath = join(scratch, '.huu-worktrees', 'run-y', 'agent-7');
    const parent = join(scratch, '.huu-worktrees', 'run-y');
    require('node:fs').mkdirSync(parent, { recursive: true });
    require('node:fs').writeFileSync(wtPath, 'blocker');

    await expect(mgr.createAgentWorktree(7, baseCommit)).rejects.toBeDefined();

    const client = new GitClient(scratch);
    expect(await client.branchExists('huu/run-y/agent-7')).toBe(false);
  });

  it('happy path: branch and worktree both exist after success', async () => {
    const mgr = new WorktreeManager(scratch, 'run-ok', baseCommit);
    const info = await mgr.createIntegrationWorktree();
    expect(info.branchName).toBe('huu/run-ok/integration');
    const client = new GitClient(scratch);
    expect(await client.branchExists(info.branchName)).toBe(true);
  });
});
