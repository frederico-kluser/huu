import { describe, it, expect, vi } from 'vitest';
import { runCoVe } from '../cove.js';
import type { CoVeExecutor } from '../cove.js';
import type { CoVeQuestion, CoVeAnswer } from '../verification-types.js';

function makeExecutor(overrides: Partial<CoVeExecutor> = {}): CoVeExecutor {
  return {
    planQuestions: vi.fn().mockResolvedValue([
      { claim: 'TypeScript is used', question: 'Does the project use TypeScript?' },
      { claim: 'React is the UI library', question: 'Is React used for the UI?' },
    ] satisfies CoVeQuestion[]),
    answerIndependently: vi.fn().mockResolvedValue({
      question: 'test',
      answer: 'Yes, confirmed',
      supported: true,
      evidence: ['package.json'],
    } satisfies CoVeAnswer),
    revise: vi.fn().mockResolvedValue('revised draft'),
    ...overrides,
  };
}

describe('runCoVe', () => {
  it('executes 4-step verification pipeline', async () => {
    const executor = makeExecutor();
    const result = await runCoVe('draft output', 'source content', executor);

    expect(executor.planQuestions).toHaveBeenCalledWith('draft output');
    expect(executor.answerIndependently).toHaveBeenCalledTimes(2);
    expect(executor.revise).toHaveBeenCalledTimes(1);

    expect(result.draft).toBe('draft output');
    expect(result.questions).toHaveLength(2);
    expect(result.verifiedAnswers).toHaveLength(2);
    expect(result.revised).toBe('revised draft');
    expect(result.unsupportedClaims).toHaveLength(0);
  });

  it('collects unsupported claims', async () => {
    const executor = makeExecutor({
      answerIndependently: vi
        .fn()
        .mockResolvedValueOnce({
          question: 'Does the project use TypeScript?',
          answer: 'Yes',
          supported: true,
          evidence: ['tsconfig.json'],
        } satisfies CoVeAnswer)
        .mockResolvedValueOnce({
          question: 'Is React used for the UI?',
          answer: 'Cannot verify',
          supported: false,
        } satisfies CoVeAnswer),
    });

    const result = await runCoVe('draft', 'sources', executor);
    expect(result.unsupportedClaims).toHaveLength(1);
    expect(result.unsupportedClaims[0]).toBe('Is React used for the UI?');
  });

  it('handles empty questions list', async () => {
    const executor = makeExecutor({
      planQuestions: vi.fn().mockResolvedValue([]),
    });

    const result = await runCoVe('draft', 'sources', executor);
    expect(result.questions).toHaveLength(0);
    expect(result.verifiedAnswers).toHaveLength(0);
    expect(result.unsupportedClaims).toHaveLength(0);
    expect(executor.answerIndependently).not.toHaveBeenCalled();
  });

  it('passes sources to independent answers, not the draft', async () => {
    const executor = makeExecutor();
    await runCoVe('the draft content', 'the source content', executor);

    // Verify that answerIndependently receives the question and sources, not the draft
    const calls = (executor.answerIndependently as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of calls) {
      expect(call[1]).toBe('the source content');
      // The first arg is the question, not the draft
      expect(call[0]).not.toBe('the draft content');
    }
  });

  it('passes draft and verified answers to revise step', async () => {
    const executor = makeExecutor();
    await runCoVe('my draft', 'sources', executor);

    const reviseCall = (executor.revise as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(reviseCall[0]).toBe('my draft');
    expect(Array.isArray(reviseCall[1])).toBe(true);
    expect(reviseCall[1]).toHaveLength(2);
  });
});
