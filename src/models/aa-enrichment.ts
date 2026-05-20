/**
 * Pulls Artificial Analysis benchmark data and matches it against our
 * recommended-models catalog by normalized ID/name.
 *
 * model-selector-ink already exports an end-to-end `ModelSelector` component
 * that does this matching for OpenRouter shapes; we re-implement a slim
 * matcher here because (a) our `ModelEntry` shape is intentionally simpler
 * than `EnrichedModel`, and (b) we want the AA fetch to run independently of
 * Ink rendering (no React imports below this line). Keep matching heuristic-
 * compatible with `buildEnrichedModels` so a model that matches there matches
 * here.
 *
 * @module
 */

import type { AAModel } from 'model-selector-ink';
import type { ModelEntry } from '../contracts/models.js';
import type { AARowMetrics } from './format-row.js';
import { EMPTY_METRICS } from './format-row.js';

/**
 * Same normalization rule as model-selector-ink's `normalizeAAName`. Inlined
 * to dodge ink/react peer-dependency entanglement when this module is loaded
 * outside the UI (e.g. background prefetch).
 */
function normalizeAAName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_]/g, '').replace(/[()]/g, '');
}

function buildAAIndex(aaModels: readonly AAModel[]): ReadonlyMap<string, AAModel> {
  const index = new Map<string, AAModel>();
  for (const m of aaModels) {
    index.set(normalizeAAName(m.slug), m);
    index.set(normalizeAAName(m.name), m);
  }
  return index;
}

function findAAMatch(
  modelId: string,
  aaIndex: ReadonlyMap<string, AAModel>,
): AAModel | undefined {
  const slug = modelId.includes('/') ? modelId.split('/')[1]! : modelId;
  const normalized = normalizeAAName(slug);
  const direct = aaIndex.get(normalized);
  if (direct) return direct;
  for (const [key, aa] of aaIndex) {
    if (normalized.includes(key) || key.includes(normalized)) return aa;
  }
  return undefined;
}

function aaToMetrics(aa: AAModel): AARowMetrics {
  return {
    agentic: aa.evaluations.artificial_analysis_intelligence_index,
    coding: aa.evaluations.artificial_analysis_coding_index,
    reasoning: aa.evaluations.artificial_analysis_math_index,
    tokensPerSecond: aa.median_output_tokens_per_second,
  };
}

/**
 * Build a metric lookup keyed by our recommended-model IDs. Models that don't
 * match any AA row map to `EMPTY_METRICS` so callers can render a placeholder
 * row without conditional branching.
 */
export function buildMetricsIndex(
  catalog: readonly ModelEntry[],
  aaModels: readonly AAModel[] | null,
): ReadonlyMap<string, AARowMetrics> {
  const out = new Map<string, AARowMetrics>();
  if (!aaModels || aaModels.length === 0) {
    for (const entry of catalog) out.set(entry.id, EMPTY_METRICS);
    return out;
  }
  const aaIndex = buildAAIndex(aaModels);
  for (const entry of catalog) {
    const match = findAAMatch(entry.id, aaIndex);
    out.set(entry.id, match ? aaToMetrics(match) : EMPTY_METRICS);
  }
  return out;
}
