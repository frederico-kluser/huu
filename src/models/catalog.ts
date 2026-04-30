import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RecommendedModelsFileSchema, type ModelEntry } from '../contracts/models.js';

const DEFAULT_RECOMMENDED_MODELS: readonly ModelEntry[] = [
  {
    id: 'deepseek/deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    inputPrice: 0.18,
    outputPrice: 0.42,
    description:
      'Workhorse barato e rápido da DeepSeek; ótimo para fan-out per-file e tarefas simples.',
    bestFor: ['cheap', 'fast', 'coding'],
    tier: 'fast',
  },
  {
    id: 'minimax/minimax-m2.7',
    label: 'MiniMax M2.7',
    inputPrice: 0.134,
    outputPrice: 1.31,
    description:
      'Mais barato da lista, ótimo function-calling — default para recon e selector.',
    bestFor: ['cheap', 'fast', 'agentic'],
    tier: 'fast',
  },
  {
    id: 'xiaomi/mimo-v2.5-pro',
    label: 'MiMo V2.5 Pro',
    inputPrice: 0.32,
    outputPrice: 1.6,
    description: 'Forte em raciocínio matemático e lógica; equilibrado em custo.',
    bestFor: ['reasoning', 'coding'],
    tier: 'workhorse',
  },
  {
    id: 'z-ai/glm-5.1',
    label: 'GLM 5.1',
    inputPrice: 0.496,
    outputPrice: 3.04,
    description:
      'Reasoning sólido com bom equilíbrio entre custo e qualidade; mid-tier confiável.',
    bestFor: ['reasoning', 'general'],
    tier: 'workhorse',
  },
  {
    id: 'moonshotai/kimi-k2.6',
    label: 'Kimi K2.6',
    inputPrice: 0.74,
    outputPrice: 4.66,
    description:
      'Long-context e agentic strong — ideal para steps com várias tools e contexto extenso.',
    bestFor: ['agentic', 'coding'],
    tier: 'workhorse',
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    inputPrice: 0.85,
    outputPrice: 5.2,
    description:
      'Flagship coding-first da DeepSeek; refactor pesado e cross-file no melhor custo-benefício.',
    bestFor: ['coding', 'agentic', 'reasoning'],
    tier: 'flagship',
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    inputPrice: 1.13,
    outputPrice: 12.04,
    description:
      'Flagship da Google com janela enorme; bom em agentic mas caro no output.',
    bestFor: ['agentic', 'general', 'reasoning'],
    tier: 'flagship',
  },
  {
    id: 'openai/gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    description: 'Mini da OpenAI: rápido, generalista e barato — bom default seguro.',
    bestFor: ['fast', 'general', 'cheap'],
    tier: 'fast',
  },
  {
    id: 'openai/gpt-5.4',
    label: 'GPT-5.4',
    inputPrice: 1.24,
    outputPrice: 15.23,
    description: 'Flagship da OpenAI; melhor all-around quando custo não é gargalo.',
    bestFor: ['general', 'coding', 'agentic'],
    tier: 'flagship',
  },
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
