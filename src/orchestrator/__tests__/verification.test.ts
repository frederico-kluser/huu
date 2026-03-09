import { describe, it, expect, vi } from 'vitest';
import {
  verifyL1,
  verifyL2,
  verifyL3,
  verifyL4,
  verifyL4FromResult,
  runVerificationPipeline,
} from '../verification.js';
import type {
  ReviewerVerdict,
  TestGateResult,
  VerificationInput,
} from '../verification-types.js';
import type { L3Evaluator, L3Reviser, TestRunner, VerificationDeps } from '../verification.js';

// ── L1 tests ────────────────────────────────────────────────────────

describe('verifyL1', () => {
  it('passes clean output with citations', () => {
    const output = 'According to [source: readme.md], the system uses TypeScript. Evidence: the config file shows strict mode.';
    const result = verifyL1(output);
    expect(result.status).toBe('pass');
    expect(result.findings).toHaveLength(0);
  });

  it('flags prohibited certainty phrases', () => {
    const output = 'It is certain that this approach will work. There is no doubt about the outcome.';
    const result = verifyL1(output);
    expect(result.findings.some((f) => f.code === 'PROHIBITED_CERTAINTY')).toBe(true);
  });

  it('flags missing citations in substantial output', () => {
    const output = 'A'.repeat(300); // Long output with no citations
    const result = verifyL1(output);
    expect(result.findings.some((f) => f.code === 'MISSING_CITATION')).toBe(true);
  });

  it('passes short output without citations', () => {
    const output = 'Done.';
    const result = verifyL1(output);
    expect(result.status).toBe('pass');
  });

  it('flags out-of-scope source references', () => {
    const output = 'According to my knowledge, this is how it works. Source: built-in understanding.';
    const result = verifyL1(output, ['readme.md']);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'OUT_OF_SCOPE_SOURCE')).toBe(true);
  });

  it('returns retryable_fail for non-hard findings', () => {
    const output = 'It is certain that ' + 'x'.repeat(200);
    const result = verifyL1(output);
    // Has PROHIBITED_CERTAINTY and MISSING_CITATION but no OUT_OF_SCOPE_SOURCE
    expect(result.status).toBe('retryable_fail');
  });
});

// ── L2 tests ────────────────────────────────────────────────────────

describe('verifyL2', () => {
  it('returns not_applicable for non-document-heavy tasks', () => {
    const result = verifyL2('any output', false);
    expect(result.status).toBe('not_applicable');
  });

  it('passes when quote block and source references present', () => {
    const output = `"The system uses TypeScript" (source: readme.md#L5-L10)\n\nBased on the above quote, TypeScript is the language.`;
    const result = verifyL2(output, true);
    expect(result.status).toBe('pass');
  });

  it('flags missing quote block in document-heavy task', () => {
    const output = 'The system uses TypeScript for everything. It also uses React.';
    const result = verifyL2(output, true);
    expect(result.findings.some((f) => f.code === 'MISSING_QUOTE_BLOCK')).toBe(true);
  });

  it('passes with NO_EVIDENCE acknowledgement', () => {
    const output = 'NO_EVIDENCE - no relevant quotes found in the provided documents.';
    const result = verifyL2(output, true);
    // Has MISSING_QUOTE_BLOCK but also has NO_EVIDENCE flag, so no NO_EVIDENCE finding
    expect(result.findings.some((f) => f.code === 'NO_EVIDENCE')).toBe(false);
  });
});

// ── L3 tests ────────────────────────────────────────────────────────

