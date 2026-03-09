import { createHash } from 'node:crypto';
import type { SimpleGit } from 'simple-git';
import type { Tier3Signals, Tier3Decision, Side, FileRiskClass } from '../types/index.js';

// ── Tier 3 scoring weights ───────────────────────────────────────────

const WEIGHTS = {
  lastTouch: 0.30,
  ownership: 0.25,
  history: 0.25,
  risk: 0.20,
} as const;

/** Minimum absolute score delta to auto-resolve. */
const DELTA_THRESHOLD = 0.25;

/** Minimum confidence to auto-resolve. */
const CONFIDENCE_THRESHOLD = 0.75;

// ── Risk classification ──────────────────────────────────────────────

const HIGH_RISK_PATTERNS = [
  /\bauth/i,
  /\bsecurity/i,
  /\bmigration/i,
  /\bpayment/i,
  /\bdeploy/i,
  /\binfra/i,
  /\.env(\.|$)/,
  /secrets?\./i,
  /credential/i,
  /\bpassword/i,
  /\btoken/i,
];

const LOW_RISK_PATTERNS = [
  /\.md$/i,
  /\bchangelog/i,
  /\bREADME/i,
  /\bLICENSE/i,
  /\.txt$/i,
  /\.lock$/,
  /generated\//i,
  /\.snap$/,
];

/**
 * Classify a file path's risk class based on filename patterns.
 */
export function classifyFileRisk(filePath: string): FileRiskClass {
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(filePath)) return 'high';
  }
  for (const pattern of LOW_RISK_PATTERNS) {
    if (pattern.test(filePath)) return 'low';
  }
  return 'medium';
}

// ── Tier 3 decision function ─────────────────────────────────────────

/**
 * Deterministic Tier 3 heuristic resolver.
 *
 * Computes a weighted score for ours vs theirs based on:
 * - last touch (who modified the file most recently)
 * - ownership (who has more commits on this file)
 * - history (past resolution success rates)
 * - file risk class
 *
 * Returns 'escalate' if:
 * - File is high risk
 * - Score delta is below threshold
 * - Confidence is below threshold
 */
export function chooseTier3Side(signals: Tier3Signals): Tier3Decision {
  // High-risk files never auto-resolve in Tier 3
  if (signals.riskClass === 'high') {
    return { side: 'escalate', confidence: 0 };
  }

  // Compute last-touch contribution
  const lastTouch = signals.lastTouchSide === 'ours'
    ? { ours: 1, theirs: 0 }
    : signals.lastTouchSide === 'theirs'
      ? { ours: 0, theirs: 1 }
      : { ours: 0.5, theirs: 0.5 };

  // Risk bonus: low risk gets full bonus, medium gets half
  const riskBonus = signals.riskClass === 'low' ? 1.0 : 0.5;

  const oursScore =
    WEIGHTS.lastTouch * lastTouch.ours +
    WEIGHTS.ownership * signals.ownershipScore.ours +
    WEIGHTS.history * signals.historyScore.ours +
    WEIGHTS.risk * riskBonus;

  const theirsScore =
    WEIGHTS.lastTouch * lastTouch.theirs +
    WEIGHTS.ownership * signals.ownershipScore.theirs +
    WEIGHTS.history * signals.historyScore.theirs +
    WEIGHTS.risk * riskBonus;

  const delta = Math.abs(oursScore - theirsScore);
  const confidence = Math.min(1, delta + 0.5);

  if (delta < DELTA_THRESHOLD || confidence < CONFIDENCE_THRESHOLD) {
    return { side: 'escalate', confidence };
  }

  return {
    side: oursScore >= theirsScore ? 'ours' : 'theirs',
    confidence,
  };
}

// ── Git-based signal extraction ──────────────────────────────────────

/**
 * Determine which side (ours or theirs) last touched a file.
 * Compares the commit timestamps of the file on each branch.
 */
export async function getLastTouchSide(
  git: SimpleGit,
  filePath: string,
  oursBranch: string,
  theirsBranch: string,
): Promise<Side | undefined> {
  try {
    const [oursLog, theirsLog] = await Promise.all([
      git.log({ file: filePath, maxCount: 1, from: oursBranch }).catch(() => null),
      git.log({ file: filePath, maxCount: 1, from: theirsBranch }).catch(() => null),
    ]);

    const oursDate = oursLog?.latest?.date ? new Date(oursLog.latest.date).getTime() : 0;
    const theirsDate = theirsLog?.latest?.date ? new Date(theirsLog.latest.date).getTime() : 0;

    if (oursDate === 0 && theirsDate === 0) return undefined;
    return oursDate >= theirsDate ? 'ours' : 'theirs';
  } catch {
    return undefined;
  }
}

/**
 * Compute ownership score for a file based on commit counts.
 * Returns normalized scores (0-1) for each side.
 */
export async function computeOwnershipScore(
  git: SimpleGit,
  filePath: string,
  oursBranch: string,
  theirsBranch: string,
  mergeBase: string,
): Promise<{ ours: number; theirs: number }> {
  try {
    const [oursLog, theirsLog] = await Promise.all([
      git.log({ from: mergeBase, to: oursBranch, file: filePath }).catch(() => null),
      git.log({ from: mergeBase, to: theirsBranch, file: filePath }).catch(() => null),
    ]);

    const oursCommits = oursLog?.total ?? 0;
    const theirsCommits = theirsLog?.total ?? 0;
    const total = oursCommits + theirsCommits;

    if (total === 0) return { ours: 0.5, theirs: 0.5 };

    return {
      ours: oursCommits / total,
      theirs: theirsCommits / total,
    };
  } catch {
    return { ours: 0.5, theirs: 0.5 };
  }
}

// ── Conflict fingerprinting ──────────────────────────────────────────

/**
 * Generate a stable fingerprint for a conflict.
 * Based on file path, conflict type, and normalized content hash.
 */
export function generateConflictFingerprint(
  filePath: string,
  conflictType: string,
  oursContent: string,
  theirsContent: string,
): string {
  const normalized = `${filePath}:${conflictType}:${oursContent.trim()}:${theirsContent.trim()}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Classify the type of git conflict from conflict markers or merge summary.
 */
export function classifyConflictType(conflictLine: string): string {
  const lower = conflictLine.toLowerCase();
  if (lower.includes('rename/delete')) return 'rename-delete';
  if (lower.includes('rename/rename')) return 'rename-rename';
  if (lower.includes('modify/delete')) return 'modify-delete';
  if (lower.includes('add/add')) return 'add-add';
  if (lower.includes('binary')) return 'binary';
  return 'content';
}

// ── Unsupported conflict types for Tier 3 ────────────────────────────

const TIER3_UNSUPPORTED_TYPES = new Set([
  'rename-delete',
  'rename-rename',
  'modify-delete',
  'binary',
]);

/**
 * Check if a conflict type can be handled by Tier 3.
 * Binary, rename/delete, and structurally ambiguous conflicts bypass Tier 3.
 */
export function isTier3Supported(conflictType: string): boolean {
  return !TIER3_UNSUPPORTED_TYPES.has(conflictType);
}
