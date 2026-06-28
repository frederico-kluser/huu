import { describe, it, expect } from 'vitest';
import { supportsThinking } from './model-factory.js';

describe('supportsThinking', () => {
  it('returns true for explicit :thinking suffix variants', () => {
    expect(supportsThinking('foo/bar:thinking')).toBe(true);
    expect(supportsThinking('any/model:thinking')).toBe(true);
  });

  it('returns true for -thinking infix (qwen3 family pattern)', () => {
    expect(supportsThinking('qwen/qwen3-235b-a22b-thinking-2507')).toBe(true);
    expect(supportsThinking('qwen/qwen3-vl-30b-a3b-thinking')).toBe(true);
    expect(supportsThinking('qwen/qwen3-max-thinking')).toBe(true);
  });

  it('returns true for the curated reasoning prefixes', () => {
    const reasoning = [
      'anthropic/claude-opus-4-5',
      'anthropic/claude-sonnet-4-6',
      'deepseek/deepseek-r1',
      'deepseek/deepseek-v3.1-thinking',
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
      'openai/o1-preview',
      'openai/o3-mini',
      'openai/o4-mini',
      'openai/gpt-5-pro',
      'google/gemini-2.5-pro',
      'google/gemini-3-pro',
      'minimax/minimax-m2',
      'z-ai/glm-4.5',
      'z-ai/glm-4.6',
      'x-ai/grok-4-fast',
      'xiaomi/mimo-v2.5-pro',
    ];
    for (const id of reasoning) {
      expect(supportsThinking(id), `expected ${id} to be a thinking model`).toBe(true);
    }
  });

  it('returns false for previously-misclassified families', () => {
    // OpenRouter audit on 2026-05-09 confirmed these are non-reasoning:
    // qwen3 base/coder/instruct variants, kimi-k2 (not in catalog),
    // qwen3-max base.
    const nonReasoning = [
      'qwen/qwen3-coder',
      'qwen/qwen3-coder-plus',
      'qwen/qwen3-vl-32b-instruct',
      'qwen/qwen3-30b-a3b-instruct-2507',
      'qwen/qwen3-max',
      'moonshot/kimi-k2',
      'moonshot/kimi-k2-instruct',
    ];
    for (const id of nonReasoning) {
      expect(supportsThinking(id), `expected ${id} to NOT be a thinking model`).toBe(false);
    }
  });

  it('returns false for unrelated providers', () => {
    expect(supportsThinking('mistralai/mistral-medium-3.5')).toBe(false);
    expect(supportsThinking('cohere/command-r-plus')).toBe(false);
    expect(supportsThinking('')).toBe(false);
  });
});
