import { z } from 'zod';

const StepScopeSchema = z.enum(['project', 'per-file', 'flexible', 'memory']);

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
  /** memory scope only: repo-relative path of the huu-memory-v1 file an earlier step writes. */
  filesFrom: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
}).refine((s) => s.scope !== 'memory' || Boolean(s.filesFrom), {
  message: 'scope "memory" requires filesFrom (path of the memory file an earlier step writes)',
  path: ['filesFrom'],
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

/**
 * LLMs occasionally drift on the "last option is the free-text fallback"
 * contract — they may forget the flag entirely, mark multiple options as
 * free-text, or put the free-text option in the wrong position. Throwing in
 * those cases (the old behavior) crashed the whole assistant screen. This
 * normalizer reshapes the options so the contract holds:
 *   - if the model already produced a single, last-positioned free-text
 *     option, the turn is returned unchanged
 *   - if multiple options are flagged, the LAST flagged one wins (clearing
 *     the flag from the rest) and is moved to the end
 *   - if no option is flagged, the last option is promoted to free-text and
 *     given a generic label when it doesn't already look like a fallback
 * The result is then safe to pass to `validateQuestionShape` as a final
 * sanity check.
 */
export function normalizeQuestionShape(turn: QuestionTurn): QuestionTurn {
  const opts = turn.options;
  if (opts.length === 0) return turn;
  const lastIdx = opts.length - 1;
  const lastIsFree = Boolean(opts[lastIdx]?.isFreeText);
  const freeCount = opts.filter((o) => o.isFreeText).length;
  if (lastIsFree && freeCount === 1) return turn;

  let normalized: AssistantOption[];
  if (freeCount === 0) {
    const labelLooksFree = /type|other|none|free|digit|outra|nenhuma|livre/i.test(opts[lastIdx]!.label);
    normalized = opts.map((o, i) =>
      i === lastIdx
        ? { label: labelLooksFree ? o.label : 'Other (type it)', isFreeText: true }
        : { label: o.label },
    );
  } else {
    const flaggedIdxs = opts.map((o, i) => (o.isFreeText ? i : -1)).filter((i) => i >= 0);
    const winnerIdx = flaggedIdxs[flaggedIdxs.length - 1]!;
    const winner: AssistantOption = { label: opts[winnerIdx]!.label, isFreeText: true };
    const rest = opts
      .filter((_, i) => i !== winnerIdx)
      .map((o) => ({ label: o.label }));
    normalized = [...rest, winner];
  }

  return { ...turn, options: normalized };
}
