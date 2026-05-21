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

  // No filter when backend is undefined OR 'stub'. Stub never calls a
  // provider, so picking a Copilot model under --stub --copilot
  // (smoke-test the Copilot UI flow without burning quota) MUST not
  // be blocked by a filter. Filtering only when running a real
  // backend prevents accidental wrong-provider selections.
  if (!backend || backend === 'stub') return all;
  return all.filter((m) => providerFor(m) === backendToProvider(backend));
}

function providerFor(m: ModelEntry): ModelProvider {
  return m.provider ?? 'openrouter';
}

function backendToProvider(backend: 'pi' | 'copilot'): ModelProvider {
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
