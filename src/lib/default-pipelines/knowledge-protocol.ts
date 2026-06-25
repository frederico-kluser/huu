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

/**
 * Recon (producer) prompt for the autonomous file-discovery pattern that
 * replaces manual `per-file` selection. A step carrying this prompt declares
 * `produces: "<path>"`, so huu appends the deterministic MEMORY CONTRACT
 * (exact path + huu-memory-v1 format + cap + hint rule) at run time — the
 * author never writes that boilerplate. A LATER `scope: 'memory'` step reads
 * the file and fans out one task per entry, each entry's `hint` riding `$hint`.
 *
 * Kept here (like {@link reportJudgeCondition}) so every modernized pipeline
 * selects targets with the same wording and the same skip discipline. One
 * cognitive op: choose files, write the list — nothing else.
 */
export function targetsRecon(opts: {
  /** What this run IS (e.g. "huu's test-target selector"). */
  role: string;
  /** What the fan-out will DO with each file (e.g. "write unit tests for"). */
  purpose: string;
  /** Bulleted inclusion criteria — what makes a file worth a slot. */
  prefer: string[];
  /** What each entry's one-line `hint` must carry for the next agent. */
  hintGuide: string;
  /** Width cap (must equal the consumer step's maxFiles). */
  maxFiles: number;
}): string {
  return `You are ${opts.role}. Goal: choose the files worth the work that follows and hand them to the parallel fan-out — ONE cognitive op: pick the files, write the list, nothing else.

=== SKIP RULE (never list these) ===
Generated/vendored/trivial paths: \`node_modules/\`, \`dist/\`, \`build/\`, \`out/\`, \`coverage/\`, \`.git/\`, \`vendor/\`, \`target/\`, \`__pycache__/\`, \`*.generated.*\`, \`*.min.js\`, \`*.min.css\`, \`*.d.ts\`, \`*.lock\`, \`*.snap\`; and pure config / constants / type-only / barrel-export files.

=== SELECT (at most ${opts.maxFiles}, most valuable first) ===
A file earns a slot only when ${opts.purpose} it would catch real regressions or surface real findings. Prefer:
${opts.prefer.map((p) => `- ${p}`).join('\n')}
Fewer, load-bearing files beat a long shallow list. Rank by value and let the cap drop the tail.

=== WRITE THE MEMORY FILE ===
Write your selection to the file named in the MEMORY CONTRACT appended below (huu fills in the exact path + format). One entry per file:
- \`path\`: repo-relative.
- \`hint\`: ${opts.hintGuide} — this becomes the next agent's \`$hint\` and is the single most valuable thing you hand over. Never leave it empty.
- \`priority\`: higher runs first; the cap drops the lowest. Rank deliberately.
An EMPTY list is valid and means "nothing here qualifies" — the next stage then runs zero tasks (do not pad to hit the cap).

=== HARD RULES ===
- Selection only: do NOT modify source, run long builds, or write anything except the memory file.
- Be language-agnostic — do not assume Node.js.
- Every path you list must exist in the working tree (the consumer drops unresolvable paths).`;
}

/**
 * Natural-language condition for the report-validation judge appended to
 * every report-only audit. The judge runs in the integration worktree with
 * shell access; the condition tells it exactly what evidence to gather so
 * the verdict is reproducible. Kept in one place so all five audits demand
 * the same bar.
 */
export function reportJudgeCondition(opts: {
  /** e.g. `.huu/audits/security.md` */
  reportPath: string;
  /** e.g. `.huu/audits/security-faq.json` */
  faqPath: string;
  /** Section headings that must exist and be non-placeholder. */
  requiredSections: string[];
  /** Extra audit-specific clauses (e.g. "all secrets are redacted"). */
  extraClauses?: string[];
}): string {
  const sections = opts.requiredSections.map((s) => `"${s}"`).join(', ');
  const extra = (opts.extraClauses ?? [])
    .map((c, i) => `${5 + i}) ${c}`)
    .join(' ');
  return (
    `The report at \`${opts.reportPath}\` is complete and internally consistent. Verify ALL of: ` +
    `1) the file exists and every required section (${sections}) is present and contains real content — no "(filled in by step N)" or TODO placeholders left. ` +
    `2) \`${opts.faqPath}\` parses as a JSON array and the counts cited in the report's summary tables match the actual entries (severity totals, category totals). ` +
    `3) recommendations are ordered critical → warn → info, and within each severity respect the optional "priority"/"fixability" fields when present. ` +
    `4) \`git status --porcelain\` shows NO modified files outside \`.huu/\` except at most one \`.gitignore\` whose diff only rewrites a \`.huu/\` exclusion into \`.huu/*\` + a negation line (report-only contract). ` +
    `${extra} ` +
    `This is run $runs of this validation. If every clause holds, answer "approved"; if any fails, answer "rework" and say precisely which clause failed and why in the reason.`
  );
}
