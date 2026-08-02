// Integration branches carrying work that never reached the user's branch.
//
// A huu run accumulates everything on `huu/<runId>/integration` and then, in
// `start()`'s finally, removes the integration WORKTREE while leaving the
// BRANCH behind. `epoch-landing.ts` is what normally merges it. Anything that
// interrupts a session between those two — a crash, a Ctrl-C, a landing that
// conflicted, a container killed by the OOM reaper — leaves the epoch's work
// on a branch nobody will ever look at again.
//
// It is genuinely lost work, and it is invisible: `git status` is clean, the
// files are simply not there. So a new session looks for these first and says
// what it found.
//
// The test is git's, not a bookkeeping flag: a branch is orphaned when HEAD
// does not contain it (`rev-list --count HEAD..<branch>` > 0). A branch that
// landed reports 0 and is silently correct, whatever the state file remembers.

import type { GitClient } from '../../git/git-client.js';
import type { DevEpochRecord } from '../types.js';

export interface OrphanBranch {
  /** Short ref, e.g. `huu/k3f9a2b1/integration`. */
  branch: string;
  /** The run that produced it, parsed from the branch name. */
  runId: string;
  /** Commits on the branch that HEAD does not have. Always > 0. */
  ahead: number;
  /** Epoch number, when a known record claims this run. */
  epoch?: number;
}

/**
 * Just enough of an epoch record to attribute a branch. Typed structurally so
 * `DevState.epochs` passes straight in.
 */
export type KnownEpoch = Pick<DevEpochRecord, 'epoch' | 'runId'>;

const INTEGRATION_REF_GLOB = 'refs/heads/huu/*/integration';
/** Greedy middle: a run id is a nanoid today, but the shape is the contract. */
const BRANCH_PATTERN = /^huu\/(.+)\/integration$/;

/**
 * Lists integration branches HEAD has not absorbed, oldest epoch first.
 *
 * Never throws. A repo with no branches, an unborn HEAD, or a git that fails
 * outright all come back as `[]`: a forgotten branch is a thing to REPORT, and
 * must never be a thing that blocks a new session from starting.
 */
export async function findOrphanIntegrationBranches(
  git: GitClient,
  knownEpochs: readonly KnownEpoch[] = [],
): Promise<OrphanBranch[]> {
  let refs: string;
  try {
    refs = await git.exec(`for-each-ref --format=%(refname:short) ${INTEGRATION_REF_GLOB}`);
  } catch {
    return [];
  }

  const branches = refs
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => BRANCH_PATTERN.test(l));
  if (branches.length === 0) return [];

  const epochByRun = new Map<string, number>();
  for (const record of knownEpochs) {
    // First writer wins: if a run id somehow repeats, the earliest epoch is the
    // one whose landing failed, and that is the one worth naming.
    if (!epochByRun.has(record.runId)) epochByRun.set(record.runId, record.epoch);
  }

  const orphans: OrphanBranch[] = [];
  for (const branch of branches) {
    const ahead = await countAhead(git, branch);
    if (ahead <= 0) continue;
    const runId = BRANCH_PATTERN.exec(branch)?.[1] ?? '';
    const epoch = epochByRun.get(runId);
    orphans.push({ branch, runId, ahead, ...(epoch === undefined ? {} : { epoch }) });
  }

  // Landing order: epochs ascending, unattributed branches last. Merging an
  // older epoch after a newer one would replay the history backwards.
  return orphans.sort(
    (a, b) => (a.epoch ?? Number.MAX_SAFE_INTEGER) - (b.epoch ?? Number.MAX_SAFE_INTEGER)
      || a.branch.localeCompare(b.branch),
  );
}

async function countAhead(git: GitClient, branch: string): Promise<number> {
  try {
    const out = await git.exec(`rev-list --count HEAD..${branch}`);
    const n = Number.parseInt(out.trim(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Unborn HEAD, a ref that vanished between the listing and now — either
    // way there is nothing safe to claim about this branch.
    return 0;
  }
}
