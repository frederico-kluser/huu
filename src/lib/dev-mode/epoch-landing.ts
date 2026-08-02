// Land a finished epoch onto the working branch.
//
// WHY THIS EXISTS — the non-obvious bit of multi-epoch dev mode.
//
// A huu run accumulates its work on `huu/<runId>/integration` and, in
// `start()`'s finally, REMOVES the integration worktree while leaving the
// BRANCH behind for the user to merge at their leisure. That is exactly right
// for a one-shot pipeline run, and exactly wrong for a chain of epochs: epoch
// N+1's `Orchestrator` runs preflight against the user's checkout and branches
// its own integration worktree from THAT head. Without an explicit landing
// step, every epoch would re-plan and re-implement against the pre-epoch-1
// code, and epoch N's work would sit orphaned on a branch nobody merged.
//
// So between epochs the driver merges the integration branch into the working
// branch, non-fast-forward, and refuses to continue if that merge is not
// clean. A conflict here is a genuine stop: the epochs are sequential, so
// there is no "other agent" whose work could be preferred.

import { GitClient } from '../../git/git-client.js';

export interface LandEpochOptions {
  /** The user's checkout — the branch the epochs accumulate on. */
  cwd: string;
  /** `RunManifest.integrationBranch` of the epoch that just finished. */
  integrationBranch: string;
  /** 1-based epoch number, used in the merge message. */
  epoch: number;
  /** Test seam: an already-constructed client for `cwd`. */
  git?: GitClient;
}

export interface LandEpochResult {
  landed: boolean;
  /** HEAD of the working branch after a successful landing. */
  commit?: string;
  /** Present when `landed` is false. Always human-readable. */
  error?: string;
  /** Conflicting paths, when the merge failed on conflicts. */
  conflicts?: string[];
  /** True when the branch was already contained in HEAD (no-op landing). */
  alreadyUpToDate?: boolean;
}

/**
 * Merges `integrationBranch` into the checkout at `cwd`.
 *
 * Never throws: every failure mode (missing branch, dirty tree, conflicts,
 * git error) comes back as `{ landed: false, error }` so the driver can
 * record it on the epoch and stop the session cleanly.
 */
export async function landEpoch(opts: LandEpochOptions): Promise<LandEpochResult> {
  const git = opts.git ?? new GitClient(opts.cwd);

  try {
    if (!(await git.branchExists(opts.integrationBranch))) {
      return {
        landed: false,
        error: `integration branch "${opts.integrationBranch}" does not exist — the epoch produced nothing to land`,
      };
    }
  } catch (err) {
    return { landed: false, error: `cannot inspect branches: ${message(err)}` };
  }

  // A dirty checkout would let the merge mix uncommitted user edits into the
  // epoch chain (or refuse mid-way). Stop before touching anything.
  try {
    if (await git.hasChanges(opts.cwd)) {
      return {
        landed: false,
        error: `the working tree at ${opts.cwd} has uncommitted changes — commit or stash them before landing epoch ${opts.epoch}`,
      };
    }
  } catch (err) {
    return { landed: false, error: `cannot read the working tree state: ${message(err)}` };
  }

  const headBefore = await safeHead(git, opts.cwd);

  const result = await git.merge(opts.cwd, opts.integrationBranch);
  if (!result.success) {
    // Leave the checkout exactly as we found it — a half-merged tree would
    // block the next epoch AND confuse the user.
    await git.abortMerge(opts.cwd);
    return {
      landed: false,
      conflicts: result.conflicts,
      error:
        result.conflicts.length > 0
          ? `landing epoch ${opts.epoch} conflicted on ${result.conflicts.length} file(s): ${result.conflicts.join(', ')}`
          : `landing epoch ${opts.epoch} failed: ${result.error ?? 'unknown git error'}`,
    };
  }

  const commit = await safeHead(git, opts.cwd);
  return {
    landed: true,
    commit,
    alreadyUpToDate: commit !== undefined && commit === headBefore,
  };
}

async function safeHead(git: GitClient, cwd: string): Promise<string | undefined> {
  try {
    return await git.getHead(cwd);
  } catch {
    return undefined;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
