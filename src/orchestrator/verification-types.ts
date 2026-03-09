// Anti-Hallucination Pipeline — Type contracts
//
// 4-layer verification (L1-L4) + selective CoVe for critical outputs.
// Principle: verification proportional to risk.

// ── Verification layers ─────────────────────────────────────────────

export type VerificationLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'COVE';

export type VerificationStatus =
  | 'pass'
  | 'fail'
  | 'retryable_fail'
  | 'not_applicable';

// ── Finding codes ───────────────────────────────────────────────────

export const FINDING_CODES = [
  'NO_EVIDENCE',
  'OUT_OF_SCOPE_SOURCE',
  'REQUIREMENT_MISMATCH',
  'TEST_FAILURE',
  'UNSUPPORTED_CLAIM',
  'CRITICAL_POLICY_TRIGGER',
  'MISSING_CITATION',
  'PROHIBITED_CERTAINTY',
  'MISSING_QUOTE_BLOCK',
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

export interface VerificationFinding {
  code: FindingCode;
  message: string;
  evidence?: string[];
}

// ── Per-layer result ────────────────────────────────────────────────

export interface VerificationResult {
  layer: VerificationLayer;
  status: VerificationStatus;
  findings: VerificationFinding[];
  metadata: Record<string, string | number | boolean>;
}

// ── Pipeline decision ───────────────────────────────────────────────

export interface VerificationDecision {
  accepted: boolean;
  requiresHumanReview: boolean;
  requiresRetry: boolean;
  results: VerificationResult[];
  retryFeedback?: string[];
}

// ── L2 quote-first contract ─────────────────────────────────────────

export interface QuoteEntry {
  text: string;
  source: string;
}

export interface QuoteFirstResult {
  quotes: QuoteEntry[];
  answer: string;
  noEvidence: boolean;
}

// ── L3 reviewer verdict ─────────────────────────────────────────────

export interface ReviewerVerdict {
  verdict: 'PASS' | 'FAIL_RETRYABLE' | 'FAIL_HARD';
  feedback: string[];
  missingEvidence: string[];
  requirementMismatches: string[];
}

// ── L4 test gate ────────────────────────────────────────────────────

export interface TestGateResult {
  status: 'pass' | 'fail' | 'not_applicable';
  command: string;
  exitCode?: number;
  summary: string;
}

// ── CoVe types ──────────────────────────────────────────────────────

export interface CoVeQuestion {
  claim: string;
  question: string;
}

export interface CoVeAnswer {
  question: string;
  answer: string;
  supported: boolean;
  evidence?: string[];
}

export interface CoVeResult {
  draft: string;
  questions: CoVeQuestion[];
  verifiedAnswers: CoVeAnswer[];
  revised: string;
  unsupportedClaims: string[];
}

// ── Criticality ─────────────────────────────────────────────────────

export const CRITICAL_REASON_CODES = [
  'TOUCHES_AUTH_SECURITY',
  'ALTERS_INFRA_DEPLOY',
  'MERGE_TIER4_CONFLICT',
  'ALTERS_ARCH_DECISION',
  'COMPLIANCE_LEGAL_RISK',
  'HIGH_RISK_SCORE',
] as const;

export type CriticalReasonCode = (typeof CRITICAL_REASON_CODES)[number];

export interface CriticalityMeta {
  critical: boolean;
  criticalReasons: CriticalReasonCode[];
  riskScore?: number;
}

// ── Self-RAG reflection tags ────────────────────────────────────────

export interface ReflectionTags {
  /** Does the agent need to retrieve additional evidence? */
  RET: boolean;
  /** Is the retrieved evidence relevant? */
  REL: boolean;
  /** Is the claim supported by evidence? */
  SUP: boolean;
  /** Was the evidence useful for the final response? */
  USE: boolean;
}

// ── Verification pipeline input ─────────────────────────────────────

export interface VerificationInput {
  /** The agent's output text */
  output: string;
  /** The original task/requirements */
  taskPrompt: string;
  /** Whether this task involves document-heavy processing */
  documentHeavy: boolean;
  /** Whether this is a code task (enables L4 test gate) */
  codeTask: boolean;
  /** Criticality metadata */
  criticality: CriticalityMeta;
  /** Allowed sources for grounding */
  allowedSources?: string[];
  /** Working directory for test execution */
  workDir?: string;
  /** Test command override */
  testCommand?: string;
  /** Files changed by the agent */
  filesChanged?: string[];
}
