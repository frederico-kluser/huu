/**
 * Heuristic for whether a model supports thinking/reasoning. Used by the
 * agent-spawner to set thinkingLevel before falling back to the runtime
 * capability check via OpenRouter /models.
 */
export function supportsThinking(modelId: string): boolean {
  if (modelId.includes(':thinking')) return true;
  const thinkingPrefixes = [
    'anthropic/claude',
    'deepseek/deepseek-r1',
    'openai/o1',
    'openai/o3',
    'google/gemini-2.5',
    'minimax/minimax-m2',
    'openai/o4',
    'openai/gpt-5',
    'z-ai/glm-4.6',
    'google/gemini-3',
    'x-ai/grok-4',
    'z-ai/glm-4.5',
    'xiaomi/mimo',
    'deepseek/deepseek-v3',
    'moonshot/kimi-k2',
    'moonshotai/kimi-k2',
    'qwen/qwen3',
  ];
  return thinkingPrefixes.some((p) => modelId.startsWith(p));
}
