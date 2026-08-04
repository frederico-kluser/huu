// Trimmed from pi-orq/src/lib/types.ts — guided-execution-only.
// Removed: parallel/dag/autonomous modes, retries, scaling, safety model, per-step modelId.

/**
 * Which agent SDK is driving execution. The list is duplicated in
 * `src/orchestrator/backends/registry.ts` (as `AgentBackendKind`) — the
 * canonical declaration lives there because it's tightly coupled to the
 * factory dispatch. This local alias avoids a `lib/` → `orchestrator/`
 * import cycle (lib imports must stay backend-agnostic).
 *
 * Only `pi` is user-facing — the LLM provider underneath it (OpenRouter or
 * Azure AI Foundry) is chosen via {@link LlmProvider}. `azure` is the
 * internal dispatch kind backing the Azure provider; `stub` is the no-LLM
 * smoke-test backend. (Copilot was removed in v2.2 — huu is pi-only.)
 */
export type AgentBackendKind = 'pi' | 'azure' | 'stub' | 'jcode';

/**
 * The LLM provider the (single, user-facing) pi backend talks to. This is
 * the choice surfaced in the UI: "Pi → OpenRouter" or "Pi → Azure AI
 * Foundry". `src/orchestrator/backends/registry.ts` maps each provider to
 * the concrete {@link AgentBackendKind} that serves it (`openrouter` → `pi`,
 * `azure` → `azure`).
 */
export type LlmProvider = 'openrouter' | 'azure';

export interface AppConfig {
  apiKey: string;
  modelId: string;
  budgetUsd?: number;
  /**
   * Optional backend-specific endpoint URL. Used by the Azure provider to
   * pass the Azure AI Foundry endpoint (e.g.
   * `https://my.openai.azure.com/openai/v1/`) to the agent factory.
   * The OpenRouter provider ignores this field.
   */
  endpoint?: string;
  /**
   * Optional. Default `'pi'`. The concrete dispatch kind. Usually derived
   * from {@link AppConfig.provider} via `providerToBackend()`; set directly
   * only by `--backend=` / `--stub`.
   */
  backend?: AgentBackendKind;
  /**
   * Optional. Default `'openrouter'`. The user-facing provider choice for
   * the pi backend. Drives api-key resolution (which spec is required) and
   * model-catalog filtering.
   */
  provider?: LlmProvider;
  /**
   * Optional. Where {@link AppConfig.apiKey} actually came from, when the
   * caller knows. `'request'` = sent by the browser with this run (web
   * sessionStorage key); `'options'` = saved via the web ⚙ Options this
   * server session; the remaining values mirror the `lib/api-key` resolver
   * tiers. Error paths (e.g. the OpenRouter 401 preflight) use it to blame
   * the key that was ACTUALLY used — re-running the resolver at error time
   * misattributes when the run carried its own key.
   */
  apiKeySource?:
    | 'request'
    | 'options'
    | 'secret-mount'
    | 'stored'
    | 'env-file'
    | 'env'
    | 'none';
}

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  selected?: boolean;
  expanded?: boolean;
}

// ── Domain re-exports ────────────────────────────────────────────────

export * from './types/pipeline.js';
export * from './types/orchestrator.js';
export * from './types/git.js';
export * from './types/dev-mode.js';