describe('verifyL3', () => {
  it('passes on first attempt with PASS verdict', async () => {
    const evaluator: L3Evaluator = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      feedback: [],
      missingEvidence: [],
      requirementMismatches: [],
    } satisfies ReviewerVerdict);

    const reviser: L3Reviser = vi.fn();

    const { result, revisedOutput } = await verifyL3('output', 'requirements', evaluator, reviser);
    expect(result.status).toBe('pass');
    expect(result.metadata.iterations).toBe(1);
    expect(revisedOutput).toBe('output');
    expect(reviser).not.toHaveBeenCalled();
  });

  it('rejects immediately on FAIL_HARD', async () => {
    const evaluator: L3Evaluator = vi.fn().mockResolvedValue({
      verdict: 'FAIL_HARD',
      feedback: ['Fundamental problem'],
      missingEvidence: ['Key evidence missing'],
      requirementMismatches: ['Requirement A not met'],
    } satisfies ReviewerVerdict);

    const reviser: L3Reviser = vi.fn();

    const { result } = await verifyL3('output', 'requirements', evaluator, reviser);
    expect(result.status).toBe('fail');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(reviser).not.toHaveBeenCalled();
  });

  it('retries on FAIL_RETRYABLE and passes on second attempt', async () => {
    const evaluator: L3Evaluator = vi
      .fn()
      .mockResolvedValueOnce({
        verdict: 'FAIL_RETRYABLE',
        feedback: ['Fix issue A'],
        missingEvidence: [],
        requirementMismatches: [],
      } satisfies ReviewerVerdict)
      .mockResolvedValueOnce({
        verdict: 'PASS',
        feedback: [],
        missingEvidence: [],
        requirementMismatches: [],
      } satisfies ReviewerVerdict);

    const reviser: L3Reviser = vi.fn().mockResolvedValue('revised output');

    const { result, revisedOutput } = await verifyL3('output', 'requirements', evaluator, reviser);
    expect(result.status).toBe('pass');
    expect(result.metadata.iterations).toBe(2);
    expect(revisedOutput).toBe('revised output');
    expect(reviser).toHaveBeenCalledTimes(1);
  });

  it('fails with retryable_fail after max iterations', async () => {
    const evaluator: L3Evaluator = vi.fn().mockResolvedValue({
      verdict: 'FAIL_RETRYABLE',
      feedback: ['Still not fixed'],
      missingEvidence: ['Evidence X'],
      requirementMismatches: ['Req Y'],
    } satisfies ReviewerVerdict);

    const reviser: L3Reviser = vi.fn().mockImplementation(async (output) => output + ' revised');

    const { result } = await verifyL3('output', 'requirements', evaluator, reviser);
    expect(result.status).toBe('retryable_fail');
    expect(result.metadata.iterations).toBe(3);
    expect(evaluator).toHaveBeenCalledTimes(3);
    expect(reviser).toHaveBeenCalledTimes(3);
  });
});

// ── L4 tests ────────────────────────────────────────────────────────

describe('verifyL4FromResult', () => {
  it('returns not_applicable when tests are not applicable', () => {
    const result = verifyL4FromResult({
      status: 'not_applicable',
      command: 'none',
      summary: 'No code task',
    });
    expect(result.status).toBe('not_applicable');
  });

  it('returns pass on successful tests', () => {
    const result = verifyL4FromResult({
      status: 'pass',
      command: 'npm test',
      exitCode: 0,
      summary: '42 tests passed',
    });
    expect(result.status).toBe('pass');
  });

  it('returns fail on test failure', () => {
    const result = verifyL4FromResult({
      status: 'fail',
      command: 'npm test',
      exitCode: 1,
      summary: '3 tests failed',
    });
    expect(result.status).toBe('fail');
    expect(result.findings[0].code).toBe('TEST_FAILURE');
  });
});

describe('verifyL4', () => {
  it('skips for non-code tasks', async () => {
    const runner: TestRunner = vi.fn();
    const result = await verifyL4(false, '/tmp', 'npm test', runner);
    expect(result.status).toBe('not_applicable');
    expect(runner).not.toHaveBeenCalled();
  });

  it('skips when no workDir', async () => {
    const runner: TestRunner = vi.fn();
    const result = await verifyL4(true, undefined, 'npm test', runner);
    expect(result.status).toBe('not_applicable');
    expect(runner).not.toHaveBeenCalled();
  });

  it('calls runner for code tasks with workDir', async () => {
    const runner: TestRunner = vi.fn().mockResolvedValue({
      status: 'pass',
      command: 'npm test',
      exitCode: 0,
      summary: 'All tests pass',
    } satisfies TestGateResult);

    const result = await verifyL4(true, '/tmp/worktree', undefined, runner);
    expect(result.status).toBe('pass');
    expect(runner).toHaveBeenCalledWith('/tmp/worktree', 'npm test');
  });
});

// ── Full pipeline tests ─────────────────────────────────────────────

