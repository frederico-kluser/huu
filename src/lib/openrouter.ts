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

let capabilitiesCache: Map<string, OpenRouterModel> | null = null;

export function resetCapabilitiesCache(): void {
  capabilitiesCache = null;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://github.com/programatic-agent',
    'X-OpenRouter-Title': 'programatic-agent',
  };
}

export async function fetchModelCapabilities(
  apiKey: string,
): Promise<Map<string, OpenRouterModel>> {
  if (capabilitiesCache) return capabilitiesCache;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAPABILITIES_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${OPENROUTER_API_BASE}/models`, {
      headers: buildAuthHeaders(apiKey),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenRouter /models returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as OpenRouterModelsResponse;
    capabilitiesCache = new Map(body.data.map((m) => [m.id, m]));
    return capabilitiesCache;
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
