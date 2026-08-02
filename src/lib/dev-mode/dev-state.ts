// The driver-owned half of the dev-mode blackboard.
//
// Ownership split — worth stating because it is the thing that keeps epochs
// from corrupting each other:
//   huu (this module) owns  `goal.md` and `state.json`.
//   Agents own              `epoch-<N>/**` and `journal.md`.
// Every agent prompt says so explicitly. huu never rewrites an agent's
// artefact, and no agent is allowed to touch the goal or the state.
//
// Both driver-owned files are COMMITTED, for two independent reasons:
//  - agent worktrees are checked out from a commit, so an uncommitted
//    `goal.md` would simply not exist for the swarm; and
//  - the next epoch's landing merge refuses to run on a dirty tree, so
//    leaving them uncommitted would stall the chain after epoch 1.
// `.huu/` is often gitignored, hence the forced add.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GitClient } from '../../git/git-client.js';
import type { DevState } from '../types.js';
import { devPaths } from './dev-protocol.js';

/**
 * The tag huu writes, and the ONLY tag `readDevState` accepts.
 *
 * v2 added `sessionId` — the path segment the epoch blackboard now lives under
 * (`devSessionPaths`). A v1 file has no session, so nothing under
 * `.huu/dev/epoch-N/` can be attributed to it, and resuming from one would
 * point a new session's fan-out at another session's specs. The refusal in
 * `readDevState` is therefore the migration: a v1 file degrades to "no resume
 * offered", which is exactly the right outcome, and costs zero migration code.
 */
export const DEV_STATE_FORMAT = 'huu-devstate-v2';

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** Writes the human's goal verbatim. Never templated, never summarized. */
export function writeGoalFile(cwd: string, goal: string): void {
  writeFileEnsuringDir(
    join(cwd, devPaths.goal),
    `# Objetivo\n\n> Escrito pelo humano. Nenhum agente reescreve este arquivo.\n\n${goal.trim()}\n`,
  );
}

