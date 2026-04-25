import { execSync } from 'node:child_process';
import type { PreflightResult } from '../lib/types.js';

export function runPreflight(cwd: string): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let repoRoot = cwd;
  let baseBranch = '';
  let baseCommit = '';
  let isDirty = false;
  let hasRemote = false;
  let canPush = false;

  try {
    repoRoot = git(cwd, 'rev-parse --show-toplevel').trim();
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
    const status = git(repoRoot, 'status --porcelain');
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
    baseBranch = git(repoRoot, 'rev-parse --abbrev-ref HEAD').trim();
    if (baseBranch === 'HEAD') {
      errors.push('Detached HEAD state. Checkout a branch before running.');
    }
  } catch (err) {
    errors.push(`Could not resolve current branch: ${errorMessage(err)}`);
  }

  try {
    baseCommit = git(repoRoot, 'rev-parse HEAD').trim();
  } catch (err) {
    errors.push(`Could not resolve HEAD commit: ${errorMessage(err)}`);
  }

  try {
    const remotes = git(repoRoot, 'remote').trim();
    hasRemote = remotes.length > 0;
    if (!hasRemote) {
      warnings.push('No git remote configured. Push will be skipped.');
    }
  } catch {
    warnings.push('Could not check git remotes.');
  }

  if (hasRemote) {
    try {
      git(repoRoot, 'push --dry-run origin HEAD', 10_000);
      canPush = true;
    } catch {
      warnings.push('Push dry-run failed. Branches will be created locally but may not push.');
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

function git(cwd: string, args: string, timeout = 15_000): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
