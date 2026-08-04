/**
 * LLM provider model for the jcode backend.
 *
 * huu exposes ONE backend — jcode — backed by DeepSeek as the provider.
 * Internally the provider maps to the concrete {@link AgentBackendKind} `'jcode'`.
 *
 * This lives in `lib/` (not the backend registry) so every layer — api-key
 * resolution, the model catalog, the TUI and the web API — can import the
 * mapping without an upward `lib → orchestrator` dependency.
 */
import type { AgentBackendKind } from './types.js';

/** The single LLM provider backing the jcode backend. */
export type LlmProvider = 'deepseek';

export interface ProviderInfo {
  id: LlmProvider;
  /** Concrete dispatch backend that serves this provider. */
  backend: AgentBackendKind;
  /** Short label shown in the provider selector. */
  label: string;
  /** One-line description shown under the label. */
  description: string;
  /** `API_KEY_REGISTRY` name of the credential this provider needs. */
  apiKeySpecName: string;
  /** `API_KEY_REGISTRY` name of the endpoint-URL spec, when the provider needs one. */
  endpointSpecName?: string;
}

/** Ordered list of user-selectable providers (drives the selector). */
export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'deepseek',
    backend: 'jcode',
    label: 'DeepSeek',
    description: 'DeepSeek V4 Pro via jcode subprocess. Pay-per-token. Key from platform.deepseek.com.',
    apiKeySpecName: 'deepseek',
  },
];

export const DEFAULT_PROVIDER: LlmProvider = 'deepseek';

/** Look up a provider descriptor. Throws on unknown id (programming error). */
export function providerInfo(p: LlmProvider): ProviderInfo {
  const info = PROVIDERS.find((x) => x.id === p);
  if (!info) throw new Error(`Unknown LLM provider: ${String(p)}`);
  return info;
}

/** The concrete dispatch backend that serves a provider. */
export function providerToBackend(p: LlmProvider): AgentBackendKind {
  return providerInfo(p).backend;
}

/** The provider a dispatch backend belongs to (`stub` maps to DeepSeek). */
export function backendToProvider(b: AgentBackendKind): LlmProvider {
  return 'deepseek';
}

/** Parse a CLI/string value into a provider, or null when unrecognized. */
export function parseProvider(s: string): LlmProvider | null {
  const lower = s.trim().toLowerCase();
  if (lower === 'deepseek' || lower === 'ds') return 'deepseek';
  return null;
}
