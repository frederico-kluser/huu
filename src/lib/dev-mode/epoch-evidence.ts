// What an epoch actually produced, in the only shape a BLIND orchestrator is
// allowed to see.
//
// The next epoch's planner used to get one thing: the consolidation report, in
// prose, written by an LLM about work done by other LLMs. That is a summary of
// a summary — it cannot say "the judge defaulted forward because it crashed",
// or "three tasks merged with a critic still objecting", because no agent
// writes those sentences about itself.
//
// Everything here is derived from state the run already carries, and every
// field is BOUNDED and TABULAR on purpose. The planner never receives a file,
// a diff body, or a path it could ask to read: it gets counts, labels and a
// capped stat table. Interpreting them is not its job either — from epoch 2 on
// a "delivered vs promised" gap goes to a subagent that CAN read the code, and
// its answer comes back as ordinary knowledge.
//
// Keep this module free of orchestrator imports: it reads plain state objects
// and a GitClient, nothing else.

import type { GitClient } from '../../git/git-client.js';
import type { DevEpochEvidence, OrchestratorState } from '../types.js';
import type { LandEpochResult } from './epoch-landing.js';

/** Files listed individually in the diff stat before it collapses to a count. */
export const DEFAULT_DIFF_STAT_FILES = 40;

/**
 * Hard ceiling on the rendered stat, in characters. A path can be arbitrarily
 * long, so capping the ROW COUNT alone does not bound the string.
 */
export const MAX_DIFF_STAT_CHARS = 4000;

/** Ceiling on `filesChanged`. */
export const MAX_EVIDENCE_FILES = 200;

/** Ceiling on the slice of the epoch report that travels with the evidence. */
export const MAX_REPORT_EXCERPT_CHARS = 2000;

/** Ceiling on how many tasks are listed as having violated their write set. */
export const MAX_VIOLATION_TASKS = 40;

/** Ceiling on the offending paths listed per task. */
export const MAX_VIOLATION_PATHS = 20;

/** Ceiling on the per-card review-round distribution. */
export const MAX_REVIEW_ROUND_SAMPLES = 100;

/** Ceiling on how many stage merges the conflict table reports. */
export const MAX_INSTRUMENTED_STAGES = 40;

/**
 * The instrumentation block with nothing optional — what
 * {@link collectEpochEvidence} always produces, as opposed to what a record
 * persisted before the block existed may lack.
 */
export type EpochInstrumentation = NonNullable<DevEpochEvidence['instrumentation']>;

interface NumstatRow {
  added: number;
  deleted: number;
  binary: boolean;
  path: string;
}

/**
 * `git diff --numstat <from>..<to>`, rendered as a table capped at `maxFiles`
 * rows ordered by CHURN (added + deleted), with the remainder collapsed into
 * one "…and N more" line.
 *
 * Churn ordering rather than git's alphabetical `--stat`: when the table is
 * truncated, the rows that survive should be the ones that carry the epoch's
 * substance, not the ones whose paths sort first.
 *
 * Never throws and never returns partial garbage — an unreadable range yields
 * `''`, and the caller records an epoch with no diff stat rather than losing
 * the whole evidence record.
 */
export async function readLandedDiffStat(
  git: GitClient,
  from: string | undefined,
  to: string | undefined,
  maxFiles: number = DEFAULT_DIFF_STAT_FILES,
): Promise<string> {
  if (!from?.trim() || !to?.trim()) return '';
  // Revisions reach `GitClient.exec` as whitespace-split argv tokens; a ref
  // with a space in it is not a ref we ever produce, but it would silently
  // become two arguments, so refuse instead.
  if (/\s/.test(from) || /\s/.test(to)) return '';
  if (from === to) return '';

  let raw: string;
  try {
    raw = await git.exec(`diff --numstat ${from}..${to}`);
  } catch {
    return '';
  }

  const rows = parseNumstat(raw);
  if (rows.length === 0) return '';

  const limit = Math.max(1, maxFiles);
  const ranked = [...rows].sort(
    (a, b) => churn(b) - churn(a) || a.path.localeCompare(b.path),
  );
  const shown = ranked.slice(0, limit);
  const rest = ranked.slice(limit);

  const totals = rows.reduce(
    (acc, r) => ({ added: acc.added + r.added, deleted: acc.deleted + r.deleted }),
    { added: 0, deleted: 0 },
  );

  const lines = [
    `${rows.length} file(s) changed, +${totals.added}/-${totals.deleted}`,
    ...shown.map((r) => (r.binary ? `  bin       ${r.path}` : `  +${r.added} -${r.deleted}  ${r.path}`)),
  ];
  if (rest.length > 0) {
    const restAdded = rest.reduce((n, r) => n + r.added, 0);
    const restDeleted = rest.reduce((n, r) => n + r.deleted, 0);
    lines.push(`  …and ${rest.length} more file(s), +${restAdded}/-${restDeleted}`);
  }

  return clampChars(lines.join('\n'), MAX_DIFF_STAT_CHARS);
}

