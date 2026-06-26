import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  RecommendedModelsFileSchema,
  type ModelEntry,
  type ModelProvider,
} from '../contracts/models.js';
import type { AgentBackendKind } from '../lib/types.js';

/**
 * The single canonical default model id — the headline of the recommended
 * catalog and the value both front-ends preselect when the user hasn't picked
 * one. Keep in sync with the FIRST entry of `recommended-models.json` (the
 * shipped catalog) and of `DEFAULT_RECOMMENDED_MODELS` below (the in-code
 * fallback used when that file is absent or fails to parse). The web client
 * mirrors this string in `src/web/client/app.js` (vanilla JS, no TS import).
 */
export const DEFAULT_MODEL_ID = 'deepseek/deepseek-v4-flash';

const DEFAULT_RECOMMENDED_MODELS: readonly ModelEntry[] = [
  {
    id: DEFAULT_MODEL_ID,
    label: 'DeepSeek V4 Flash',
    inputPrice: 0.09,
    outputPrice: 0.18,
    description:
      'Default — fast, cheap, capable (1M context, tools + reasoning). The general-purpose default for running pipeline steps.',
    bestFor: ['fast', 'cheap', 'coding'],
    tier: 'fast',
  },
  {
    id: 'minimax/minimax-m2.7',
    label: 'MiniMax M2.7',
    inputPrice: 0.134,
    outputPrice: 1.31,
    description:
      'Fast and cheap — use for simple steps, per-file, parallel fan-out (lint, rename, JSDoc, translate, boilerplate).',
    bestFor: ['cheap', 'fast'],
    tier: 'fast',
  },
  {
    id: 'moonshotai/kimi-k2.6',
    label: 'Kimi K2.6',
    inputPrice: 0.74,
    outputPrice: 4.66,
    description:
      'Deep thinking, agentic, heavy coding — use for complex steps, multi-file, reasoning, cross-file refactors.',
    bestFor: ['coding', 'reasoning', 'agentic'],
    tier: 'workhorse',
  },
];

const RECOMMENDED_MODELS_FILE = 'recommended-models.json';

/**
 * Azure AI Foundry built-in catalog.
 *
 * Covers the most common OpenAI deployments and Marketplace models.
 * Model IDs are Azure deployment names (no provider/ prefix).
 *
 * Pricing is omitted for Marketplace models (Azure Foundry bills per
 * token at the provider's rate but doesn't expose pricing via the
 * models endpoint). OpenAI models show list prices for orientation;
 * actual billing depends on your Azure commitment tier.
 */
const DEFAULT_AZURE_MODELS: readonly ModelEntry[] = [
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    inputPrice: 2.5,
    outputPrice: 10,
    description: 'Workhorse multimodal OpenAI no Azure. Excelente relação custo-benefício.',
    bestFor: ['coding', 'agentic'],
    tier: 'workhorse',
    provider: 'azure',
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o Mini',
    inputPrice: 0.15,
    outputPrice: 0.6,
    description: 'Rápido e barato para fan-out per-file no Azure.',
    bestFor: ['fast', 'cheap'],
    tier: 'fast',
    provider: 'azure',
  },
  {
    id: 'gpt-5',
    label: 'GPT-5',
    description: 'Flagship OpenAI no Azure — máxima capacidade.',
    bestFor: ['reasoning', 'agentic', 'general'],
    tier: 'flagship',
    provider: 'azure',
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 Mini',
    description: 'Leve do GPT-5 no Azure — rápido para tarefas de código simples.',
    bestFor: ['fast', 'coding'],
    tier: 'fast',
    provider: 'azure',
  },
  {
    id: 'o3',
    label: 'o3',
    description: 'Raciocínio profundo OpenAI no Azure. Melhor para lógica complexa.',
    bestFor: ['reasoning', 'coding'],
    tier: 'flagship',
    provider: 'azure',
  },
  {
    id: 'o4-mini',
    label: 'o4-mini',
    description: 'Raciocínio rápido e eficiente no Azure.',
    bestFor: ['reasoning', 'fast'],
    tier: 'workhorse',
    provider: 'azure',
  },
  {
    id: 'phi-4',
    label: 'Phi-4',
    description: 'Modelo Microsoft compacto e eficiente. Ótimo para tarefas de código simples.',
    bestFor: ['fast', 'cheap', 'coding'],
    tier: 'fast',
    provider: 'azure',
  },
  {
    id: 'phi-4-mini',
    label: 'Phi-4 Mini',
    description: 'Microsoft ultra rápido para fan-out e tarefas triviais.',
    bestFor: ['fast', 'cheap'],
    tier: 'fast',
    provider: 'azure',
  },
  {
    id: 'Llama-3.3-70B-Instruct',
    label: 'Llama 3.3 70B',
    description: 'Meta Llama 3.3 70B via Azure AI Foundry Marketplace.',
    bestFor: ['coding', 'agentic'],
    tier: 'workhorse',
    provider: 'azure',
  },
  {
    id: 'DeepSeek-R1',
    label: 'DeepSeek R1',
    description: 'Raciocínio DeepSeek via Azure Marketplace. Forte em lógica e matemática.',
    bestFor: ['reasoning', 'coding'],
    tier: 'flagship',
    provider: 'azure',
  },
];

