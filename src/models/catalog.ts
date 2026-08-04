import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
 * Returns the merged catalog. When `backend` is provided, the result is
 * filtered to only models that backend's provider can serve. Models without
 * an explicit `provider` are treated as `deepseek` (back-compat with files
 * written before this field existed).
 */
export function loadRecommendedModels(
  projectRoot: string,
  backend?: AgentBackendKind,
): ModelEntry[] {
  const filePath = join(projectRoot, RECOMMENDED_MODELS_FILE);
  let entries: readonly ModelEntry[] = DEFAULT_RECOMMENDED_MODELS;
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      entries = RecommendedModelsFileSchema.parse(parsed).models;
    } catch {
      // Keep defaults on parse error — surfacing a hard failure here
      // breaks the TUI for a recoverable problem.
    }
  }

  const all: ModelEntry[] = [...entries];

  // No filter when backend is undefined OR 'stub'. Stub never calls a
  // provider, so a smoke-test run (`--stub`) MUST not be blocked by a
  // filter. Filtering only when running a real backend prevents accidental
  // wrong-provider selections.
  if (!backend || backend === 'stub') return all;
  return all.filter((m) => providerFor(m) === backendToModelProvider(backend));
}

function providerFor(m: ModelEntry): ModelProvider {
  return m.provider ?? 'deepseek';
}

function backendToModelProvider(backend: AgentBackendKind): ModelProvider {
  return 'deepseek';
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
