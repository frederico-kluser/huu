// Anti-Hallucination Prompt Templates
//
// Centralized templates for L1-L4 verification layers and CoVe.
// All templates enforce: source restriction, uncertainty permission, citation policy.

// ── L1: Source & uncertainty policy blocks ───────────────────────────

export const SOURCE_POLICY = `<source_policy>
Use ONLY information from the provided sources.
Do not use general knowledge outside the supplied sources.
</source_policy>`;

export const UNCERTAINTY_POLICY = `<uncertainty_policy>
If evidence is insufficient, respond explicitly:
"I do not have sufficient information in the provided sources."
Do NOT fabricate or infer beyond what the evidence supports.
</uncertainty_policy>`;

export const CITATION_POLICY = `<citation_policy>
Every factual claim must reference evidence (quote + source).
Without evidence, do not make the claim.
</citation_policy>`;

export function buildL1PromptBlocks(allowedSources?: string[]): string {
  const sourceList = allowedSources?.length
    ? `\nAllowed sources: ${allowedSources.join(', ')}`
    : '';

  return [
    SOURCE_POLICY + sourceList,
    UNCERTAINTY_POLICY,
    CITATION_POLICY,
  ].join('\n\n');
}

// ── L2: Quote-first template ────────────────────────────────────────

export const QUOTE_FIRST_SYSTEM = `<quote_first_protocol>
You must follow a two-step process:

Step 1: Extract verbatim quotes relevant to the question.
Step 2: Answer using ONLY those quotes.

If no quote supports the answer, set no_evidence to true and respond:
"No evidence found in the provided sources."

Output format (JSON):
{
  "quotes": [
    { "text": "verbatim quote here", "source": "file.md#L120-L130" }
  ],
  "answer": "your answer based only on the quotes above",
  "no_evidence": false
}
</quote_first_protocol>`;

export function buildL2Prompt(documentContext: string, question: string): string {
  return `${QUOTE_FIRST_SYSTEM}

<document_context>
${documentContext}
</document_context>

<question>
${question}
</question>

Extract relevant quotes first, then answer based only on those quotes.`;
}

// ── L3: Evaluator (reviewer) template ───────────────────────────────

export const EVALUATOR_SYSTEM = `<role>
You are a verification evaluator. Your job is to assess whether an agent's output
meets the task requirements and is supported by evidence.
</role>

<evaluation_criteria>
1. Requirement adherence: Does the output fulfill all task requirements?
2. Evidence support: Are factual claims backed by evidence or code?
3. Completeness: Are there gaps or missing elements?
4. Consistency: Is the output internally consistent?
</evaluation_criteria>

<output_format>
Respond with a structured verdict (JSON):
{
  "verdict": "PASS" | "FAIL_RETRYABLE" | "FAIL_HARD",
  "feedback": ["specific, actionable feedback items"],
  "missingEvidence": ["claims without evidence support"],
  "requirementMismatches": ["requirements not met or incorrectly addressed"]
}

Rules:
- PASS: Output meets requirements and claims are supported.
- FAIL_RETRYABLE: Issues can be fixed with specific feedback.
- FAIL_HARD: Fundamental problems that cannot be fixed by revision.
</output_format>`;

export function buildL3EvalPrompt(
  output: string,
  requirements: string,
  evidence?: string,
): string {
  const evidenceBlock = evidence
    ? `\n<evidence>\n${evidence}\n</evidence>`
    : '';

  return `${EVALUATOR_SYSTEM}

<task_requirements>
${requirements}
</task_requirements>
${evidenceBlock}
<agent_output>
${output}
</agent_output>

Evaluate the agent output against the requirements and evidence. Return your structured verdict.`;
}

// ── L4: Test gate (no prompt — deterministic) ───────────────────────
// L4 uses shell execution, not an LLM prompt. See verification.ts.

// ── CoVe: Chain-of-Verification templates ───────────────────────────

export const COVE_PLAN_QUESTIONS_SYSTEM = `<role>
You are a verification planner. Given a draft output, identify factual claims
that need independent verification.
</role>

<instructions>
For each significant factual claim in the draft:
1. Identify the claim.
2. Formulate a verification question that can be answered independently.

Output format (JSON):
{
  "questions": [
    { "claim": "the specific claim from the draft", "question": "verification question" }
  ]
}

Focus on claims that are:
- Factual assertions (not opinions or preferences)
- Critical to correctness
- Potentially hallucinated or unsupported
</instructions>`;

export function buildCoVePlanPrompt(draft: string): string {
  return `${COVE_PLAN_QUESTIONS_SYSTEM}

<draft>
${draft}
</draft>

Identify factual claims and generate verification questions.`;
}

export const COVE_INDEPENDENT_ANSWER_SYSTEM = `<role>
You are an independent fact-checker. Answer the verification question using ONLY
the provided sources. Do NOT reference or consider any draft output.
</role>

<instructions>
- Answer based solely on the provided sources.
- If the sources do not contain sufficient information, state: "Cannot verify from available sources."
- Include evidence references for your answer.

Output format (JSON):
{
  "answer": "your answer based on sources",
  "supported": true|false,
  "evidence": ["source references supporting your answer"]
}
</instructions>`;

export function buildCoVeAnswerPrompt(
  question: string,
  sources: string,
): string {
  return `${COVE_INDEPENDENT_ANSWER_SYSTEM}

<sources>
${sources}
</sources>

<question>
${question}
</question>

Answer this question using only the provided sources.`;
}

export const COVE_REVISE_SYSTEM = `<role>
You are a draft reviser. Update the draft based on independent verification results.
</role>

<instructions>
- For each verified answer, check if the draft's corresponding claim matches.
- If a claim is unsupported, remove or correct it.
- If a claim contradicts the verification, fix it.
- Preserve claims that are confirmed by verification.
- Mark any claim that remains unsupported as [UNSUPPORTED].
</instructions>`;

export function buildCoVeRevisePrompt(
  draft: string,
  verifiedAnswers: Array<{ question: string; answer: string; supported: boolean }>,
): string {
  const answersBlock = verifiedAnswers
    .map(
      (va, i) =>
        `${i + 1}. Question: ${va.question}\n   Answer: ${va.answer}\n   Supported: ${va.supported}`,
    )
    .join('\n\n');

  return `${COVE_REVISE_SYSTEM}

<draft>
${draft}
</draft>

<verification_results>
${answersBlock}
</verification_results>

Revise the draft based on the verification results. Return the corrected version.`;
}