export interface CollectEpochEvidenceArgs {
  epoch: number;
  /**
   * The last state the run emitted. `null` when the epoch never produced one
   * (the planner failed, the run threw on start) — evidence is still recorded,
   * just empty, because "we ran and learned nothing" is itself information the
   * next planner needs.
   */
  state: OrchestratorState | null;
  landing: LandEpochResult;
  /** The consolidation step's report, when it wrote one. */
  report?: string;
  /** From {@link readLandedDiffStat}. */
  diffStat: string;
}

/**
 * Folds one epoch's run state, landing result and diff stat into the record
 * the next planning pass reads. Pure — all IO happened before it was called.
 */
export function collectEpochEvidence(
  args: CollectEpochEvidenceArgs,
): DevEpochEvidence & { instrumentation: EpochInstrumentation } {
  const agents = args.state?.agents ?? [];

  const verdicts = (args.state?.checkRuns ?? []).map((run) => ({
    stepName: run.stepName,
    // A check that errored before routing has no label at all. Say so rather
    // than inventing "approved" — the forward default is exactly the failure
    // mode this evidence exists to make visible.
    label: run.outcomeLabel ?? '(none)',
    fromJudge: run.fromJudge === true,
    ...(run.reason ? { reason: run.reason } : {}),
  }));

  const waived = agents
    .filter((a) => a.reviewWaived === true)
    .map((a) => ({
      agentId: a.agentId,
      stageName: a.stageName,
      // Every finding, not just the blocking ones: the next planner is judging
      // whether the critic was right, and needs to see what it was told.
      findings: a.reviewFindings ?? [],
    }));

  // Mutually exclusive buckets, most-severe first, so the four counts sum to
  // the number of task cards. An unmerged card also reads as `state: 'done'`,
  // and a failed one may carry `mergeFailed` too — without a precedence the
  // same task would be counted twice and the totals would lie.
  const taskOutcomes = { done: 0, noChanges: 0, failed: 0, unmerged: 0 };
  for (const a of agents) {
    if (a.state === 'error') taskOutcomes.failed += 1;
    else if (a.mergeFailed === true) taskOutcomes.unmerged += 1;
    else if (a.phase === 'no_changes') taskOutcomes.noChanges += 1;
    else if (a.state === 'done') taskOutcomes.done += 1;
  }

  // From the AGENTS, not re-parsed out of `diffStat`: the run already carries
  // this structurally, and the two answer different questions — what the swarm
  // reported writing, versus what actually landed after integration. When they
  // disagree, that disagreement is itself worth the next planner's attention.
  const filesChanged = [...new Set(agents.flatMap((a) => a.filesModified ?? []))]
    .filter((p) => p.trim().length > 0)
    .sort()
    .slice(0, MAX_EVIDENCE_FILES);

  const excerpt = clampChars(args.report?.trim() ?? '', MAX_REPORT_EXCERPT_CHARS);

  return {
    epoch: args.epoch,
    diffStat: args.diffStat,
    filesChanged,
    verdicts,
    waived,
    taskOutcomes,
    landing: {
      landed: args.landing.landed,
      ...(args.landing.commit ? { commit: args.landing.commit } : {}),
      ...(args.landing.error ? { error: args.landing.error } : {}),
    },
    ...(excerpt ? { reportExcerpt: excerpt } : {}),
    // Collisions the RUN detected before its own fan-out, declared-vs-declared.
    // Strictly better than the post-landing scan the driver used to be the only
    // source of: it knows which two specs claimed the file while the claim
    // could still have been changed, and it sees ACROSS fronts, which is where
    // the expensive conflicts live. The driver's post-landing scan stays as the
    // reconciliation pass and only fills this in when the run reported nothing.
    ...(args.state?.declaredWriteCollisions && args.state.declaredWriteCollisions.length > 0
      ? {
          declaredPartitionViolations: args.state.declaredWriteCollisions
            .slice(0, MAX_VIOLATION_TASKS)
            .map((c) => ({ path: c.path, specs: [...c.specs] })),
        }
      : {}),
    instrumentation: collectInstrumentation(args.state),
  };
}

/**
 * The measurement half of the evidence: the numbers the deep research came
 * back EMPTY on — nobody has published a compliance rate for LLM agents under
 * a file-scope constraint, nor a conflict rate for N agents working one repo
 * in parallel. Both sit at the centre of what huu bets on, so huu measures
 * them instead of citing someone else's workload.
 *
 * Every list is capped exactly like `diffStat`: the blind orchestrator never
 * receives an unbounded list, and a run with a pathological number of
 * violations must not be able to blow up the record that describes it.
 *
 * Always returns the full block. Zero is a RESULT — "no task wrote outside its
 * spec" is the answer to the write-set question, not the absence of one — so
 * the fields are zeros and empty arrays, never `undefined`.
 */
