import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RecommendedModelsFileSchema, type ModelEntry } from '../contracts/models.js';

const DEFAULT_RECOMMENDED_MODELS: readonly ModelEntry[] = [
  { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', inputPrice: 0.217, outputPrice: 0.479 },
  { id: 'minimax/minimax-m2.7', label: 'MiniMax M2.7', inputPrice: 0.134, outputPrice: 1.31 },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'z-ai/glm-5.1', label: 'GLM 5.1', inputPrice: 0.496, outputPrice: 3.04 },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', inputPrice: 1.13, outputPrice: 12.04 },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'openai/gpt-5.4', label: 'GPT-5.4', inputPrice: 1.24, outputPrice: 15.23 },
];

const RECOMMENDED_MODELS_FILE = 'recommended-models.json';

export function loadRecommendedModels(projectRoot: string): ModelEntry[] {
  const filePath = join(projectRoot, RECOMMENDED_MODELS_FILE);
  if (!existsSync(filePath)) return [...DEFAULT_RECOMMENDED_MODELS];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return RecommendedModelsFileSchema.parse(parsed).models;
  } catch {
    return [...DEFAULT_RECOMMENDED_MODELS];
  }
}

export function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null) return '$?';
  return `$${price.toFixed(2)}`;
}

export function formatModelLabel(entry: ModelEntry): string {
  return `${entry.label}  ${formatPrice(entry.inputPrice)}/${formatPrice(entry.outputPrice)}`;
}

export function findRecommendedModel(
  projectRoot: string,
  modelId: string,
): ModelEntry | undefined {
  return loadRecommendedModels(projectRoot).find((m) => m.id === modelId);
}
