import { execSync } from 'node:child_process';

/**
 * Thin wrapper around git CLI commands used by the orchestrator.
 * Copied verbatim from pi-orq/src/git/git-client.ts.
 */
export class GitClient {
  constructor(private cwd: string) {}

  exec(args: string, timeout = 30_000): string {
    return execSync(`git ${args}`, {
      cwd: this.cwd,
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }

  createBranch(name: string, startPoint: string): void {
    this.exec(`branch ${name} ${startPoint}`);
  }

  deleteBranch(name: string): void {
    try {
      this.exec(`branch -D ${name}`);
    } catch {
      /* branch may not exist */
    }
  }

  deleteRemoteBranch(name: string): boolean {
    try {
      this.exec(`push origin --delete ${name}`, 60_000);
      return true;
    } catch {
      return false;
    }
  }

  branchExists(name: string): boolean {
    try {
      this.exec(`rev-parse --verify ${name}`);
      return true;
    } catch {
      return false;
    }
  }

  addWorktree(path: string, branch: string): void {
    this.exec(`worktree add ${path} ${branch}`);
  }

  removeWorktree(path: string): void {
    try {
      this.exec(`worktree remove ${path} --force`);
    } catch {
      /* may already be removed */
    }
  }

  pruneWorktrees(): void {
    try {
      this.exec('worktree prune');
    } catch {
      /* best-effort */
    }
  }

  hasChanges(worktreePath: string): boolean {
    try {
      const status = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf8',
        timeout: 10_000,
      }).trim();
      return status.length > 0;
    } catch {
      return false;
    }
  }

  getChangedFiles(worktreePath: string): string[] {
    try {
      const status = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf8',
        timeout: 10_000,
      }).trim();
      if (!status) return [];
      return status
        .split('\n')
        .map((line) => parsePorcelainPath(line))
        .filter((p): p is string => p !== null);
    } catch {
      return [];
    }
  }

  stageAll(worktreePath: string): void {
    execSync('git add -A', {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 15_000,
    });
  }

  commitNoVerify(worktreePath: string, message: string): string {
    execSync(`git commit --no-verify -m ${escapeShellArg(message)}`, {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 30_000,
    });
    return execSync('git rev-parse HEAD', {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
  }

  async push(branchName: string, retries = 3): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.exec(`push -u origin ${branchName}`, 60_000);
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

  merge(
    worktreePath: string,
    branchName: string,
  ): { success: boolean; conflicts: string[] } {
    try {
      execSync(`git merge ${branchName} --no-ff -m "Merge ${branchName}"`, {
        cwd: worktreePath,
        encoding: 'utf8',
        timeout: 60_000,
      });
      return { success: true, conflicts: [] };
    } catch (err) {
      try {
        const status = execSync('git diff --name-only --diff-filter=U', {
          cwd: worktreePath,
          encoding: 'utf8',
          timeout: 10_000,
        }).trim();
        const conflicts = status ? status.split('\n') : [];
        return { success: false, conflicts };
      } catch {
        return { success: false, conflicts: [errorMessage(err)] };
      }
    }
  }

  abortMerge(worktreePath: string): void {
    try {
      execSync('git merge --abort', {
        cwd: worktreePath,
        encoding: 'utf8',
        timeout: 10_000,
      });
    } catch {
      /* no merge to abort */
    }
  }

  getHead(worktreePath: string): string {
    return execSync('git rev-parse HEAD', {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
  }
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
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
