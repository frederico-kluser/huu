import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { landEpoch } from './epoch-landing.js';
import { GitClient } from '../../git/git-client.js';

// Real git repos in temp dirs — huu never mocks git (see the writing-tests
// skill): the whole point of this module is what git actually does on merge.
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

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'huu-land-epoch-')));
  git(['init', '-q', '-b', 'main'], repo);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Simulates what an epoch leaves behind: commits on an integration branch. */
function makeIntegrationBranch(branch: string, files: Record<string, string>): void {
  git(['checkout', '-q', '-b', branch], repo);
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(repo, path), content);
  }
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', `work on ${branch}`], repo);
  git(['checkout', '-q', 'main'], repo);
}

describe('landEpoch', () => {
  it('merges the integration branch into the working branch', async () => {
    makeIntegrationBranch('huu/run-1/integration', { 'feature.ts': 'export const a = 1;\n' });

    const result = await landEpoch({ cwd: repo, integrationBranch: 'huu/run-1/integration', epoch: 1 });

    expect(result.landed).toBe(true);
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(git(['show', '--stat', '--oneline', 'HEAD'], repo)).toContain('Merge huu/run-1/integration');
    expect(git(['ls-files'], repo)).toContain('feature.ts');
  });

  // The chain invariant: epoch 2 must branch from a HEAD that contains
  // epoch 1's work, or it replans against stale code.
  it('makes epoch N+1 see epoch N work on the working branch', async () => {
    makeIntegrationBranch('huu/run-1/integration', { 'one.ts': 'one\n' });
    await landEpoch({ cwd: repo, integrationBranch: 'huu/run-1/integration', epoch: 1 });

    makeIntegrationBranch('huu/run-2/integration', { 'two.ts': 'two\n' });
    const second = await landEpoch({ cwd: repo, integrationBranch: 'huu/run-2/integration', epoch: 2 });

    expect(second.landed).toBe(true);
    const tracked = git(['ls-files'], repo);
    expect(tracked).toContain('one.ts');
    expect(tracked).toContain('two.ts');
  });

  it('reports a missing integration branch instead of throwing', async () => {
    const result = await landEpoch({ cwd: repo, integrationBranch: 'huu/ghost/integration', epoch: 1 });

    expect(result.landed).toBe(false);
    expect(result.error).toMatch(/does not exist/);
  });

  it('refuses to land onto a dirty working tree', async () => {
    makeIntegrationBranch('huu/run-1/integration', { 'feature.ts': 'x\n' });
    writeFileSync(join(repo, 'README.md'), 'locally edited\n');

    const result = await landEpoch({ cwd: repo, integrationBranch: 'huu/run-1/integration', epoch: 1 });

    expect(result.landed).toBe(false);
    expect(result.error).toMatch(/uncommitted changes/);
    // Untouched: the user's edit survives.
    expect(git(['status', '--porcelain'], repo)).toContain('README.md');
  });

  it('aborts the merge and leaves a clean tree on conflict', async () => {
    makeIntegrationBranch('huu/run-1/integration', { 'README.md': 'from the epoch\n' });
    writeFileSync(join(repo, 'README.md'), 'from main\n');
    git(['commit', '-q', '-am', 'diverge on main'], repo);

    const result = await landEpoch({ cwd: repo, integrationBranch: 'huu/run-1/integration', epoch: 1 });

    expect(result.landed).toBe(false);
    expect(result.conflicts).toContain('README.md');
    expect(result.error).toMatch(/conflicted on 1 file/);
    // A half-merged tree would block the next epoch and confuse the user.
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
  });

  it('is a clean no-op when the branch is already contained in HEAD', async () => {
    makeIntegrationBranch('huu/run-1/integration', { 'feature.ts': 'x\n' });
    await landEpoch({ cwd: repo, integrationBranch: 'huu/run-1/integration', epoch: 1 });

    const again = await landEpoch({ cwd: repo, integrationBranch: 'huu/run-1/integration', epoch: 1 });

    expect(again.landed).toBe(true);
    expect(again.alreadyUpToDate).toBe(true);
  });

  it('accepts an injected client for the same repo', async () => {
    makeIntegrationBranch('huu/run-1/integration', { 'feature.ts': 'x\n' });

    const result = await landEpoch({
      cwd: repo,
      integrationBranch: 'huu/run-1/integration',
      epoch: 1,
      git: new GitClient(repo),
    });

    expect(result.landed).toBe(true);
  });
});
