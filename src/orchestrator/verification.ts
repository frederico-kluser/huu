// Anti-Hallucination Verification Pipeline (L1-L4)
//
// 4-layer defense applied to agent output:
//   L1: Prompt policy check (source restriction, uncertainty, citations)
//   L2: Quote-first for document-heavy tasks
//   L3: Reviewer evaluator-optimizer loop (max 3 iterations)
//   L4: Automated test gate (deterministic)
//
// After L1-L4, CoVe runs selectively for critical outputs (see cove.ts).
//
// Short-circuit rules:
//   - Non-retryable fail in any layer → reject output
//   - Retryable fail → return for new builder cycle with structured feedback
//   - CoVe fail on critical output → requiresHumanReview = true

import type {
  VerificationInput,
  VerificationResult,
  VerificationDecision,
  VerificationFinding,
  ReviewerVerdict,
  TestGateResult,
} from './verification-types.js';
import { runCoVe } from './cove.js';
import type { CoVeExecutor } from './cove.js';

// ── L1: Prompt policy validation ────────────────────────────────────

/** Prohibited phrases that indicate certainty without evidence */
const PROHIBITED_CERTAINTY_PHRASES = [
  'it is certain that',
  'there is no doubt',
  'it is guaranteed',
  'definitely',
  'without question',
  'undoubtedly',
  'absolutely certain',
];

/** Check if output respects L1 prompt policies */
export function verifyL1(output: string, allowedSources?: string[]): VerificationResult {
  const findings: VerificationFinding[] = [];
  const lower = output.toLowerCase();

  // Check for prohibited certainty phrases without evidence
  for (const phrase of PROHIBITED_CERTAINTY_PHRASES) {
    if (lower.includes(phrase)) {
      findings.push({
        code: 'PROHIBITED_CERTAINTY',
        message: `Output contains prohibited certainty phrase: "${phrase}"`,
        evidence: [phrase],
      });
    }
  }

  // Check for citation presence (heuristic: look for source references)
  const hasCitations = /\[.*?\]|source:|ref:|cite:|evidence:|quote:/i.test(output);
  const hasFactualClaims = output.length > 200; // Non-trivial output likely has claims

  if (hasFactualClaims && !hasCitations) {
    findings.push({
      code: 'MISSING_CITATION',
      message: 'Output contains substantial content but no citations or evidence references',
    });
  }

  // Check for out-of-scope source mentions (if allowed sources are specified)
  if (allowedSources && allowedSources.length > 0) {
    // This is a lightweight heuristic check — not a full source audit
    const mentionsExternalSource = /according to (my|general) knowledge|as everyone knows|commonly known/i.test(output);
    if (mentionsExternalSource) {
      findings.push({
        code: 'OUT_OF_SCOPE_SOURCE',
        message: 'Output references general knowledge instead of allowed sources',
      });
    }
  }

  // Check for abstention when appropriate (absence of evidence acknowledgement)
  const hasAbstention = /not enough information|cannot determine|insufficient evidence|no information available|do not have sufficient/i.test(output);
  const isShortOutput = output.trim().length < 50;

  // Determine status
  const hasHardFail = findings.some((f) => f.code === 'OUT_OF_SCOPE_SOURCE');
  const hasRetryable = findings.length > 0 && !hasHardFail;

  return {
    layer: 'L1',
    status: hasHardFail ? 'fail' : hasRetryable ? 'retryable_fail' : 'pass',
    findings,
    metadata: {
      hasCitations,
      hasAbstention,
      isShortOutput,
      findingCount: findings.length,
    },
  };
}

// ── L2: Quote-first validation ──────────────────────────────────────

/** Validate that document-heavy output follows quote-first pattern */
export function verifyL2(output: string, documentHeavy: boolean): VerificationResult {
  if (!documentHeavy) {
    return {
      layer: 'L2',
      status: 'not_applicable',
      findings: [],
      metadata: { skipped: true, reason: 'not_document_heavy' },
    };
  }

  const findings: VerificationFinding[] = [];

  // Check for quote block presence
  const hasQuoteBlock = /[""].*?[""]|"quotes"|```[\s\S]*?```|> .*\n/m.test(output);
  const hasSourceRef = /source[:\s]|#L\d+|line \d+|file[:\s]/i.test(output);

  if (!hasQuoteBlock) {
    findings.push({
      code: 'MISSING_QUOTE_BLOCK',
      message: 'Document-heavy task output lacks verbatim quote block',
    });
  }

  if (!hasSourceRef && hasQuoteBlock) {
    findings.push({
      code: 'MISSING_CITATION',
      message: 'Quotes present but missing source references',
    });
  }

  // Check for NO_EVIDENCE acknowledgement
  const hasNoEvidenceFlag = /no_evidence|NO_EVIDENCE|no evidence found/i.test(output);
  if (!hasQuoteBlock && !hasNoEvidenceFlag) {
    findings.push({
      code: 'NO_EVIDENCE',
      message: 'No quotes and no explicit NO_EVIDENCE acknowledgement',
    });
  }

  const hasHardFail = findings.some((f) => f.code === 'NO_EVIDENCE');

  return {
    layer: 'L2',
    status: hasHardFail ? 'fail' : findings.length > 0 ? 'retryable_fail' : 'pass',
    findings,
    metadata: {
      hasQuoteBlock,
      hasSourceRef,
      hasNoEvidenceFlag,
      findingCount: findings.length,
    },
  };
}

