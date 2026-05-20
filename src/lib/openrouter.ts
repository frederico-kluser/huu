/**
 * Minimal OpenRouter client used to detect whether a model supports
 * reasoning/thinking at runtime.
 */

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const CAPABILITIES_FETCH_TIMEOUT_MS = 5_000;

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
    internal_reasoning?: string;
  };
  supported_parameters?: string[];
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

// Per-API-key cache. The previous design used a single global cache,
// which silently returned stale data when two different keys were used in
// the same process (multi-tenant, BYOK swap, key rotation): the second
// key inherited the first key's view of the model catalog. Keying by
// trimmed apiKey isolates each key's view; keys are never logged.
const capabilitiesCacheByKey: Map<string, Map<string, OpenRouterModel>> = new Map();

export function resetCapabilitiesCache(): void {
  capabilitiesCacheByKey.clear();
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://github.com/huu',
    'X-OpenRouter-Title': 'huu',
  };
}

export async function fetchModelCapabilities(
  apiKey: string,
): Promise<Map<string, OpenRouterModel>> {
  const key = apiKey.trim();
  const cached = capabilitiesCacheByKey.get(key);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAPABILITIES_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${OPENROUTER_API_BASE}/models`, {
      headers: buildAuthHeaders(key),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenRouter /models returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as OpenRouterModelsResponse;
    const map = new Map(body.data.map((m) => [m.id, m]));
    capabilitiesCacheByKey.set(key, map);
    return map;
  } finally {
    clearTimeout(timer);
  }
}

export function modelSupportsReasoning(
  modelId: string,
  capabilities: Map<string, OpenRouterModel>,
): boolean {
  if (modelId.includes(':thinking')) return true;
  const model = capabilities.get(modelId);
  if (!model) return false;
  return (
    Array.isArray(model.supported_parameters) &&
    model.supported_parameters.includes('reasoning')
  );
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  const trimmed = apiKey.trim();
  if (!trimmed) return false;
  try {
    const response = await fetch(`${OPENROUTER_API_BASE}/key`, {
      headers: buildAuthHeaders(trimmed),
    });
    return response.ok;
  } catch {
    return false;
  }
}
