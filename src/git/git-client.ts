import { execFile } from 'node:child_process';
import { log as dlog, bump as dbump } from '../lib/debug-logger.js';

interface ExecOptions {
  cwd: string;
  timeout: number;
  /** Absorb non-zero exit codes and return stderr/stdout (e.g. for `git status --porcelain` callers that try/catch). */
  allowFail?: boolean;
}

/**
 * Env vars that forbid git from opening `/dev/tty` for credential prompts.
 *
 * Why this exists: when a remote (typically corporate GitLab/GitHub over
 * HTTPS) needs auth and the credential cache is empty/expired, git invokes
 * a credential helper. Helpers like `git-credential-manager`, `gh
 * auth git-credential`, or core git's own fallback open `/dev/tty`
 * directly — bypassing the child's stdin pipe and grabbing the controlling
 * terminal out from under Ink's raw-mode handler. The Node parent keeps
 * running (event loop is fine), but its stdin stops seeing any bytes —
 * arrows, letters, and even Ctrl+C (which in raw mode is just the byte
 * `\x03` flowing through the same pipeline) disappear.
 *
 * Once that happens, even when the offending git child times out and
 * exits, the TTY is left in a state where the parent never recovers
 * stdin. The whole TUI looks frozen.
 *
 * What each variable does:
 *   GIT_TERMINAL_PROMPT=0   core git refuses to prompt for input.
 *   GCM_INTERACTIVE=Never   Git Credential Manager (the .NET one)
 *                            won't pop a TUI/GUI dialog.
 *   GIT_ASKPASS=true        the askpass program git invokes is the POSIX
 *                            `true` builtin — exits 0 with no output —
 *                            so git treats credentials as empty and
 *                            fails fast instead of blocking.
 *   SSH_ASKPASS=true        same idea for SSH passphrase prompts (covers
 *                            the case where a remote is ssh:// instead).
 *
 * The trade-off: if your credential cache is empty, git will fail with a
 * clear "could not read Username for ..." instead of pretending to ask
 * you. That is a strictly better failure mode than freezing the UI.
 */
/**
 * Environment variables that tell git WHICH REPOSITORY to act on, overriding
 * the process working directory.
 *
 * Every call in this module passes an explicit `cwd` and means it — the whole
 * design of huu is one git client aimed at a specific worktree
 * (`.huu-worktrees/<runId>/agent-N`, the integration worktree, the user's
 * checkout). An inherited `GIT_DIR` silently wins over that `cwd`, so a huu
 * invoked from an environment that has one would point every agent's commit,
 * every merge and every branch delete at whatever repository the CALLER was
 * looking at.
 *
 * That is not hypothetical. `git push` from a LINKED WORKTREE exports
 * `GIT_DIR=<main>/.git/worktrees/<name>` to its hooks (a plain clone does not),
 * so the repo's own opt-in pre-push hook turned every temp-repo test into an
 * operation on the real repository — 248 of them at once, with failures that
 * read as ordinary assertion errors and name nothing about the environment.
 * Anything that runs huu from a git hook, a `git rebase --exec`, or a CI step
 * that sets these is the same bug pointed at production.
 *
 * Scrubbed rather than overridden: `cwd` is the answer, and the correct value
 * for these is ABSENT.
 */
const REPO_SCOPING_GIT_ENV = [
  'GIT_DIR',
  'GIT_COMMON_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
] as const;

export function nonInteractiveGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_ASKPASS: 'true',
    SSH_ASKPASS: 'true',
  };
  // See REPO_SCOPING_GIT_ENV: `cwd` decides the repository, nothing else.
  for (const key of REPO_SCOPING_GIT_ENV) delete env[key];
  return env;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs a git subcommand without blocking the Node event loop.
 *
 * Why async: every git invocation here was `execSync`, which suspends the main
 * thread for the full duration of the child process — typically 30–500 ms,
 * sometimes seconds for `worktree add` and `merge`. While the loop is blocked,
 * Ink cannot drain `process.stdin`, so user keypresses (Q, ↑↓←→, +/-, Enter)
 * pile up in the terminal buffer and the dashboard appears frozen even though
 * `useInput` is correctly attached. Switching to `execFile` lets stdin events
 * interleave with git work and keeps the TUI responsive.
 */
function runGit(args: string[], opts: ExecOptions): Promise<ExecResult> {
  const startedAt = Date.now();
  dbump('git.spawn');
  dlog('git', 'spawn', { args, cwd: opts.cwd, timeout: opts.timeout });
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: opts.cwd,
        encoding: 'utf8',
        timeout: opts.timeout,
        maxBuffer: 32 * 1024 * 1024,
        env: nonInteractiveGitEnv(),
      },
      (err, stdout, stderr) => {
        const exitCode =
          err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number'
            ? (err as unknown as { code: number }).code
            : err
              ? 1
              : 0;
        const durationMs = Date.now() - startedAt;
        dlog('git', 'done', {
          args,
          cwd: opts.cwd,
          durationMs,
          exitCode,
          stderrFirst: String(stderr).slice(0, 200),
          stdoutBytes: String(stdout).length,
        });
        if (err && !opts.allowFail) {
          reject(err);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr), exitCode });
      },
    );
  });
}

/**
 * Thin async wrapper around git CLI commands used by the orchestrator.
 * Originally copied verbatim from pi-orq/src/git/git-client.ts and migrated
 * from `execSync` to `execFile` to keep Ink's input loop responsive.
 */
export class GitClient {
  constructor(private cwd: string) {}

  async exec(args: string, timeout = 30_000): Promise<string> {
    const result = await runGit(splitArgs(args), { cwd: this.cwd, timeout });
    return result.stdout.trim();
  }

