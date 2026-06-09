// Shared prompt blocks for the progressive-knowledge convention used by the
// bundled default pipelines: one JSON findings array per run acts as shared
// memory — every step reads it before acting and appends what it learned, so
// later stages inherit the accumulated knowledge of earlier ones by simply
// referencing the file. This module keeps the wording identical across all
// pipelines (and is the single place to evolve the protocol).
//
// IMPORTANT: keep this file pure (no fs / no env). It is imported on the hot
// path of `App` mount via the default-pipelines registry.

/**
 * The read-before / append-after protocol block, interpolated into steps
 * that both consume and produce knowledge. `schemaLine` is the pipeline's
 * own entry schema (one line of JSON-ish text) so the block never
 * contradicts the schema documented by the bootstrap step.
 */
export function knowledgeProtocol(faqPath: string, schemaLine: string): string {
  return `=== PROGRESSIVE KNOWLEDGE PROTOCOL ===
\`${faqPath}\` is this run's shared memory — a single JSON array every agent reads and extends.
1. BEFORE acting: read \`${faqPath}\`. Build on what prior steps/agents already discovered; do not re-derive solved facts or re-flag findings that are already recorded.
2. AFTER your goal: RE-READ \`${faqPath}\` (parallel agents may have appended while you worked), then APPEND your entries:
   ${schemaLine}
   Optionally add prioritization fields when you can judge them: "priority": 1|2|3 (1 = do first) and "fixability": "trivial|moderate|involved" — the final step orders its recommendations by them.
3. Append-only: never rewrite, reorder, or delete existing entries. Skip the append when a semantically equivalent summary already exists.
4. If \`${faqPath}\` is missing: abort with a clear error (the bootstrap step is a prerequisite). If it is corrupted: replace it with \`[]\` and say so in the log.`;
}

/**
 * One-line note appended to the bootstrap step's schema documentation so
 * older FAQ entries (without the prioritization fields) remain valid.
 */
export const KNOWLEDGE_OPTIONAL_FIELDS_NOTE =
  'Optional per-entry prioritization fields (additive — entries without them remain valid): "priority": 1|2|3 (1 = do first), "fixability": "trivial|moderate|involved".';

/**
 * Ordering rule for consolidation/final steps that turn findings into
 * recommendations.
 */
export const KNOWLEDGE_ORDERING_NOTE =
  'Within each severity group, order items by "priority" (1 first) then "fixability" (trivial first) when the findings carry those fields; findings without them keep their relative order.';

/**
 * Gitignore persistence check for pipelines whose deliverables live under
 * `.huu/<subdir>/`. Agent worktrees check out the COMMITTED .gitignore; if
 * the user committed a `.huu/` line, `git add -A` silently drops the
 * deliverables and they never reach the integration branch.
 */
export function persistenceCheck(subdir: string): string {
  return `=== PERSISTENCE CHECK ===
The deliverables under \`.huu/${subdir}/\` must survive the stage merge, so they cannot be gitignored.
Run: \`git check-ignore -q .huu/${subdir} && echo IGNORED || echo OK\`
If IGNORED: the committed \`.gitignore\` excludes \`.huu/\`. Apply the MINIMAL rewrite — replace the line \`.huu/\` (or \`.huu\`) with \`.huu/*\` and add \`!.huu/${subdir}/\` on the next line. Git cannot re-include below an excluded DIRECTORY, but \`.huu/*\` only excludes the entries, so the negation works. This one-line edit is the ONLY permitted change outside \`.huu/${subdir}/\` in this pipeline. If OK: leave \`.gitignore\` alone.`;
}
