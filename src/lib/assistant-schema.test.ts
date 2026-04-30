import { describe, it, expect } from 'vitest';
import {
  AssistantTurnSchema,
  QuestionTurnSchema,
  PipelineTurnSchema,
  validateQuestionShape,
  type QuestionTurn,
} from './assistant-schema.js';

describe('AssistantTurnSchema', () => {
  it('accepts a valid question turn with last option as free-text', () => {
    const parsed = AssistantTurnSchema.parse({
      done: false,
      question: 'Qual a granularidade?',
      options: [
        { label: 'Projeto inteiro' },
        { label: 'Por arquivo' },
        { label: 'Outra opção (digite)', isFreeText: true },
      ],
    });
    expect(parsed.done).toBe(false);
    if (parsed.done === false) expect(parsed.options).toHaveLength(3);
  });

  it('accepts a valid pipeline turn', () => {
    const parsed = AssistantTurnSchema.parse({
      done: true,
      pipeline: {
        name: 'lint-fix',
        steps: [
          {
            name: 'lint',
            prompt: 'Run linter and fix errors',
            scope: 'per-file',
          },
        ],
      },
    });
    expect(parsed.done).toBe(true);
    if (parsed.done === true) expect(parsed.pipeline.steps).toHaveLength(1);
  });

  it('rejects a question turn with fewer than 2 options', () => {
    expect(() =>
      QuestionTurnSchema.parse({
        done: false,
        question: 'X?',
        options: [{ label: 'A', isFreeText: true }],
      }),
    ).toThrow();
  });

  it('rejects a question turn with more than 5 options', () => {
    expect(() =>
      QuestionTurnSchema.parse({
        done: false,
        question: 'X?',
        options: [
          { label: 'A' },
          { label: 'B' },
          { label: 'C' },
          { label: 'D' },
          { label: 'E' },
          { label: 'F', isFreeText: true },
        ],
      }),
    ).toThrow();
  });

  it('rejects a pipeline turn with empty steps', () => {
    expect(() =>
      PipelineTurnSchema.parse({
        done: true,
        pipeline: { name: 'p', steps: [] },
      }),
    ).toThrow();
  });

  it('rejects a step with invalid scope', () => {
    expect(() =>
      PipelineTurnSchema.parse({
        done: true,
        pipeline: {
          name: 'p',
          steps: [{ name: 's', prompt: 'do', scope: 'parallel' }],
        },
      }),
    ).toThrow();
  });
});

describe('validateQuestionShape', () => {
  it('passes when last option is free-text', () => {
    const turn: QuestionTurn = {
      done: false,
      question: 'X?',
      options: [
        { label: 'A' },
        { label: 'Outra (digite)', isFreeText: true },
      ],
    };
    expect(() => validateQuestionShape(turn)).not.toThrow();
  });

  it('throws when last option is not free-text', () => {
    const turn: QuestionTurn = {
      done: false,
      question: 'X?',
      options: [
        { label: 'A', isFreeText: true },
        { label: 'B' },
      ],
    };
    expect(() => validateQuestionShape(turn)).toThrow(/last option/i);
  });

  it('throws when more than one option is free-text', () => {
    const turn: QuestionTurn = {
      done: false,
      question: 'X?',
      options: [
        { label: 'A', isFreeText: true },
        { label: 'B', isFreeText: true },
      ],
    };
    expect(() => validateQuestionShape(turn)).toThrow(/exactly one/i);
  });
});
