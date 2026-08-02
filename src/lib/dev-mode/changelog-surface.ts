/**
 * Where a project records user-visible change.
 *
 * The `changelogGate` methodology has two halves and they need different
 * grounding. The commit-subject half is universal — Conventional Commits is a
 * format, checkable with git and a regex in any repository. The changelog-entry
 * half is not: demanding an entry in a file the project does not have would
 * fail every merge for a reason nobody can act on, which is exactly what
 * `collectMergeGate` refuses to do.
 *
 * So the surface is DETECTED, never assumed, and a project with none simply
 * gets the commit-format half. Detection is deliberately dumb — the presence
 * of a path, nothing parsed — because the only consumer is a prompt that names
 * the path back to an agent that will read it itself.
 *
 * Fragment directories come FIRST: a project that has both `.changes/` and a
 * generated `CHANGELOG.md` wants the entry in the fragment, and naming the
 * generated file instead would send agents to edit build output.
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Candidate surfaces, most specific first. The three directories are the
 * fragment conventions in wide use (huu's own `.changes/`, towncrier's
 * `changelog.d/`, changesets' `.changeset/`); `CHANGELOG.md` is the fallback
 * for projects that edit one file directly.
 */
const CANDIDATES: readonly { path: string; kind: 'dir' | 'file' }[] = [
  { path: '.changes', kind: 'dir' },
  { path: 'changelog.d', kind: 'dir' },
  { path: '.changeset', kind: 'dir' },
  { path: 'CHANGELOG.md', kind: 'file' },
];

/**
 * The changelog surfaces this repository actually has, as repo-relative paths
 * (directories keep a trailing `/` so a prompt reads unambiguously).
 *
 * Never throws: an unreadable working tree yields `[]`, which degrades the
 * methodology to its commit-format half instead of failing the run.
 */
export function detectChangelogPaths(cwd: string): string[] {
  const found: string[] = [];
  for (const candidate of CANDIDATES) {
    try {
      const full = join(cwd, candidate.path);
      if (!existsSync(full)) continue;
      const stat = statSync(full);
      if (candidate.kind === 'dir' && !stat.isDirectory()) continue;
      if (candidate.kind === 'file' && !stat.isFile()) continue;
      found.push(candidate.kind === 'dir' ? `${candidate.path}/` : candidate.path);
    } catch {
      // A path we cannot stat is a path we cannot ask an agent to write.
    }
  }
  return found;
}