/**
 * Returns the merged catalog (OpenRouter file override + Azure built-ins).
 * When `backend` is provided, the result is filtered to only models that
 * backend's provider can serve. Models without an explicit `provider` are
 * treated as `openrouter` (back-compat with files written before this field
 * existed). The Azure built-ins are appended unconditionally so the UI can
 * offer them even when no `recommended-models.json` exists.
 */
export function loadRecommendedModels(
  projectRoot: string,
  backend?: AgentBackendKind,
): ModelEntry[] {
  const filePath = join(projectRoot, RECOMMENDED_MODELS_FILE);
  let openrouterEntries: readonly ModelEntry[] = DEFAULT_RECOMMENDED_MODELS;
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      openrouterEntries = RecommendedModelsFileSchema.parse(parsed).models;
    } catch {
      // Keep defaults on parse error — surfacing a hard failure here
      // breaks the TUI for a recoverable problem.
    }
  }

  const all: ModelEntry[] = [...openrouterEntries, ...loadAzureModels(projectRoot)];

  // No filter when backend is undefined OR 'stub'. Stub never calls a
  // provider, so a smoke-test run (`--stub`) MUST not be blocked by a
  // filter. Filtering only when running a real backend prevents accidental
  // wrong-provider selections.
  if (!backend || backend === 'stub') return all;
  return all.filter((m) => providerFor(m) === backendToModelProvider(backend));
}

function providerFor(m: ModelEntry): ModelProvider {
  return m.provider ?? 'openrouter';
}

function backendToModelProvider(backend: AgentBackendKind): ModelProvider {
  return backend === 'azure' ? 'azure' : 'openrouter';
}

/**
 * Azure deployments are user-specific: the catalog is just a fallback.
 * Users can fully customize the model picker by editing either:
 *   - `<projectRoot>/azure-models.json` (per-project)
 *   - `~/.huu/azure-models.json`        (global)
 *
 * Both files use the same shape as `recommended-models.json` (the schema
 * already accepts `provider: "azure"`). The per-project file wins if both
 * exist. When no override file is present, `DEFAULT_AZURE_MODELS` is used.
 *
 * Each entry's `id` MUST match the deployment name in your Azure resource —
 * NOT the underlying model name. E.g. if you named your deployment
 * "my-gpt4o", set `id: "my-gpt4o"`.
 */
export function loadAzureModels(projectRoot: string): readonly ModelEntry[] {
  const candidates = [
    join(projectRoot, 'azure-models.json'),
    join(homedir(), '.huu', 'azure-models.json'),
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const models = RecommendedModelsFileSchema.parse(parsed).models;
      // Force provider=azure regardless of what the file declares, so a
      // misfiled openrouter entry doesn't bleed into the Azure picker.
      return models.map((m) => ({ ...m, provider: 'azure' as const }));
    } catch {
      // fall through to next candidate / defaults
    }
  }
  return DEFAULT_AZURE_MODELS;
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