describe('runVerificationPipeline', () => {
  function makeDeps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
    return {
      l3Evaluator: vi.fn().mockResolvedValue({
        verdict: 'PASS',
        feedback: [],
        missingEvidence: [],
        requirementMismatches: [],
      }),
      l3Reviser: vi.fn().mockResolvedValue('revised'),
      testRunner: vi.fn().mockResolvedValue({
        status: 'pass',
        command: 'npm test',
        exitCode: 0,
        summary: 'All tests pass',
      }),
      ...overrides,
    };
  }

  function makeInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
    return {
      output: 'The result is based on [source: data.json]. Evidence: line 42 shows the value.',
      taskPrompt: 'Implement the feature',
      documentHeavy: false,
      codeTask: false,
      criticality: { critical: false, criticalReasons: [] },
      ...overrides,
    };
  }

  it('accepts output that passes all layers', async () => {
    const decision = await runVerificationPipeline(makeInput(), makeDeps());
    expect(decision.accepted).toBe(true);
    expect(decision.requiresHumanReview).toBe(false);
    expect(decision.results.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects when L1 fails hard', async () => {
    const input = makeInput({
      output: 'According to my knowledge, this is definitely correct. Source: common understanding.',
      allowedSources: ['readme.md'],
    });
    const decision = await runVerificationPipeline(input, makeDeps());
    expect(decision.accepted).toBe(false);
    // Should stop at L1
    expect(decision.results).toHaveLength(1);
    expect(decision.results[0].layer).toBe('L1');
  });

  it('runs L4 for code tasks', async () => {
    const input = makeInput({
      codeTask: true,
      workDir: '/tmp/worktree',
    });
    const decision = await runVerificationPipeline(input, makeDeps());
    expect(decision.accepted).toBe(true);
    expect(decision.results.some((r) => r.layer === 'L4')).toBe(true);
  });

  it('runs CoVe for critical outputs', async () => {
    const coveExecutor = {
      planQuestions: vi.fn().mockResolvedValue([
        { claim: 'The sky is blue', question: 'Is the sky blue?' },
      ]),
      answerIndependently: vi.fn().mockResolvedValue({
        question: 'Is the sky blue?',
        answer: 'Yes',
        supported: true,
        evidence: ['source A'],
      }),
      revise: vi.fn().mockResolvedValue('revised draft'),
    };

    const input = makeInput({
      criticality: { critical: true, criticalReasons: ['TOUCHES_AUTH_SECURITY'] },
    });

    const decision = await runVerificationPipeline(input, makeDeps({ coveExecutor }));
    expect(decision.accepted).toBe(true);
    expect(decision.results.some((r) => r.layer === 'COVE')).toBe(true);
  });

  it('requires human review when CoVe finds unsupported claims', async () => {
    const coveExecutor = {
      planQuestions: vi.fn().mockResolvedValue([
        { claim: 'Unverified claim', question: 'Is this true?' },
      ]),
      answerIndependently: vi.fn().mockResolvedValue({
        question: 'Is this true?',
        answer: 'Cannot verify',
        supported: false,
      }),
      revise: vi.fn().mockResolvedValue('revised draft with [UNSUPPORTED]'),
    };

    const input = makeInput({
      criticality: { critical: true, criticalReasons: ['TOUCHES_AUTH_SECURITY'] },
    });

    const decision = await runVerificationPipeline(input, makeDeps({ coveExecutor }));
    expect(decision.accepted).toBe(false);
    expect(decision.requiresHumanReview).toBe(true);
  });

  it('returns retry feedback on L3 retryable fail', async () => {
    const deps = makeDeps({
      l3Evaluator: vi.fn().mockResolvedValue({
        verdict: 'FAIL_RETRYABLE',
        feedback: ['Fix issue X'],
        missingEvidence: [],
        requirementMismatches: ['Requirement not met'],
      }),
      l3Reviser: vi.fn().mockResolvedValue('still broken'),
    });

    const decision = await runVerificationPipeline(makeInput(), deps);
    expect(decision.accepted).toBe(false);
    expect(decision.requiresRetry).toBe(true);
    expect(decision.retryFeedback).toBeDefined();
    expect(decision.retryFeedback!.length).toBeGreaterThan(0);
  });

  it('returns retry feedback on L4 test failure', async () => {
    const deps = makeDeps({
      testRunner: vi.fn().mockResolvedValue({
        status: 'fail',
        command: 'npm test',
        exitCode: 1,
        summary: '3 tests failed',
      }),
    });

    const input = makeInput({ codeTask: true, workDir: '/tmp' });
    const decision = await runVerificationPipeline(input, deps);
    expect(decision.accepted).toBe(false);
    expect(decision.requiresRetry).toBe(true);
  });
});
