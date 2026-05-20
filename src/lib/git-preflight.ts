import { execFileSync } from 'node:child_process';
import { resolve as resolvePath, sep } from 'node:path';

/**
 * Host-side git preflight, run BEFORE the docker re-exec.
 *
 * Why this exists: the wrapper bind-mounts `-v <cwd>:<cwd>` and nothing
 * else. That's enough when the user invokes `huu` from a regular repo
 * root, but two configurations break the in-container `git rev-parse`:
 *
 *   1. **Git worktree.** A `.git` *file* in the worktree carries
 *      `gitdir: <main-repo>/.git/worktrees/<name>`. The container can
 *      resolve `.git` (it's inside cwd) but the gitdir target lives
 *      outside the mount, so git treats the path as not-a-repo.
 *
 *   2. **Subdirectory of a repo.** `.git` lives at the repo's toplevel,
 *      not at cwd. Mounting only cwd hides the toplevel, so git's
 *      walk-up search finds nothing.
 *
 * Solution: ask git on the host (where everything resolves correctly)
 * for `--git-common-dir` and `--show-toplevel`. Anything outside cwd
 * becomes an additional `-v <path>:<path>` mount so the container sees
 * the same file-system layout as the host. Same path, host and
 * container — preserves the design invariant that absolute paths are
 * portable across the boundary.
 *
 * ENOENT (no git on host): return ok with no extra mounts. Either we
 * don't need git (caller will refuse) or the user is on `--yolo` and
 * the orchestrator's git layer will produce the canonical error. Don't
 * synthesize one here.
 */

export type GitPreflightResult =
  | {
      ok: true;
      /**
       * Absolute paths to bind-mount into the container in addition to
       * cwd. Empty when cwd alone suffices (regular repo, run from root).
       */
      extraGitMounts: string[];
    }
  | {
      ok: false;
      /** Human-readable message ready to write to stderr. Ends with newline. */
      message: string;
    };

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
    .toString()
    .trim();
}

function isUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent + sep);
}

export function preflightGitOnHost(cwd: string): GitPreflightResult {
  let topLevel: string;
  let commonDir: string;
  try {
    topLevel = runGit(['rev-parse', '--show-toplevel'], cwd);
    commonDir = runGit(['rev-parse', '--git-common-dir'], cwd);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      // No git binary on host. Defer; in-container preflight is the gate.
      return { ok: true, extraGitMounts: [] };
    }
    return {
      ok: false,
      message:
        `huu: not a git repository: ${cwd}\n` +
        `huu runs each agent in an isolated git worktree, so it requires a repo.\n` +
        `Run 'git init' here, or cd into an existing repo, then try again.\n`,
    };
  }

  // git emits common-dir relative to cwd in a regular repo (".git") and
  // absolute in a worktree. Resolve uniformly.
  const absTopLevel = resolvePath(cwd, topLevel);
  const absCommonDir = resolvePath(cwd, commonDir);

  // Walk a candidate list, dedup-by-containment so the wrapper emits
  // the smallest set of mounts that exposes every git-relevant path.
  const candidates = [absTopLevel, absCommonDir];
  const mounts: string[] = [];
  for (const p of candidates) {
    if (isUnder(p, cwd)) continue; // already covered by -v <cwd>:<cwd>
    if (mounts.some((m) => isUnder(p, m))) continue; // covered by an earlier mount
    // Replace any existing mount that is now nested under p.
    for (let i = mounts.length - 1; i >= 0; i--) {
      if (isUnder(mounts[i], p)) mounts.splice(i, 1);
    }
    mounts.push(p);
  }

  return { ok: true, extraGitMounts: mounts };
}
