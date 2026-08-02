import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitClient, nonInteractiveGitEnv } from './git-client.js';

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

let repo: string;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'huu-git-client-')));
  git(['init', '-q', '-b', 'main'], repo);
  writeFileSync(join(repo, 'alpha.txt'), 'a\n');
  writeFileSync(join(repo, 'beta.txt'), 'b\n');
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('GitClient.getChangedFiles', () => {
  // REGRESSION: porcelain status codes occupy two columns, so an UNSTAGED
  // modification reads " M alpha.txt". The old implementation trimmed the
  // whole stdout before splitting, which ate the leading space of the FIRST
  // line only — and the fixed slice(3) then chopped that path's first
  // character, so `AgentStatus.filesModified` reported "lpha.txt".
  it('does not truncate the first path of an unstaged modification', async () => {
    writeFileSync(join(repo, 'alpha.txt'), 'changed\n');
    writeFileSync(join(repo, 'beta.txt'), 'changed\n');

    const client = new GitClient(repo);
    expect(await client.getChangedFiles(repo)).toEqual(['alpha.txt', 'beta.txt']);
  });

  it('handles a single unstaged file', async () => {
    writeFileSync(join(repo, 'alpha.txt'), 'changed\n');

    const client = new GitClient(repo);
    expect(await client.getChangedFiles(repo)).toEqual(['alpha.txt']);
  });

  it('lists staged, unstaged, untracked and deleted paths', async () => {
    writeFileSync(join(repo, 'alpha.txt'), 'changed\n');
    git(['add', 'alpha.txt'], repo);
    writeFileSync(join(repo, 'beta.txt'), 'changed\n');
    writeFileSync(join(repo, 'gamma.txt'), 'new\n');

    const client = new GitClient(repo);
    expect((await client.getChangedFiles(repo)).sort()).toEqual(['alpha.txt', 'beta.txt', 'gamma.txt']);
  });

  it('reports a deletion by its real path', async () => {
    unlinkSync(join(repo, 'alpha.txt'));

    const client = new GitClient(repo);
    expect(await client.getChangedFiles(repo)).toEqual(['alpha.txt']);
  });

  it('returns the destination of a rename', async () => {
    git(['mv', 'alpha.txt', 'renamed.txt'], repo);

    const client = new GitClient(repo);
    expect(await client.getChangedFiles(repo)).toEqual(['renamed.txt']);
  });

  it('returns an empty list on a clean tree', async () => {
    const client = new GitClient(repo);
    expect(await client.getChangedFiles(repo)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ambient git environment. `cwd` decides the repository — nothing else may.
// ---------------------------------------------------------------------------

describe('nonInteractiveGitEnv', () => {
  it('scrubs every variable that would override cwd', () => {
    // REGRESSION: the env was `{ ...process.env, …the prompt-suppressing four }`,
    // so an inherited GIT_DIR reached every git child and BEAT its explicit
    // `cwd`. Found when the repo's own opt-in pre-push hook ran from a linked
    // worktree: `git push` exports GIT_DIR there (a plain clone does not), and
    // 248 tests failed as ordinary assertion errors — every temp-repo git call
    // had been retargeted at the real repository.
    const saved = { ...process.env };
    try {
      process.env.GIT_DIR = '/somewhere/else/.git';
      process.env.GIT_WORK_TREE = '/somewhere/else';
      process.env.GIT_INDEX_FILE = '/somewhere/else/.git/index';
      process.env.GIT_COMMON_DIR = '/somewhere/else/.git';
      process.env.GIT_OBJECT_DIRECTORY = '/somewhere/else/.git/objects';
      process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = '/other/objects';
      process.env.GIT_NAMESPACE = 'ns';
      process.env.GIT_PREFIX = 'sub/';

      const env = nonInteractiveGitEnv();
      for (const key of [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_COMMON_DIR',
        'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'GIT_NAMESPACE',
        'GIT_PREFIX',
      ]) {
        expect(env[key], `${key} must not reach a git child`).toBeUndefined();
      }
      // What it exists to set is untouched.
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      expect(env.GIT_ASKPASS).toBe('true');
    } finally {
      process.env = saved;
    }
  });

  it('still acts on the cwd repo when the environment names another one', async () => {
    // The end-to-end version of the same fact, through the real client.
    const saved = { ...process.env };
    const foreign = realpathSync(mkdtempSync(join(tmpdir(), 'huu-git-foreign-')));
    try {
      git(['init', '-q', '-b', 'main'], foreign);
      writeFileSync(join(foreign, 'foreign.txt'), 'f\n');
      git(['add', '-A'], foreign);
      git(['commit', '-q', '-m', 'foreign'], foreign);

      process.env.GIT_DIR = join(foreign, '.git');
      process.env.GIT_WORK_TREE = foreign;

      writeFileSync(join(repo, 'alpha.txt'), 'changed\n');
      const client = new GitClient(repo);
      expect(await client.getChangedFiles(repo)).toEqual(['alpha.txt']);
    } finally {
      process.env = saved;
      rmSync(foreign, { recursive: true, force: true });
    }
  });
});
