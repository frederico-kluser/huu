import { z } from 'zod';

const StepScopeSchema = z.enum(['project', 'per-file', 'flexible']);

export const AssistantOptionSchema = z.object({
  label: z.string().min(1).max(120),
  isFreeText: z.boolean().optional(),
});

export const QuestionTurnSchema = z.object({
  done: z.literal(false),
  question: z.string().min(1).max(500),
  rationale: z.string().max(200).optional(),
  options: z.array(AssistantOptionSchema).min(2).max(5),
});

export const PipelineStepSchema = z.object({
  name: z.string().min(1).max(80),
  prompt: z.string().min(1),
  scope: StepScopeSchema,
  modelId: z.string().min(1).optional(),
});

export const PipelineDraftSchema = z.object({
  name: z.string().min(1).max(80),
  steps: z.array(PipelineStepSchema).min(1).max(20),
});

export const PipelineTurnSchema = z.object({
  done: z.literal(true),
  pipeline: PipelineDraftSchema,
});

export const AssistantTurnSchema = z.discriminatedUnion('done', [
  QuestionTurnSchema,
  PipelineTurnSchema,
]);

export type AssistantOption = z.infer<typeof AssistantOptionSchema>;
export type QuestionTurn = z.infer<typeof QuestionTurnSchema>;
export type PipelineDraft = z.infer<typeof PipelineDraftSchema>;
export type PipelineTurn = z.infer<typeof PipelineTurnSchema>;
export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;

/**
 * The contract requires the LAST option to be a free-text fallback so the user
 * never feels locked into the model's pre-formed choices. The Zod schema can't
 * express positional constraints, so we enforce it here as a post-parse check.
 */
export function validateQuestionShape(turn: QuestionTurn): void {
  const last = turn.options[turn.options.length - 1];
  if (!last?.isFreeText) {
    throw new Error(
      'AssistantTurn invalid: the last option must have isFreeText=true (free-text fallback).',
    );
  }
  const freeTextCount = turn.options.filter((o) => o.isFreeText).length;
  if (freeTextCount !== 1) {
    throw new Error(
      `AssistantTurn invalid: exactly one option must be isFreeText (got ${freeTextCount}).`,
    );
  }
}
