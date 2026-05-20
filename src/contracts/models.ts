import { z } from 'zod';

/**
 * Use-case tag attached to recommended models. Drives the assistant prompt's
 * "modelo recomendado por cenário" matrix and the BestFor column rendered in
 * the quick selector. Keep the set small — bigger means harder to map back to
 * a step's actual workload.
 *
 * - `coding`     — multi-arquivo, refactor pesado, gera código complexo
 * - `reasoning`  — matemática, lógica, dedução em vários passos
 * - `agentic`    — uso longo de tools, planejamento, contexto prolongado
 * - `fast`       — baixa latência, fan-out per-file, alto throughput
 * - `cheap`      — workhorse barato pra tarefas simples (lint, rename)
 * - `general`    — bom em tudo, default flagship
 */
export const ModelUseCaseSchema = z.enum([
  'coding',
  'reasoning',
  'agentic',
  'fast',
  'cheap',
  'general',
]);
export type ModelUseCase = z.infer<typeof ModelUseCaseSchema>;

/**
 * Tier classification. Used to bucket the catalog rendering and to gate
 * cost-conscious defaults (the assistant biases toward `workhorse` unless the
 * step calls for flagship-grade reasoning).
 */
export const ModelTierSchema = z.enum(['flagship', 'workhorse', 'fast']);
export type ModelTier = z.infer<typeof ModelTierSchema>;

/**
 * Which agent backend can serve this model. `openrouter` is the default
 * when omitted (matches existing recommended-models.json with no
 * provider field). `copilot` is the GitHub Copilot CLI / SDK; only models
 * Copilot exposes via `--model` are valid (claude-sonnet-4.6, gpt-5.5,
 * gemini-3-pro, etc.). The model selector filters the catalog by this
 * field according to the active `AppConfig.backend`.
 */
export const ModelProviderSchema = z.enum(['openrouter', 'copilot']);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  inputPrice: z.number().optional(),
  outputPrice: z.number().optional(),
  /** One-line PT-BR description shown in the assistant prompt and the table. */
  description: z.string().min(1).max(200).optional(),
  /** Use-case tags. First tag is the primary one (rendered in the table). */
  bestFor: z.array(ModelUseCaseSchema).min(1).max(4).optional(),
  /** Pricing/capability tier. Drives default biases in the assistant prompt. */
  tier: ModelTierSchema.optional(),
  /**
   * Backend that can run this model. Defaults to `openrouter` when
   * omitted to keep `recommended-models.json` files written before this
   * field existed parsing without churn.
   */
  provider: ModelProviderSchema.optional(),
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const RecommendedModelsFileSchema = z.object({
  models: z.array(ModelEntrySchema).min(1),
});

export type RecommendedModelsFile = z.infer<typeof RecommendedModelsFileSchema>;