  async createBranch(name: string, startPoint: string): Promise<void> {
    await this.exec(`branch ${name} ${startPoint}`);
  }

  async deleteBranch(name: string): Promise<void> {
    try {
      await this.exec(`branch -D ${name}`);
    } catch {
      /* branch may not exist */
    }
  }

  async deleteRemoteBranch(name: string): Promise<boolean> {
    try {
      await this.exec(`push origin --delete ${name}`, 60_000);
      return true;
    } catch {
      return false;
    }
  }

  async branchExists(name: string): Promise<boolean> {
    try {
      await this.exec(`rev-parse --verify ${name}`);
      return true;
    } catch {
      return false;
    }
  }

  async addWorktree(path: string, branch: string): Promise<void> {
    await this.exec(`worktree add ${path} ${branch}`);
  }

  async removeWorktree(path: string): Promise<void> {
    try {
      await this.exec(`worktree remove ${path} --force`);
    } catch {
      /* may already be removed */
    }
  }

  async pruneWorktrees(): Promise<void> {
    try {
      await this.exec('worktree prune');
    } catch {
      /* best-effort */
    }
  }

  async hasChanges(worktreePath: string): Promise<boolean> {
    try {
      const result = await runGit(['status', '--porcelain'], {
        cwd: worktreePath,
        timeout: 10_000,
      });
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async getChangedFiles(worktreePath: string): Promise<string[]> {
    try {
      const result = await runGit(['status', '--porcelain'], {
        cwd: worktreePath,
        timeout: 10_000,
      });
      // NOT `stdout.trim()` before splitting: porcelain status codes are two
      // columns and an UNSTAGED modification reads " M path". Trimming the
      // whole output eats the leading space of the FIRST line only, and
      // `parsePorcelainPath`'s fixed slice(3) then chops that path's first
      // character ("alpha.txt" → "lpha.txt"). Per-line trimming is safe.
      if (result.stdout.trim().length === 0) return [];
      return result.stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => parsePorcelainPath(line))
        .filter((p): p is string => p !== null);
    } catch {
      return [];
    }
  }

  async stageAll(worktreePath: string): Promise<void> {
    await runGit(['add', '-A'], { cwd: worktreePath, timeout: 15_000 });
  }

  /**
   * Commit with hooks bypassed.
   *
   * `pathspec` scopes the commit to those paths ONLY, taking their working-tree
   * content and leaving everything else staged. Without it `git commit` takes
   * the WHOLE index — so a caller that stages a couple of its own files would
   * also sweep in whatever the user had staged, under the caller's message and
   * past the user's pre-commit hooks. Agent commits legitimately want the whole
   * index (their worktree is theirs); huu writing into the USER's checkout does
   * not.
   */
  async commitNoVerify(
    worktreePath: string,
    message: string,
    pathspec?: readonly string[],
  ): Promise<string> {
    const scope = pathspec && pathspec.length > 0 ? ['--', ...pathspec] : [];
    await runGit(['commit', '--no-verify', '-m', message, ...scope], {
      cwd: worktreePath,
      timeout: 30_000,
    });
    const result = await runGit(['rev-parse', 'HEAD'], {
      cwd: worktreePath,
      timeout: 10_000,
    });
    return result.stdout.trim();
  }

  async push(branchName: string, retries = 3): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.exec(`push -u origin ${branchName}`, 60_000);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < retries) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  async merge(
    worktreePath: string,
    branchName: string,
  ): Promise<{ success: boolean; conflicts: string[]; error?: string }> {
    let mergeErr: unknown;
    try {
      await runGit(
        ['merge', branchName, '--no-ff', '-m', `Merge ${branchName}`],
        { cwd: worktreePath, timeout: 60_000 },
      );
      return { success: true, conflicts: [] };
    } catch (err) {
      mergeErr = err;
    }
    // Merge failed — try to enumerate conflicting files. If the diff probe
    // also fails, surface the original merge error via `error` rather than
    // smuggling it into `conflicts[]` (which callers treat as file paths
    // and use to spawn an LLM resolver).
    try {
      const result = await runGit(
        ['diff', '--name-only', '--diff-filter=U'],
        { cwd: worktreePath, timeout: 10_000 },
      );
      const status = result.stdout.trim();
      const conflicts = status ? status.split('\n') : [];
      return {
        success: false,
        conflicts,
        // Always include the merge error so observability has the root cause
        // even when the conflict list is well-formed (e.g. merge failed with
        // a hook abort or an unrelated git error before producing conflicts).
        error: errorMessage(mergeErr),
      };
    } catch (probeErr) {
      return {
        success: false,
        conflicts: [],
        error: `merge failed: ${errorMessage(mergeErr)}; conflict probe failed: ${errorMessage(probeErr)}`,
      };
    }
  }

  async abortMerge(worktreePath: string): Promise<void> {
    try {
      await runGit(['merge', '--abort'], {
        cwd: worktreePath,
        timeout: 10_000,
      });
    } catch {
      /* no merge to abort */
    }
  }

  async getHead(worktreePath: string): Promise<string> {
    const result = await runGit(['rev-parse', 'HEAD'], {
      cwd: worktreePath,
      timeout: 10_000,
    });
    return result.stdout.trim();
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parsePorcelainPath(line: string): string | null {
  if (line.length < 4) return null;
  const pathPart = line.slice(3).trim();
  if (!pathPart) return null;
  const renameParts = pathPart.split(' -> ');
  return renameParts[renameParts.length - 1] || null;
}

// Single-quoted args (`-m 'msg with spaces'`) cannot exist here because we use
// execFile (no shell). Plain whitespace splitting matches every existing call
// site, which all pass simple positional flags.
function splitArgs(args: string): string[] {
  return args.split(/\s+/).filter((a) => a.length > 0);
}
