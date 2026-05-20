/**
 * Heuristic for whether a model supports thinking/reasoning. Used by the
 * agent-spawner to set thinkingLevel before falling back to the runtime
 * capability check via OpenRouter /models.
 *
 * The list is intentionally conservative. False negatives are fine — the
 * capability probe in `pi/factory.ts:resolveThinkingLevel` catches them
 * and now logs a warn if the probe itself fails. False positives are the
 * dangerous case: they push thinkingLevel='medium' onto models that
 * don't accept reasoning, which either errors at the provider or gets
 * silently ignored, wasting the run.
 *
 * Audit notes (OpenRouter /models on 2026-05-09):
 *   - removed `moonshot/kimi-k2`: 0 matches in the current catalog
 *   - removed `qwen/qwen3`: only 25 of 40 matches accept reasoning; the
 *     15 without it (coder, instruct, base-max variants) are real
 *     models users pick. Specific thinking siblings still match via the
 *     `:thinking` suffix or `-thinking` infix below.
 */
export function supportsThinking(modelId: string): boolean {
  if (modelId.includes(':thinking') || modelId.includes('-thinking')) return true;
  const thinkingPrefixes = [
    'anthropic/claude',
    'deepseek/deepseek-r1',
    'deepseek/deepseek-v3',
    'openai/o1',
    'openai/o3',
    'openai/o4',
    'openai/gpt-5',
    'google/gemini-2.5',
    'google/gemini-3',
    'minimax/minimax-m2',
    'z-ai/glm-4.5',
    'z-ai/glm-4.6',
    'x-ai/grok-4',
    'xiaomi/mimo',
  ];
  return thinkingPrefixes.some((p) => modelId.startsWith(p));
}
