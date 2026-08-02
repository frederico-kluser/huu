/**
 * Minimal Azure AI Foundry connectivity helpers.
 *
 * The reachability probe mirrors `checkOpenRouterReachable` in openrouter.ts:
 * it makes one authenticated request to the user's Azure endpoint and returns
 * a typed result so the caller can fail loudly in <8 s instead of waiting for
 * the Pi SDK's retry chain (~32 s per agent).
 *
 * Azure endpoint convention for the v1 Foundry path:
 *   https://<resource>.openai.azure.com/openai/v1/
 *
 * The probe hits `/models` which is always available and requires auth.
 */

export type ReachabilityResult =
  | { kind: 'ok' }
  | { kind: 'unauthorized'; status: number }
  | { kind: 'unreachable'; reason: string };

/**
 * Validate that `endpoint` looks like a plausible Azure Foundry URL.
 * Returns an error string on failure, `undefined` on success.
 */
export function validateAzureEndpoint(endpoint: string): string | undefined {
  const trimmed = endpoint.trim();
  if (!trimmed) return 'Azure endpoint URL is empty.';
  if (!trimmed.startsWith('https://')) return 'Azure endpoint must start with https://';
  try {
    new URL(trimmed);
  } catch {
    return `Azure endpoint is not a valid URL: ${trimmed}`;
  }
  return undefined;
}

/**
 * Fast HTTPS probe to confirm the process can talk to the Azure endpoint.
 * Hits `/models` on the base URL (OpenAI-compatible list endpoint).
 * Returns within `timeoutMs` either way.
 */
export async function checkAzureReachable(
  apiKey: string,
  endpoint: string,
  timeoutMs = 8_000,
): Promise<ReachabilityResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) return { kind: 'unreachable', reason: 'Azure API key is empty' };

  const endpointErr = validateAzureEndpoint(endpoint);
  if (endpointErr) return { kind: 'unreachable', reason: endpointErr };

  const base = endpoint.trim().replace(/\/$/, '');
  const url = `${base}/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'api-key': trimmedKey,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (response.ok) return { kind: 'ok' };
    if (response.status === 401 || response.status === 403) {
      return { kind: 'unauthorized', status: response.status };
    }
    // 404 on /models can happen on some resource types — still means reachable.
    if (response.status === 404) return { kind: 'ok' };
    return { kind: 'unreachable', reason: `HTTP ${response.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'unreachable', reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
