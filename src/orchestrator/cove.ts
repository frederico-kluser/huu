// Chain-of-Verification (CoVe) — selective verification for critical outputs
//
// 4-step process:
//   1. Generate draft (already done by builder)
//   2. Plan verification questions per claim
//   3. Answer questions INDEPENDENTLY (no access to draft)
//   4. Revise draft based on verified answers
//
// Key invariant: Step 3 is truly independent — the prompt/context for each
// answer does NOT include the original draft.

import type {
  CoVeQuestion,
  CoVeAnswer,
  CoVeResult,
} from './verification-types.js';

// ── Executor interface (injected for testability) ───────────────────

export interface CoVeExecutor {
  /** Step 2: generate verification questions from draft */
  planQuestions(draft: string): Promise<CoVeQuestion[]>;
  /** Step 3: answer a question independently using only sources */
  answerIndependently(question: string, sources: string): Promise<CoVeAnswer>;
  /** Step 4: revise draft based on verified answers */
  revise(draft: string, verifiedAnswers: CoVeAnswer[]): Promise<string>;
}

// ── CoVe runner ─────────────────────────────────────────────────────

export async function runCoVe(
  draft: string,
  sources: string,
  executor: CoVeExecutor,
): Promise<CoVeResult> {
  // Step 2: Plan verification questions
  const questions = await executor.planQuestions(draft);

  // Step 3: Answer each question independently (parallel, no draft context)
  const verifiedAnswers = await Promise.all(
    questions.map((q) => executor.answerIndependently(q.question, sources)),
  );

  // Step 4: Revise draft with verification results
  const revised = await executor.revise(draft, verifiedAnswers);

  // Collect unsupported claims
  const unsupportedClaims = verifiedAnswers
    .filter((a) => !a.supported)
    .map((a) => a.question);

  return {
    draft,
    questions,
    verifiedAnswers,
    revised,
    unsupportedClaims,
  };
}
