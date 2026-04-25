import { z } from 'zod';

export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  inputPrice: z.number().optional(),
  outputPrice: z.number().optional(),
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const RecommendedModelsFileSchema = z.object({
  models: z.array(ModelEntrySchema).min(1),
});

export type RecommendedModelsFile = z.infer<typeof RecommendedModelsFileSchema>;
