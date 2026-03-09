import { describe, it, expect } from 'vitest';
import {
  SOURCE_POLICY,
  UNCERTAINTY_POLICY,
  CITATION_POLICY,
  buildL1PromptBlocks,
  buildL2Prompt,
  buildL3EvalPrompt,
  buildCoVePlanPrompt,
  buildCoVeAnswerPrompt,
  buildCoVeRevisePrompt,
  QUOTE_FIRST_SYSTEM,
  EVALUATOR_SYSTEM,
  COVE_PLAN_QUESTIONS_SYSTEM,
  COVE_INDEPENDENT_ANSWER_SYSTEM,
  COVE_REVISE_SYSTEM,
} from '../index.js';

describe('L1 prompt blocks', () => {
  it('exports source, uncertainty, and citation policies', () => {
    expect(SOURCE_POLICY).toContain('source_policy');
    expect(UNCERTAINTY_POLICY).toContain('uncertainty_policy');
    expect(CITATION_POLICY).toContain('citation_policy');
  });

  it('buildL1PromptBlocks includes all three policies', () => {
    const blocks = buildL1PromptBlocks();
    expect(blocks).toContain('source_policy');
    expect(blocks).toContain('uncertainty_policy');
    expect(blocks).toContain('citation_policy');
  });

  it('buildL1PromptBlocks appends allowed sources', () => {
    const blocks = buildL1PromptBlocks(['readme.md', 'architecture.md']);
    expect(blocks).toContain('readme.md');
    expect(blocks).toContain('architecture.md');
  });
});

describe('L2 quote-first prompt', () => {
  it('includes quote_first_protocol', () => {
    expect(QUOTE_FIRST_SYSTEM).toContain('quote_first_protocol');
  });

  it('buildL2Prompt includes document context and question', () => {
    const prompt = buildL2Prompt('doc content here', 'What is the answer?');
    expect(prompt).toContain('doc content here');
    expect(prompt).toContain('What is the answer?');
    expect(prompt).toContain('quote_first_protocol');
  });
});

describe('L3 evaluator prompt', () => {
  it('includes evaluation criteria', () => {
    expect(EVALUATOR_SYSTEM).toContain('evaluation_criteria');
    expect(EVALUATOR_SYSTEM).toContain('PASS');
    expect(EVALUATOR_SYSTEM).toContain('FAIL_RETRYABLE');
    expect(EVALUATOR_SYSTEM).toContain('FAIL_HARD');
  });

  it('buildL3EvalPrompt includes output and requirements', () => {
    const prompt = buildL3EvalPrompt('agent output', 'task reqs');
    expect(prompt).toContain('agent output');
    expect(prompt).toContain('task reqs');
  });

  it('buildL3EvalPrompt includes evidence when provided', () => {
    const prompt = buildL3EvalPrompt('output', 'reqs', 'evidence data');
    expect(prompt).toContain('evidence data');
    expect(prompt).toContain('<evidence>');
  });

  it('buildL3EvalPrompt omits evidence block when not provided', () => {
    const prompt = buildL3EvalPrompt('output', 'reqs');
    expect(prompt).not.toContain('<evidence>');
  });
});

describe('CoVe prompts', () => {
  it('plan questions system prompt exists', () => {
    expect(COVE_PLAN_QUESTIONS_SYSTEM).toContain('verification planner');
  });

  it('buildCoVePlanPrompt includes draft', () => {
    const prompt = buildCoVePlanPrompt('my draft');
    expect(prompt).toContain('my draft');
    expect(prompt).toContain('<draft>');
  });

  it('independent answer system prompt enforces no draft access', () => {
    expect(COVE_INDEPENDENT_ANSWER_SYSTEM).toContain('Do NOT reference');
  });

  it('buildCoVeAnswerPrompt includes question and sources', () => {
    const prompt = buildCoVeAnswerPrompt('Is this true?', 'source data');
    expect(prompt).toContain('Is this true?');
    expect(prompt).toContain('source data');
  });

  it('revise system prompt exists', () => {
    expect(COVE_REVISE_SYSTEM).toContain('draft reviser');
  });

  it('buildCoVeRevisePrompt includes draft and verified answers', () => {
    const prompt = buildCoVeRevisePrompt('draft text', [
      { question: 'Q1', answer: 'A1', supported: true },
      { question: 'Q2', answer: 'A2', supported: false },
    ]);
    expect(prompt).toContain('draft text');
    expect(prompt).toContain('Q1');
    expect(prompt).toContain('A1');
    expect(prompt).toContain('Supported: true');
    expect(prompt).toContain('Supported: false');
  });
});
