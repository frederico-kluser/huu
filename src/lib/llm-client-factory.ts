/**
 * Backend-aware LangChain client factory.
 *
 * The three "helper" features in huu — Pipeline Assistant, Smart File Select,
 * and Project Recon — all use LangChain's `ChatOpenAI`. Historically they
 * hard-coded the OpenRouter base URL, which means even when a user picked
 * `--backend=azure` (or `copilot`), the helpers still hit OpenRouter and
 * generated charges on the wrong account.
 *
 * This factory centralizes client construction so every helper builds its
 * `ChatOpenAI` against the SAME backend the user picked for agent execution.
 *
 * Routing matrix:
 *   - `pi`      → OpenRouter (https://openrouter.ai/api/v1, Authorization: Bearer)
 *   - `azure`   → Azure AI Foundry v1 endpoint, `api-key:` header (NOT Bearer)
 *   - `copilot` → OpenRouter (pre-existing fallback — Copilot has no public
 *                 generic-completion API; helpers continue to use OpenRouter
 *                 unless we add a dedicated copilot path)
 *   - `stub`    → caller short-circuits; never reaches this factory
 */
import { ChatOpenAI } from '@langchain/openai';
import type { AgentBackendKind } from './types.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/frederico-kluser/huu',
  'X-OpenRouter-Title': 'huu',
};

export interface LlmClientContext {
  /** Backend the user selected. Drives routing decisions. */
  backend: AgentBackendKind;
  /** OpenRouter API key (used when backend === 'pi' or 'copilot' fallback). */
  openrouterApiKey?: string;
  /** Azure API key (used when backend === 'azure'). */
  azureApiKey?: string;
  /**
   * Azure base URL — full endpoint up to `/openai/v1/` (e.g.
   * `https://my-resource.openai.azure.com/openai/v1/`). Required when
   * backend === 'azure'.
   */
  azureEndpoint?: string;
}

export interface ChatClientOptions {
  modelId: string;
  temperature?: number;
  /** Cap completion tokens — used by helpers that only need short JSON output. */
  maxTokens?: number;
}

/**
 * Build a `ChatOpenAI` instance bound to the right provider for the given
 * backend. Throws if required credentials are missing.
 *
 * Azure note: Azure AI Foundry v1 endpoints expect the API key in the
 * `api-key:` header, NOT in `Authorization: Bearer`. The OpenAI SDK only
 * adds Bearer when given a non-empty `apiKey`, so we pass a non-empty
 * placeholder there and override via `defaultHeaders` — both headers are
 * sent, but Azure honors `api-key:` and ignores the Bearer one.
 */
export function buildChatClient(
  ctx: LlmClientContext,
  opts: ChatClientOptions,
): ChatOpenAI {
  const modelId = opts.modelId.trim();
  if (!modelId) throw new Error('llm-client-factory: modelId is empty.');

  if (ctx.backend === 'azure') {
    const apiKey = ctx.azureApiKey?.trim() ?? '';
    const endpoint = ctx.azureEndpoint?.trim() ?? '';
    if (!apiKey) {
      throw new Error(
        'Azure API key missing. Set AZURE_OPENAI_API_KEY or mount /run/secrets/azure_openai_api_key.',
      );
    }
    if (!endpoint) {
      throw new Error(
        'Azure endpoint URL missing. Set AZURE_OPENAI_BASE_URL or mount /run/secrets/azure_openai_base_url.',
      );
    }
    // Normalize: ensure trailing slash so LangChain/OpenAI SDK appends paths cleanly.
    const baseURL = endpoint.replace(/\/+$/, '') + '/';

    return new ChatOpenAI({
      model: modelId,
      temperature: opts.temperature ?? 0.4,
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      configuration: {
        baseURL,
        apiKey, // SDK adds Authorization: Bearer; Azure ignores this when api-key is set
        defaultHeaders: {
          'api-key': apiKey,
        },
        // The OpenAI SDK appends ?api-version=... only for AzureOpenAI client;
        // for plain ChatOpenAI on the Azure v1 endpoint, the version is part of
        // the URL ("/openai/v1/"), so we don't need extra query params.
      },
    });
  }

  // pi (OpenRouter) and copilot (fallback to OpenRouter for helpers — Copilot
  // doesn't expose a generic chat-completion API for the assistant features).
  const apiKey = ctx.openrouterApiKey?.trim() ?? '';
  if (!apiKey) {
    throw new Error(
      'OpenRouter API key missing. Set OPENROUTER_API_KEY or mount /run/secrets/openrouter_api_key.',
    );
  }
  return new ChatOpenAI({
    model: modelId,
    temperature: opts.temperature ?? 0.4,
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      defaultHeaders: OPENROUTER_HEADERS,
    },
  });
}

/**
 * Resolve a sensible default helper-model ID for the given backend.
 * OpenRouter: kimi-k2.6 (cheap, schema-following). Azure: gpt-4o-mini.
 */
export function defaultHelperModel(backend: AgentBackendKind): string {
  if (backend === 'azure') return 'gpt-4o-mini';
  return 'moonshotai/kimi-k2.6';
}
