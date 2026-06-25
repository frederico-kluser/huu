/**
 * LLM provider model for the (single, user-facing) pi backend.
 *
 * huu exposes ONE backend — pi — and lets the user choose the provider that
 * sits underneath it: OpenRouter or Azure AI Foundry. Internally each
 * provider maps to a concrete {@link AgentBackendKind} that owns the agent
 * factory (`openrouter` → `pi`, `azure` → `azure`). The UI only ever shows
 * providers; backends are an implementation detail.
 *
 * This lives in `lib/` (not the backend registry) so every layer — api-key
 * resolution, the model catalog, the TUI and the web API — can import the
 * mapping without an upward `lib → orchestrator` dependency.
 */
import type { AgentBackendKind, LlmProvider } from './types.js';

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
  /** `API_KEY_REGISTRY` name of the endpoint-URL spec, when the provider needs one (Azure). */
  endpointSpecName?: string;
}

/** Ordered list of user-selectable providers (drives the selector). */
export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'openrouter',
    backend: 'pi',
    label: 'OpenRouter',
    description: 'Pay-per-token access to open + frontier models. Key starts with sk-or-.',
    apiKeySpecName: 'openrouter',
  },
  {
    id: 'azure',
    backend: 'azure',
    label: 'Azure AI Foundry',
    description: 'Your own Azure deployment. Needs an API key + endpoint URL from the portal.',
    apiKeySpecName: 'azureApiKey',
    endpointSpecName: 'azureEndpoint',
  },
];

export const DEFAULT_PROVIDER: LlmProvider = 'openrouter';

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

/** The provider a dispatch backend belongs to (`stub` maps to OpenRouter). */
export function backendToProvider(b: AgentBackendKind): LlmProvider {
  return b === 'azure' ? 'azure' : 'openrouter';
}

/** Parse a CLI/string value into a provider, or null when unrecognized. */
export function parseProvider(s: string): LlmProvider | null {
  const lower = s.trim().toLowerCase();
  if (lower === 'openrouter' || lower === 'or' || lower === 'router') return 'openrouter';
  if (lower === 'azure' || lower === 'azure-foundry' || lower === 'foundry' || lower === 'azure-ai-foundry') {
    return 'azure';
  }
  return null;
}
