/**
 * Parser for the per-task critic's verdict block (see {@link ReviewSpec}).
 *
 * Same discipline as the CheckStep judge (`check-evaluator.ts`): scan the
 * critic's output BACK-TO-FRONT for a JSON object, tolerating both a fenced
 * ```json block and a bare inline object, because an agent narrates first and
 * emits its structured answer last. The one difference is shape — a review
 * verdict carries a nested `findings` array, so the judge's flat
 * `\{[^{}]*"label"[^{}]*\}` regex can't see it; we walk the text with a
 * brace-balanced scanner instead.
 *
 * PER-FINDING SALVAGE, in the spirit of `memory-files.ts`: one malformed entry
 * NEVER fails the parse and NEVER decides a merge. A finding with an unknown
 * `severity`/`category`, or with no `file`, is DROPPED with a warning — an
 * unlocatable or unclassifiable claim cannot be acted on by the fixing agent,
 * so letting it hold the merge would be pure cost. Everything else (a missing
 * id, a garbage `line`, a half-written `proof`) is repaired in place, because
 * those are cosmetic and the finding is still actionable without them.
 *
 * The `verdict` string itself is parsed, logged and returned but decides
 * NOTHING — convergence is mechanical and reads only severities (see
 * `runReviewLoop`). That is why an unrecognized verdict degrades to
 * `changes-requested` (with a warning) instead of failing the parse: the safe
 * side of a field that has no authority anyway.
 */

import type { ReviewCategory, ReviewFinding, ReviewSeverity } from '../lib/types.js';

const SEVERITIES: readonly string[] = ['blocker', 'major', 'minor', 'nit'];
const CATEGORIES: readonly string[] = ['style', 'pattern', 'correctness'];

export type ReviewVerdictLabel = 'approved' | 'changes-requested';

export interface ParsedReviewVerdict {
  /** Logged and displayed; never decides convergence. */
  verdict: ReviewVerdictLabel;
  /** Every finding that survived salvage, in the order the critic emitted them. */
  findings: ReviewFinding[];
  /** One line per dropped/repaired field — surfaced in the run log. */
  warnings: string[];
}

/**
 * Pull the LAST parseable verdict object out of `text`.
 *
 * Returns `null` when nothing in the blob is a usable verdict object — the
 * caller treats that as `verdict: 'unavailable'` and merges the work anyway
 * (a broken critic must never destroy a good implementation).
 */
export function parseReviewVerdict(text: string): ParsedReviewVerdict | null {
  if (!text) return null;

  const candidates: string[] = [];

  // Fenced blocks first (the format the prompt asks for) …
  const fenceRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(text)) !== null) {
    candidates.push(m[1]!.trim());
  }
  // … then every balanced `{…}` region that mentions one of our two keys, so a
  // critic that skipped the fence is still understood. This also re-finds the
  // fenced objects, which is harmless: back-to-front iteration keeps
  // "the last block wins" true either way.
  for (const obj of balancedObjects(text)) {
    if (obj.includes('"verdict"') || obj.includes('"findings"')) candidates.push(obj);
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    const parsed = tryParseVerdict(candidates[i]!);
    if (parsed) return parsed;
  }
  return null;
}

function tryParseVerdict(raw: string): ParsedReviewVerdict | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const hasVerdict = typeof value.verdict === 'string';
  const hasFindings = Array.isArray(value.findings);
  // Neither key ⇒ this object is something else the agent printed (a tool
  // result, a config snippet). Keep scanning.
  if (!hasVerdict && !hasFindings) return null;

  const warnings: string[] = [];

  let verdict: ReviewVerdictLabel;
  if (!hasVerdict) {
    verdict = 'changes-requested';
    warnings.push('verdict field missing; recorded as "changes-requested"');
  } else {
    const label = (value.verdict as string).trim().toLowerCase();
    if (label === 'approved' || label === 'changes-requested') {
      verdict = label;
    } else {
      verdict = 'changes-requested';
      warnings.push(`unknown verdict "${value.verdict as string}"; recorded as "changes-requested"`);
    }
  }

  const findings: ReviewFinding[] = [];
  if (hasFindings) {
    (value.findings as unknown[]).forEach((entry, index) => {
      const finding = salvageFinding(entry, index, warnings);
      if (finding) findings.push(finding);
    });
  }

  return { verdict, findings, warnings };
}

/**
 * Coerce one array entry into a {@link ReviewFinding}, or drop it.
 *
 * DROP rules (the three that make a finding unactionable):
 *   - not an object;
 *   - `severity` outside the closed enum — convergence is computed from it,
 *     so an unknown value has no defined blocking behavior;
 *   - `category` outside the closed enum — same reason the enum is closed:
 *     a critic inventing its own axes is how correct code gets rejected;
 *   - no `file` — the fixing agent has nowhere to go.
 * Everything else is repaired with a warning.
 */
function salvageFinding(entry: unknown, index: number, warnings: string[]): ReviewFinding | null {
  const label = `finding #${index + 1}`;
  if (!isRecord(entry)) {
    warnings.push(`dropped ${label}: not an object`);
    return null;
  }

  const severity = typeof entry.severity === 'string' ? entry.severity.trim().toLowerCase() : '';
  if (!SEVERITIES.includes(severity)) {
    warnings.push(`dropped ${label}: unknown severity "${String(entry.severity ?? '')}"`);
    return null;
  }

  const category = typeof entry.category === 'string' ? entry.category.trim().toLowerCase() : '';
  if (!CATEGORIES.includes(category)) {
    warnings.push(`dropped ${label}: unknown category "${String(entry.category ?? '')}"`);
    return null;
  }

  const file = typeof entry.file === 'string' ? entry.file.trim() : '';
  if (!file) {
    warnings.push(`dropped ${label}: no file`);
    return null;
  }

  const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `F-${index + 1}`;

  const finding: ReviewFinding = {
    id,
    severity: severity as ReviewSeverity,
    category: category as ReviewCategory,
    file,
    summary: asText(entry.summary),
    evidence: asText(entry.evidence),
    fix: asText(entry.fix),
  };

  if (typeof entry.line === 'number' && Number.isInteger(entry.line) && entry.line > 0) {
    finding.line = entry.line;
  }

  const proof = salvageProof(entry.proof, label, warnings);
  if (proof) finding.proof = proof;

  return finding;
}

function salvageProof(
  raw: unknown,
  label: string,
  warnings: string[],
): ReviewFinding['proof'] | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) {
    warnings.push(`${label}: dropped malformed proof`);
    return null;
  }
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!command) {
    // A "proof" with no command proves nothing — and it would be COUNTED as a
    // proved blocker in reviewStats, corrupting the one metric this field
    // exists to feed.
    warnings.push(`${label}: dropped proof with no command`);
    return null;
  }
  const exitCode =
    typeof raw.exitCode === 'number' && Number.isFinite(raw.exitCode) ? raw.exitCode : 1;
  return { command, exitCode, excerpt: asText(raw.excerpt) };
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return String(value);
}

/**
 * Every top-level balanced `{…}` region in `text`, string-aware (so a brace
 * inside a JSON string literal doesn't unbalance the scan).
 */
function balancedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
