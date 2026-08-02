import { describe, it, expect } from 'vitest';
import { buildMetricsIndex } from './aa-enrichment.js';
import type { ModelEntry } from '../contracts/models.js';
import type { AAModel } from 'model-selector-ink';

function aa(slug: string, name: string, intel: number, code: number, math: number, tps: number): AAModel {
  return {
    id: slug,
    name,
    slug,
    model_creator: { id: 'c', name: 'creator', slug: 'creator' },
    evaluations: {
      artificial_analysis_intelligence_index: intel,
      artificial_analysis_coding_index: code,
      artificial_analysis_math_index: math,
      mmlu_pro: null,
      gpqa: null,
      hle: null,
      livecodebench: null,
      scicode: null,
      math_500: null,
      aime: null,
    },
    pricing: {
      price_1m_blended_3_to_1: null,
      price_1m_input_tokens: null,
      price_1m_output_tokens: null,
    },
    median_output_tokens_per_second: tps,
    median_time_to_first_token_seconds: null,
    median_time_to_first_answer_token: null,
  };
}

const catalog: ModelEntry[] = [
  { id: 'z-ai/glm-5.1', label: 'GLM 5.1' },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'unknown/no-match', label: 'No Match' },
];

describe('buildMetricsIndex', () => {
  it('returns EMPTY_METRICS for every catalog id when AA models are null', () => {
    const idx = buildMetricsIndex(catalog, null);
    for (const entry of catalog) {
      const m = idx.get(entry.id);
      expect(m?.agentic).toBeNull();
      expect(m?.coding).toBeNull();
      expect(m?.reasoning).toBeNull();
      expect(m?.tokensPerSecond).toBeNull();
    }
  });

  it('matches AA models by normalized slug', () => {
    const aaModels = [
      aa('glm-5.1', 'GLM 5.1', 72, 81, 76, 90),
      aa('kimi-k2.6', 'Kimi K2.6', 65, 70, 60, 110),
    ];
    const idx = buildMetricsIndex(catalog, aaModels);
    expect(idx.get('z-ai/glm-5.1')).toEqual({
      agentic: 72,
      coding: 81,
      reasoning: 76,
      tokensPerSecond: 90,
    });
    expect(idx.get('moonshotai/kimi-k2.6')).toEqual({
      agentic: 65,
      coding: 70,
      reasoning: 60,
      tokensPerSecond: 110,
    });
  });

  it('falls back to empty metrics when no AA entry matches', () => {
    const aaModels = [aa('glm-5.1', 'GLM 5.1', 72, 81, 76, 90)];
    const idx = buildMetricsIndex(catalog, aaModels);
    expect(idx.get('unknown/no-match')?.agentic).toBeNull();
  });

  it('handles partial substring matches (e.g. AA slug embedded in OR id)', () => {
    const aaModels = [aa('glm51', 'GLM 5.1', 50, 50, 50, 50)];
    const idx = buildMetricsIndex(catalog, aaModels);
    // 'glm-5.1' normalized is 'glm5.1' which contains 'glm51'
    expect(idx.get('z-ai/glm-5.1')?.agentic).toBe(50);
  });
});
