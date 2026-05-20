import { execFile } from 'node:child_process';
import type { PreflightResult } from '../lib/types.js';
import { log as dlog, bump as dbump } from '../lib/debug-logger.js';
import { nonInteractiveGitEnv } from './git-client.js';

export async function runPreflight(cwd: string): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let repoRoot = cwd;
  let baseBranch = '';
  let baseCommit = '';
  let isDirty = false;
  let hasRemote = false;
  let canPush = false;

  try {
    repoRoot = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    errors.push('Not a git repository. Run from inside a git repo.');
    return {
      valid: false,
      repoRoot: cwd,
      baseBranch: '',
      baseCommit: '',
      isDirty: false,
      hasRemote: false,
      canPush: false,
      errors,
      warnings,
    };
  }

  try {
    const status = await git(repoRoot, ['status', '--porcelain']);
    isDirty = status.trim().length > 0;
    if (isDirty) {
      warnings.push(
        "Working tree has uncommitted changes. Agents use isolated worktrees so this is safe, but uncommitted files won't be visible to agents.",
      );
    }
  } catch (err) {
    errors.push(`Could not check git status: ${errorMessage(err)}`);
  }

  try {
    baseBranch = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (baseBranch === 'HEAD') {
      errors.push('Detached HEAD state. Checkout a branch before running.');
    }
  } catch (err) {
    errors.push(`Could not resolve current branch: ${errorMessage(err)}`);
  }

  try {
    baseCommit = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
  } catch (err) {
    errors.push(`Could not resolve HEAD commit: ${errorMessage(err)}`);
  }

  try {
    const remotes = (await git(repoRoot, ['remote'])).trim();
    hasRemote = remotes.length > 0;
    if (!hasRemote) {
      warnings.push('No git remote configured. Push will be skipped.');
    }
  } catch {
    warnings.push('Could not check git remotes.');
  }

  if (hasRemote) {
    // Gate the push reachability check behind an opt-in env var.
    //
    // This used to always run, but it has two real costs that almost no
    // run actually pays for:
    //
    //   1. It triggers an auth round-trip with the remote. On corporate
    //      hosts (e.g. GitLab behind SAML/SSO) where the credential cache
    //      is empty/expired, git invokes a credential helper that opens
    //      `/dev/tty` directly — stealing stdin from Ink's raw-mode
    //      handler and freezing the entire TUI (arrows, +/-, Q, even
    //      Ctrl+C all stop responding). Even with GIT_TERMINAL_PROMPT=0
    //      now in place, the dry-run is a 10s round-trip we don't need.
    //
    //   2. The orchestrator does NOT auto-push agent branches anyway;
    //      pushing is an explicit follow-up step. So `canPush` is purely
    //      informational — failing the check has never blocked a run.
    //
    // Default behaviour is now to skip the check and emit a warning that
    // tells the user how to re-enable it. Set
    // `HUU_CHECK_PUSH=1` if you actually want to validate
    // push reachability before the run starts.
    if (process.env.HUU_CHECK_PUSH === '1') {
      try {
        await git(repoRoot, ['push', '--dry-run', 'origin', 'HEAD'], 10_000);
        canPush = true;
      } catch {
        warnings.push('Push dry-run failed. Branches will be created locally but may not push.');
        canPush = false;
      }
    } else {
      warnings.push(
        'Push reachability check skipped (set HUU_CHECK_PUSH=1 to enable).',
      );
      canPush = false;
    }
  }

  return {
    valid: errors.length === 0,
    repoRoot,
    baseBranch,
    baseCommit,
    isDirty,
    hasRemote,
    canPush,
    errors,
    warnings,
  };
}

function git(cwd: string, args: string[], timeout = 15_000): Promise<string> {
  const startedAt = Date.now();
  dbump('preflight.git');
  dlog('preflight', 'git_spawn', { args, cwd, timeout });
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, env: nonInteractiveGitEnv() },
      (err, stdout) => {
        const durationMs = Date.now() - startedAt;
        dlog('preflight', 'git_done', {
          args,
          cwd,
          durationMs,
          ok: !err,
          err: err ? String(err.message ?? err) : undefined,
        });
        if (err) {
          reject(err);
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
