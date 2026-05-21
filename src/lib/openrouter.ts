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

export type ReachabilityResult =
  | { kind: 'ok' }
  | { kind: 'unauthorized'; status: number }
  | { kind: 'unreachable'; reason: string };

/**
 * Fast HTTPS probe to confirm the process can actually talk to
 * OpenRouter. Returns within `timeoutMs` either way. Used as a
 * pre-run check so we fail loudly in <8s instead of waiting for
 * the pi SDK's 3× retry + orchestrator's 2× retry (~32s each) to
 * exhaust on every agent.
 *
 * Common failure mode this catches: Docker bridge MTU (1500) > VPN
 * tunnel MTU (~1420). DNS resolves, TCP connects, but the TLS
 * ClientHello packet (with SNI + ALPN extensions for Cloudflare)
 * exceeds the tunnel MTU and is silently dropped because PMTUD is
 * broken across most consumer VPNs.
 */
export async function checkOpenRouterReachable(
  apiKey: string,
  timeoutMs = 8_000,
): Promise<ReachabilityResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { kind: 'unreachable', reason: 'API key is empty' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OPENROUTER_API_BASE}/auth/key`, {
      headers: buildAuthHeaders(trimmed),
      signal: controller.signal,
    });
    if (response.ok) return { kind: 'ok' };
    if (response.status === 401 || response.status === 403) {
      return { kind: 'unauthorized', status: response.status };
    }
    return { kind: 'unreachable', reason: `HTTP ${response.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'unreachable', reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
