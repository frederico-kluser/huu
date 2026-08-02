/**
 * Write-set partition enforcement for dev mode.
 *
 * Every task spec declares the files it OWNS under a `## Files this task OWNS`
 * section (or any heading whose title names both "own(s)" and "file(s)").
 * Two parallel tasks that claim the same file conflict at merge time, so the
 * union of ownerships across all specs of a stage must be disjoint.
 *
 * This module is the pure CHECK, not the policy. The driver runs it over the
 * epoch's specs AFTER the landing — the only moment the `T-*.md` files exist
 * in the user's checkout — and records violations as epoch evidence plus a
 * warning. Blocking on them moves to a compiled pipeline step in a later
 * wave; a pre-run scan found no specs at all, because the front recons only
 * write them DURING the run.
 *
 * The parser is `parseOwnedPaths` from `../../orchestrator/review-agent.js`.
 */

import { parseOwnedPaths } from '../../orchestrator/review-agent.js';
import { collideDeclaredOwnership } from '../../orchestrator/write-sets.js';

/** One spec fed to the partition check — path is for error attribution. */
export interface TaskSpec {
  /** Repo-relative path to the spec file (e.g. `.huu/dev/epoch-1/front-a/T-001.md`). */
  path: string;
  /** Raw markdown content of the spec. */
  content: string;
}

/** A single violation: two or more specs claim the same file. */
export interface WritePartitionViolation {
  /** Repo-relative path that is claimed by more than one spec. */
  path: string;
  /** Paths of the specs that claim this file (stable order by path). */
  specs: string[];
}

/** Result of the write-set partition check. */
export interface WritePartitionResult {
  ok: boolean;
  violations: WritePartitionViolation[];
}

/**
 * Check whether a set of task specs have disjoint file ownership.
 *
 * Reads the `## … owns … files` section of each spec via {@link parseOwnedPaths}
 * and detects any file (including directory-prefix matches) that is claimed by
 * more than one spec.
 *
 * A directory prefix (ending in `/`) matches any file whose path starts with it.
 * Two specs that both claim the exact-same file, or one spec that claims
 * `src/api/` and another that claims `src/api/routes.ts`, are both violations.
 *
 * Specs that claim no files (empty `## Owns files` section or no such heading)
 * are ignored — they cannot conflict with anything.
 *
 * @param specs - Task specs with path and content.
 * @returns `{ ok: false, violations }` when the union is not disjoint.
 */
export function checkWritePartition(specs: readonly TaskSpec[]): WritePartitionResult {
  // Parse here, collide THERE. The collision core lives in
  // `orchestrator/write-sets.ts` because the orchestrator now runs the SAME
  // check BEFORE the fan-out, over the specs `resolveMemoryFiles` just
  // resolved — and two implementations of "do these specs overlap" would
  // eventually answer differently about the same two files.
  const entries = new Map<string, string[]>();
  for (const spec of specs) {
    const claimed = parseOwnedPaths(spec.content);
    if (claimed.length > 0) entries.set(spec.path, claimed);
  }
  const violations: WritePartitionViolation[] = collideDeclaredOwnership(entries);
  return { ok: violations.length === 0, violations };
}

/**
 * Format violations as a human-readable block for logging and error messages.
 */
export function formatWritePartitionViolations(
  violations: readonly WritePartitionViolation[],
): string {
  if (violations.length === 0) return '';

  const lines: string[] = [
    `Write-set partition violation: ${violations.length} file(s) claimed by more than one spec:`,
  ];
  for (const v of violations) {
    lines.push(`  - \`${v.path}\` claimed by ${v.specs.map((s) => `\`${s}\``).join(', ')}`);
  }
  lines.push(
    'Two tasks that write the same file will conflict at merge time.',
    'Give every file exactly ONE owning task.',
  );
  return lines.join('\n');
}