// ── L3: Reviewer evaluator-optimizer loop ───────────────────────────

/** Type for L3 evaluation function (injected for testability) */
export type L3Evaluator = (
  output: string,
  requirements: string,
) => Promise<ReviewerVerdict>;

/** Type for L3 revision function (injected for testability) */
export type L3Reviser = (
  output: string,
  feedback: string[],
) => Promise<string>;

const MAX_L3_ITERATIONS = 3;

export async function verifyL3(
  output: string,
  requirements: string,
  evaluator: L3Evaluator,
  reviser: L3Reviser,
): Promise<{ result: VerificationResult; revisedOutput: string }> {
  let candidate = output;
  let attempt = 0;
  let lastVerdict: ReviewerVerdict | null = null;
  const allFeedback: string[] = [];

  while (attempt < MAX_L3_ITERATIONS) {
    const verdict = await evaluator(candidate, requirements);
    lastVerdict = verdict;

    if (verdict.verdict === 'PASS') {
      return {
        result: {
          layer: 'L3',
          status: 'pass',
          findings: [],
          metadata: {
            iterations: attempt + 1,
            passedOnAttempt: attempt + 1,
          },
        },
        revisedOutput: candidate,
      };
    }

    if (verdict.verdict === 'FAIL_HARD') {
      const findings: VerificationFinding[] = [];
      if (verdict.requirementMismatches.length > 0) {
        findings.push({
          code: 'REQUIREMENT_MISMATCH',
          message: verdict.requirementMismatches.join('; '),
          evidence: verdict.missingEvidence,
        });
      }
      if (verdict.missingEvidence.length > 0) {
        findings.push({
          code: 'UNSUPPORTED_CLAIM',
          message: `Missing evidence: ${verdict.missingEvidence.join('; ')}`,
        });
      }
      if (findings.length === 0) {
        findings.push({
          code: 'REQUIREMENT_MISMATCH',
          message: verdict.feedback.join('; '),
        });
      }

      return {
        result: {
          layer: 'L3',
          status: 'fail',
          findings,
          metadata: {
            iterations: attempt + 1,
            failType: 'FAIL_HARD',
          },
        },
        revisedOutput: candidate,
      };
    }

    // FAIL_RETRYABLE → revise and try again
    allFeedback.push(...verdict.feedback);
    candidate = await reviser(candidate, verdict.feedback);
    attempt += 1;
  }

  // Max iterations reached without PASS
  const findings: VerificationFinding[] = [];
  if (lastVerdict) {
    if (lastVerdict.requirementMismatches.length > 0) {
      findings.push({
        code: 'REQUIREMENT_MISMATCH',
        message: `After ${MAX_L3_ITERATIONS} iterations: ${lastVerdict.requirementMismatches.join('; ')}`,
      });
    }
    if (lastVerdict.missingEvidence.length > 0) {
      findings.push({
        code: 'UNSUPPORTED_CLAIM',
        message: `After ${MAX_L3_ITERATIONS} iterations: ${lastVerdict.missingEvidence.join('; ')}`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      code: 'REQUIREMENT_MISMATCH',
      message: `L3 did not pass after ${MAX_L3_ITERATIONS} iterations`,
      evidence: allFeedback,
    });
  }

  return {
    result: {
      layer: 'L3',
      status: 'retryable_fail',
      findings,
      metadata: {
        iterations: MAX_L3_ITERATIONS,
        failType: 'MAX_ITERATIONS',
        accumulatedFeedback: allFeedback.join(' | '),
      },
    },
    revisedOutput: candidate,
  };
}

// ── L4: Automated test gate ─────────────────────────────────────────

/** Type for test runner (injected for testability) */
export type TestRunner = (
  workDir: string,
  command: string,
) => Promise<TestGateResult>;

export function verifyL4FromResult(testResult: TestGateResult): VerificationResult {
  if (testResult.status === 'not_applicable') {
    return {
      layer: 'L4',
      status: 'not_applicable',
      findings: [],
      metadata: {
        command: testResult.command,
        reason: testResult.summary,
      },
    };
  }

  if (testResult.status === 'pass') {
    return {
      layer: 'L4',
      status: 'pass',
      findings: [],
      metadata: {
        command: testResult.command,
        exitCode: testResult.exitCode ?? 0,
        summary: testResult.summary,
      },
    };
  }

  return {
    layer: 'L4',
    status: 'fail',
    findings: [
      {
        code: 'TEST_FAILURE',
        message: testResult.summary,
        evidence: [
          `Command: ${testResult.command}`,
          `Exit code: ${testResult.exitCode ?? 'unknown'}`,
        ],
      },
    ],
    metadata: {
      command: testResult.command,
      exitCode: testResult.exitCode ?? -1,
      summary: testResult.summary,
    },
  };
}

export async function verifyL4(
  codeTask: boolean,
  workDir: string | undefined,
  testCommand: string | undefined,
  runner: TestRunner,
): Promise<VerificationResult> {
  if (!codeTask) {
    return verifyL4FromResult({
      status: 'not_applicable',
      command: 'none',
      summary: 'Not a code task — test gate skipped',
    });
  }

  if (!workDir) {
    return verifyL4FromResult({
      status: 'not_applicable',
      command: 'none',
      summary: 'No working directory available — test gate skipped',
    });
  }

  const command = testCommand ?? 'npm test';
  const result = await runner(workDir, command);
  return verifyL4FromResult(result);
}

// ── Pipeline orchestration ──────────────────────────────────────────

export interface VerificationDeps {
  l3Evaluator: L3Evaluator;
  l3Reviser: L3Reviser;
  testRunner: TestRunner;
  coveExecutor?: CoVeExecutor;
}

export async function runVerificationPipeline(
  input: VerificationInput,
  deps: VerificationDeps,
): Promise<VerificationDecision> {
  const results: VerificationResult[] = [];
  let currentOutput = input.output;

  // ── L1: Prompt policy check ─────────────────────────────────────
  const l1 = verifyL1(currentOutput, input.allowedSources);
  results.push(l1);

  if (l1.status === 'fail') {
    return {
      accepted: false,
      requiresHumanReview: false,
      requiresRetry: false,
      results,
    };
  }

  // ── L2: Quote-first (document-heavy only) ───────────────────────
  const l2 = verifyL2(currentOutput, input.documentHeavy);
  results.push(l2);

  if (l2.status === 'fail') {
    return {
      accepted: false,
      requiresHumanReview: false,
      requiresRetry: false,
      results,
    };
  }

  // ── L3: Reviewer evaluator-optimizer ────────────────────────────
  const { result: l3, revisedOutput } = await verifyL3(
    currentOutput,
    input.taskPrompt,
    deps.l3Evaluator,
    deps.l3Reviser,
  );
  results.push(l3);
  currentOutput = revisedOutput;

  if (l3.status === 'fail') {
    return {
      accepted: false,
      requiresHumanReview: false,
      requiresRetry: false,
      results,
    };
  }

  if (l3.status === 'retryable_fail') {
    const retryFeedback = l3.findings.map((f) => f.message);
    return {
      accepted: false,
      requiresHumanReview: false,
      requiresRetry: true,
      results,
      retryFeedback,
    };
  }

  // ── L4: Test gate ───────────────────────────────────────────────
  const l4 = await verifyL4(
    input.codeTask,
    input.workDir,
    input.testCommand,
    deps.testRunner,
  );
  results.push(l4);

  if (l4.status === 'fail') {
    return {
      accepted: false,
      requiresHumanReview: false,
      requiresRetry: true,
      results,
      retryFeedback: l4.findings.map((f) => f.message),
    };
  }

  // ── CoVe: Chain-of-Verification (critical outputs only) ────────
  if (input.criticality.critical && deps.coveExecutor) {
    const coveResult = await runCoVe(
      currentOutput,
      input.allowedSources?.join('\n') ?? '',
      deps.coveExecutor,
    );

    const coveFindings: VerificationFinding[] = coveResult.unsupportedClaims.map(
      (claim) => ({
        code: 'UNSUPPORTED_CLAIM' as const,
        message: `Unsupported critical claim: ${claim}`,
      }),
    );

    const coveVerification: VerificationResult = {
      layer: 'COVE',
      status: coveResult.unsupportedClaims.length > 0 ? 'fail' : 'pass',
      findings: coveFindings,
      metadata: {
        questionsGenerated: coveResult.questions.length,
        answersVerified: coveResult.verifiedAnswers.length,
        unsupportedCount: coveResult.unsupportedClaims.length,
        revised: coveResult.revised !== coveResult.draft,
      },
    };

    results.push(coveVerification);

    if (coveResult.unsupportedClaims.length > 0) {
      return {
        accepted: false,
        requiresHumanReview: true,
        requiresRetry: false,
        results,
      };
    }
  }

  // ── All layers passed ───────────────────────────────────────────
  const hasRetryable = results.some((r) => r.status === 'retryable_fail');

  if (hasRetryable) {
    return {
      accepted: false,
      requiresHumanReview: false,
      requiresRetry: true,
      results,
      retryFeedback: results
        .filter((r) => r.status === 'retryable_fail')
        .flatMap((r) => r.findings.map((f) => f.message)),
    };
  }

  return {
    accepted: true,
    requiresHumanReview: false,
    requiresRetry: false,
    results,
  };
}