export function writeDevState(cwd: string, state: DevState): void {
  writeFileEnsuringDir(join(cwd, devPaths.state), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Reads a previous session's state. Returns null when absent OR unreadable —
 * a corrupt state file must not block a new session; the worst case is that
 * the planner loses its history and plans epoch 1 again.
 */
export function readDevState(cwd: string): DevState | null {
  const path = join(cwd, devPaths.state);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DevState>;
    if (parsed._format !== DEV_STATE_FORMAT || !Array.isArray(parsed.epochs)) return null;
    return parsed as DevState;
  } catch {
    return null;
  }
}

/** The consolidation step's report for `epoch`, when it was written. */
export function readEpochReport(cwd: string, epoch: number): string | undefined {
  const path = join(cwd, devPaths.epochReport(epoch));
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Paths huu itself writes into the user's repo during a dev session, and is
 * therefore responsible for committing.
 *
 * `.gitignore` is on this list for a non-obvious reason: `Orchestrator.start()`
 * calls `ensureGitignored` for `.huu-worktrees/`, the run-log dir, `.env.huu`
 * and the agent bin dir. On a repo that has never run huu that CREATES or
 * MODIFIES `.gitignore` — which leaves the tree dirty, which makes the next
 * `landEpoch` merge refuse. Found by the first end-to-end stub session.
 *
 * `commitBlackboard` filters out tracked paths that have no diff from HEAD
 * before staging, so `.gitignore` is never swept into a commit without actual
 * changes.
 *
 * `journal.md` is the dev-mode session journal — it accumulates across epochs
 * and must survive the landing merge just like the goal and state.
 */
export const HUU_OWNED_PATHS = [devPaths.goal, devPaths.state, devPaths.journal, '.gitignore'] as const;

/** huu's own directory in the target repo — logs, audits, the dev blackboard. */
const HUU_ROOT = '.huu';

/**
 * The huu-owned paths that actually exist right now, plus any caller-supplied
 * extras (the driver uses these for the files it materializes deterministically
 * — gap specs and the knowledge index, which must be COMMITTED before the
 * memory fan-out can resolve them).
 *
 * Filtering by `existsSync` is not cosmetic: `git add -f` fails the whole
 * command on an unknown pathspec, which would abort the session's only commit.
 *
 * Everything NOT on this list that lives under `.huu/` is the agents' —
 * the epoch blackboard reaches the working branch through the landing merge,
 * never through here.
 */
function ownedPathsPresent(cwd: string, extraPaths: readonly string[] = []): string[] {
  const all = [...HUU_OWNED_PATHS, ...extraPaths];
  return [...new Set(all)].filter((p) => p.length > 0 && existsSync(join(cwd, p)));
}

/**
 * Stages the huu-owned files and commits them if anything actually changed.
 * Returns the new commit sha, or null when there was nothing to commit (the
 * common case once the goal is settled and huu's gitignore lines are in).
 *
 * `extraPaths` widens the SET OF PATHS, never the scoping: they are added to
 * the same path-scoped add/diff/commit. Pass repo-relative paths the driver
 * itself wrote and must land before the next run branches from HEAD.
 *
 * Errors are surfaced rather than swallowed: unlike the log paths, a failure
 * here means the next epoch's landing refuses on a dirty tree.
 */
export async function commitBlackboard(
  git: GitClient,
  cwd: string,
  message: string,
  extraPaths: readonly string[] = [],
): Promise<string | null> {
  let paths = ownedPathsPresent(cwd, extraPaths);
  if (paths.length === 0) return null;

  // Filter out `.gitignore` when it is tracked AND has no working-tree
  // diff from HEAD — it was being force-added then swept into a commit even
  // when `ensureGitignored` had nothing to add.  Untracked `.gitignore`
  // (a new file not yet in HEAD) is kept — huu may have written its first
  // ignore entries and those must be committed.
  const dirtyPaths: string[] = [];
  for (const p of paths) {
    if (p !== '.gitignore') {
      dirtyPaths.push(p);
      continue;
    }
    // Check whether `.gitignore` is tracked before diff-ing. `git diff`
    // returns empty for untracked files too, so we must distinguish.
    const tracked = await git.exec(`ls-files -- ${p}`);
    if (tracked.length === 0) {
      // Untracked — huu may have just created it. Keep.
      dirtyPaths.push(p);
    } else {
      // Tracked — only keep if it actually changed from HEAD.
      const diff = await git.exec(`diff --name-only HEAD -- ${p}`);
      if (diff.length > 0) dirtyPaths.push(p);
    }
  }
  paths = dirtyPaths;
  if (paths.length === 0) return null;

  // Forced, because `.huu/` is commonly gitignored — the same reason the
  // bundled pipelines carry a PERSISTENCE CHECK.
  await git.exec(`add -f ${paths.join(' ')}`);

  // BOTH of these are path-scoped, and that is the whole point. This runs in
  // the USER's checkout, mid-session, while they may be staging their own work
  // in another terminal. An unscoped `diff --cached` would see their file and
  // trigger a commit; an unscoped `git commit` would then sweep it into a
  // `chore(huu-dev)` commit, past the pre-commit hooks that `--no-verify`
  // skips, and land it on their branch attributed to huu.
  const staged = await git.exec(`diff --cached --name-only -- ${paths.join(' ')}`);
  if (staged.length === 0) return null;
  return git.commitNoVerify(cwd, message, paths);
}

/**
 * Working-tree paths that are dirty and NOT huu's to commit. A non-empty
 * result at session start means the user has uncommitted work: dev mode would
 * either sweep it into an epoch commit or stall at the first landing, so the
 * driver refuses instead.
 */
export async function foreignDirtyPaths(git: GitClient, cwd: string): Promise<string[]> {
  // Deliberately NOT `status --porcelain`: its two-column status prefix is
  // stripped with a fixed slice(3), and `GitClient.exec` trims the whole
  // output — so the FIRST line of a ` M path` status loses a character. These
  // two plumbing commands emit bare paths with no prefix at all.
  const [tracked, untracked] = await Promise.all([
    git.exec('diff --name-only HEAD'),
    git.exec('ls-files --others --exclude-standard'),
  ]);

  const owned = new Set<string>(HUU_OWNED_PATHS);
  const paths = [...tracked.split('\n'), ...untracked.split('\n')]
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return [...new Set(paths)].filter(
    (path) =>
      !owned.has(path) &&
      // Everything under `.huu/` belongs to huu or its agents — never to the
      // user — so a stale blackboard must not block a new session. Git
      // reports an untracked DIRECTORY as `.huu/`, hence the prefix test
      // rather than an exact match on the blackboard root.
      path !== HUU_ROOT &&
      !path.startsWith(`${HUU_ROOT}/`),
  );
}
