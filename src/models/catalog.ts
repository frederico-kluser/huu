import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  RecommendedModelsFileSchema,
  type ModelEntry,
  type ModelProvider,
} from '../contracts/models.js';
import type { AgentBackendKind } from '../lib/types.js';

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

/**
 * Models exposed by the GitHub Copilot CLI as of Apr 2026 (verified
 * against docs.github.com/en/copilot/reference/ai-models/supported-models).
 * IDs are bare names — no `<provider>/` prefix, unlike OpenRouter.
 *
 * Pricing fields are intentionally absent: Copilot bills by
 * premium-request multiplier per subscription, not per token. The
 * `description` field carries the multiplier so the model selector
 * surfaces the cost trade-off.
 */
const DEFAULT_COPILOT_MODELS: readonly ModelEntry[] = [
  {
    id: 'claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    description: '0.33× premium request — fastest/cheapest, good for fan-out per-file.',
    bestFor: ['fast', 'cheap', 'coding'],
    tier: 'fast',
    provider: 'copilot',
  },
  {
    id: 'claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    description: '1× premium request — recommended workhorse for coding.',
    bestFor: ['coding', 'agentic', 'general'],
    tier: 'workhorse',
    provider: 'copilot',
  },
  {
    id: 'claude-opus-4.7',
    label: 'Claude Opus 4.7',
    description: '3× premium request — flagship reasoning + agentic; promo expires 2026-04-30.',
    bestFor: ['reasoning', 'coding', 'agentic'],
    tier: 'flagship',
    provider: 'copilot',
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    description: 'OpenAI flagship via Copilot; promo 7.5× during launch window.',
    bestFor: ['general', 'reasoning', 'agentic'],
    tier: 'flagship',
    provider: 'copilot',
  },
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    description: 'Coding-tuned variant; balanced for code-heavy refactors.',
    bestFor: ['coding', 'agentic'],
    tier: 'workhorse',
    provider: 'copilot',
  },
  {
    id: 'gemini-3-pro',
    label: 'Gemini 3 Pro',
    description: 'Google flagship via Copilot; large context window.',
    bestFor: ['agentic', 'general', 'reasoning'],
    tier: 'flagship',
    provider: 'copilot',
  },
];

const RECOMMENDED_MODELS_FILE = 'recommended-models.json';

/**
 * Returns the merged catalog (file override + Copilot built-ins). When
 * `backend` is provided, the result is filtered to only models that
 * backend can serve. Models without an explicit `provider` are treated
 * as `openrouter` (back-compat with files written before this field
 * existed). The Copilot built-ins are appended unconditionally so the
 * UI can offer them even when no `recommended-models.json` exists.
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

  const all: ModelEntry[] = [...openrouterEntries, ...DEFAULT_COPILOT_MODELS];

  if (!backend) return all;
  return all.filter((m) => providerFor(m) === backendToProvider(backend));
}

function providerFor(m: ModelEntry): ModelProvider {
  return m.provider ?? 'openrouter';
}

function backendToProvider(backend: AgentBackendKind): ModelProvider {
  // `stub` doesn't actually call any provider — but the catalog still
  // needs a deterministic filter. We default stub to OpenRouter so the
  // user can pick whatever they want with --stub for smoke tests.
  return backend === 'copilot' ? 'copilot' : 'openrouter';
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
