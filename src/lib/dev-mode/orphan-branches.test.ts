import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitClient } from '../../git/git-client.js';
import { findOrphanIntegrationBranches } from './orphan-branches.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
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

let repo: string;
let client: GitClient;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'huu-orphans-')));
  git(['init', '-q', '-b', 'main'], repo);
  writeFileSync(join(repo, 'README.md'), '# project\n');
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
  client = new GitClient(repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Creates `branch` off the current HEAD with `n` commits, then returns to main. */
function branchWithCommits(branch: string, n: number): void {
  git(['checkout', '-q', '-b', branch], repo);
  for (let i = 0; i < n; i += 1) {
    writeFileSync(join(repo, `${branch.replace(/\//g, '-')}-${i}.txt`), `${i}\n`);
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', `${branch} ${i}`], repo);
  }
  git(['checkout', '-q', 'main'], repo);
}

describe('findOrphanIntegrationBranches', () => {
  it('is empty on a repo that never ran huu', async () => {
    expect(await findOrphanIntegrationBranches(client, [])).toEqual([]);
  });

  // The one that matters: a landed epoch and an abandoned one look IDENTICAL
  // in `git status` (both clean) and identical in the branch list. Containment
  // in HEAD is the only thing that separates them.
  it('returns the branch HEAD never absorbed, and not the one it did', async () => {
    branchWithCommits('huu/aaa11111/integration', 1);
    git(['merge', '-q', '--no-ff', '-m', 'land epoch 1', 'huu/aaa11111/integration'], repo);
    branchWithCommits('huu/bbb22222/integration', 2);

    const orphans = await findOrphanIntegrationBranches(client, []);

    expect(orphans).toEqual([
      { branch: 'huu/bbb22222/integration', runId: 'bbb22222', ahead: 2 },
    ]);
  });

  it('ignores agent branches and the user own branches', async () => {
    branchWithCommits('huu/ccc33333/agent-1', 1);
    branchWithCommits('huu/ccc33333/agent-2-retry', 1);
    branchWithCommits('feature/minha-coisa', 1);
    branchWithCommits('huu/ddd44444/integration', 1);

    const orphans = await findOrphanIntegrationBranches(client, []);

    expect(orphans.map((o) => o.branch)).toEqual(['huu/ddd44444/integration']);
  });

  it('attributes a branch to the epoch that produced it', async () => {
    branchWithCommits('huu/bbb22222/integration', 1);

    const orphans = await findOrphanIntegrationBranches(client, [
      { epoch: 1, runId: 'aaa11111' },
      { epoch: 2, runId: 'bbb22222' },
    ]);

    expect(orphans).toEqual([
      { branch: 'huu/bbb22222/integration', runId: 'bbb22222', ahead: 1, epoch: 2 },
    ]);
  });

  // Landing order is the point of the sort: replaying epoch 3 before epoch 2
  // would rewrite the history backwards.
  it('orders by epoch, unattributed branches last', async () => {
    branchWithCommits('huu/aaa11111/integration', 1);
    branchWithCommits('huu/bbb22222/integration', 1);
    branchWithCommits('huu/zzz99999/integration', 1);

    const orphans = await findOrphanIntegrationBranches(client, [
      { epoch: 3, runId: 'aaa11111' },
      { epoch: 1, runId: 'bbb22222' },
    ]);

    expect(orphans.map((o) => [o.runId, o.epoch])).toEqual([
      ['bbb22222', 1],
      ['aaa11111', 3],
      ['zzz99999', undefined],
    ]);
  });

  // A forgotten branch is something to REPORT; it must never be the thing that
  // stops a new session from starting.
  it('never throws on a repo with an unborn HEAD', async () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'huu-orphans-empty-')));
    try {
      git(['init', '-q', '-b', 'main'], empty);
      expect(await findOrphanIntegrationBranches(new GitClient(empty), [])).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('never throws outside a git repo', async () => {
    const notARepo = realpathSync(mkdtempSync(join(tmpdir(), 'huu-orphans-bare-')));
    try {
      expect(await findOrphanIntegrationBranches(new GitClient(notARepo), [])).toEqual([]);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});