function collectInstrumentation(state: OrchestratorState | null): EpochInstrumentation {
  const agents = state?.agents ?? [];

  const writeSetViolations = agents
    .filter((a) => (a.writeSetViolations?.length ?? 0) > 0)
    .slice(0, MAX_VIOLATION_TASKS)
    .map((a) => ({
      agentId: a.agentId,
      stageName: a.stageName,
      paths: (a.writeSetViolations ?? []).slice(0, MAX_VIOLATION_PATHS),
    }));

  let proved = 0;
  let unproved = 0;
  let waivedCount = 0;
  const allRounds: number[] = [];
  for (const a of agents) {
    proved += a.reviewStats?.provedBlocking ?? 0;
    unproved += a.reviewStats?.unprovedBlocking ?? 0;
    if (a.reviewWaived === true) waivedCount += 1;
    // A card the critic never ran on contributes no data point. Counting it as
    // a 0 would dilute the distribution with tasks nobody reviewed and make
    // "rounds until convergence" read lower than it is.
    const rounds = a.reviewRounds ?? 0;
    if (rounds > 0) allRounds.push(rounds);
  }
  // Descending, so a truncated list keeps the cards that consumed the MOST
  // critic rounds — precisely the tail the question is about. A distribution
  // is a multiset, so the ordering itself carries no information anyway.
  const rounds = allRounds.sort((a, b) => b - a).slice(0, MAX_REVIEW_ROUND_SAMPLES);

  const mergeConflicts: EpochInstrumentation['mergeConflicts'] = [];
  for (const stage of state?.stageIntegrations ?? []) {
    // Every branch the merge was asked to land: the resolver moves branches
    // from pending to merged as it fixes them, so neither list alone is the
    // denominator. A stage with nothing eligible was never a merge — leaving
    // it out keeps the rate honest instead of padding it with 0/0 rows.
    const eligible = new Set([...(stage.branchesMerged ?? []), ...(stage.branchesPending ?? [])]);
    if (eligible.size === 0) continue;
    // One conflict entry per FILE, so the same branch appears many times —
    // the question is how many BRANCHES conflicted.
    const conflicted = new Set((stage.conflicts ?? []).flatMap((c) => c.branches ?? []));
    mergeConflicts.push({
      stageName: stage.stageName,
      eligible: eligible.size,
      conflicted: conflicted.size,
    });
    if (mergeConflicts.length >= MAX_INSTRUMENTED_STAGES) break;
  }

  return {
    writeSetViolations,
    review: { proved, unproved, rounds, waivedCount },
    mergeConflicts,
  };
}

/**
 * One operator line per epoch — what makes the measurement visible without
 * opening the JSON. Reads off the (already capped) evidence block, so the log
 * and the record can never disagree.
 */
export function formatInstrumentationLine(epoch: number, i: EpochInstrumentation): string {
  const violatedPaths = i.writeSetViolations.reduce((n, v) => n + v.paths.length, 0);
  const eligible = i.mergeConflicts.reduce((n, m) => n + m.eligible, 0);
  const conflicted = i.mergeConflicts.reduce((n, m) => n + m.conflicted, 0);

  const parts = [
    `write-set ${violatedPaths} file(s) across ${i.writeSetViolations.length} task(s)`,
    `blocking ${i.review.proved} proved / ${i.review.unproved} unproved`,
    i.review.rounds.length > 0
      ? `review rounds median ${formatMedian(i.review.rounds)} across ${i.review.rounds.length} card(s)`
      : 'review rounds none (no card was reviewed)',
    `${i.review.waivedCount} waived at the cap`,
    `merge conflicts ${conflicted}/${eligible} branch(es) across ${i.mergeConflicts.length} stage merge(s)`,
  ];
  return `epoch ${epoch} instrumentation: ${parts.join(' · ')}`;
}

/** Median of a non-empty list, printed without a trailing `.0`. */
function formatMedian(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Number.isInteger(median) ? String(median) : median.toFixed(1);
}

function churn(r: NumstatRow): number {
  return r.added + r.deleted;
}

function parseNumstat(raw: string): NumstatRow[] {
  const rows: NumstatRow[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    // added \t deleted \t path — a binary file reports "-" for both counts, and
    // a rename reports `old => new` in the path column (kept verbatim: it is
    // exactly what happened).
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [addedRaw, deletedRaw] = parts;
    const path = parts.slice(2).join('\t').trim();
    if (path.length === 0) continue;
    const binary = addedRaw === '-' || deletedRaw === '-';
    rows.push({
      added: binary ? 0 : toCount(addedRaw),
      deleted: binary ? 0 : toCount(deletedRaw),
      binary,
      path,
    });
  }
  return rows;
}

function toCount(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Truncates on a line boundary when it can, so the tail is never half a row. */
function clampChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const lastBreak = head.lastIndexOf('\n');
  const body = lastBreak > max * 0.5 ? head.slice(0, lastBreak) : head;
  return `${body}\n… (truncated)`;
}
