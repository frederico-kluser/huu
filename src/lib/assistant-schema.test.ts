import { describe, it, expect } from 'vitest';
import {
  AssistantTurnSchema,
  QuestionTurnSchema,
  PipelineTurnSchema,
  normalizeQuestionShape,
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

describe('normalizeQuestionShape', () => {
  it('returns the turn unchanged when it already satisfies the contract', () => {
    const turn: QuestionTurn = {
      done: false,
      question: 'X?',
      options: [
        { label: 'A' },
        { label: 'Outra (digite)', isFreeText: true },
      ],
    };
    const out = normalizeQuestionShape(turn);
    expect(out).toBe(turn);
    expect(() => validateQuestionShape(out)).not.toThrow();
  });

  it('promotes the last option when the model forgot the free-text flag', () => {
    const turn: QuestionTurn = {
      done: false,
      question: 'X?',
      options: [{ label: 'A' }, { label: 'B' }],
    };
    const out = normalizeQuestionShape(turn);
    expect(out.options).toHaveLength(2);
    expect(out.options[1]?.isFreeText).toBe(true);
    expect(out.options[1]?.label).toBe('Outra opção (digite)');
    expect(() => validateQuestionShape(out)).not.toThrow();
  });

  it('preserves the last option label when it already looks like a fallback', () => {
    const turn: QuestionTurn = {
      done: false,
      question: 'X?',
      options: [{ label: 'A' }, { label: 'Nenhuma das opções — digite' }],
    };
    const out = normalizeQuestionShape(turn);
    expect(out.options[1]?.isFreeText).toBe(true);
    expect(out.options[1]?.label).toBe('Nenhuma das opções — digite');
    expect(() => validateQuestionShape(out)).not.toThrow();
  });

  it('moves a misplaced free-text option to the end', () => {
    const turn: QuestionTurn = {
      done: false,
      question: 'X?',
      options: [
        { label: 'Outra (digite)', isFreeText: true },
        { label: 'A' },
        { label: 'B' },
      ],
    };
    const out = normalizeQuestionShape(turn);
    expect(out.options.map((o) => o.label)).toEqual(['A', 'B', 'Outra (digite)']);
    expect(out.options[2]?.isFreeText).toBe(true);
    expect(() => validateQuestionShape(out)).not.toThrow();
  });

  it('keeps only the last free-text option when several are flagged', () => {
    const turn: QuestionTurn = {
      done: false,
      question: 'X?',
      options: [
        { label: 'A', isFreeText: true },
        { label: 'B' },
        { label: 'Outra (digite)', isFreeText: true },
      ],
    };
    const out = normalizeQuestionShape(turn);
    expect(out.options.filter((o) => o.isFreeText)).toHaveLength(1);
    expect(out.options[out.options.length - 1]?.label).toBe('Outra (digite)');
    expect(out.options[out.options.length - 1]?.isFreeText).toBe(true);
    expect(out.options[0]?.isFreeText).toBeUndefined();
    expect(() => validateQuestionShape(out)).not.toThrow();
  });
});
