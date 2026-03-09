import type { SimpleGit } from 'simple-git';

/**
 * Detect the default branch of a Git repository.
 *
 * Strategy (in order):
 * 1. Check `refs/remotes/origin/HEAD` (set by clone)
 * 2. Check if `main` exists locally
 * 3. Check if `master` exists locally
 * 4. Fall back to whatever `HEAD` points to
 */
export async function detectDefaultBranch(git: SimpleGit): Promise<string> {
  // 1. Try origin/HEAD (most reliable after clone)
  try {
    const ref = (await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim();
    // ref looks like "refs/remotes/origin/main"
    const branch = ref.replace('refs/remotes/origin/', '');
    if (branch) return branch;
  } catch {
    // origin/HEAD not set — continue
  }

  // 2. Check common branch names
  for (const candidate of ['main', 'master']) {
    try {
      await git.raw(['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // branch doesn't exist — try next
    }
  }

  // 3. Fall back to current HEAD branch
  try {
    const current = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (current && current !== 'HEAD') return current;
  } catch {
    // detached HEAD or bare repo
  }

  // Last resort
  return 'main';
}
