import type { AgentFactory } from '../types.js';
import { piAgentFactory } from './pi/factory.js';
import { stubAgentFactory } from './stub/factory.js';
import { azureAgentFactory } from './azure/factory.js';

/**
 * Single dispatch table from "what kind of agent is the user choosing"
 * to a concrete factory. Adding a new backend is a one-line case append
 * here — `cli.tsx` and `Orchestrator` never need to learn about it.
 *
 * The kind names match user-facing CLI flags (`--backend=<kind>`) and
 * the `AppConfig.backend` field, so changing one means changing both
 * intentionally.
 *
 * Only `pi` is surfaced as a backend in the UI; the provider underneath it
 * (OpenRouter or Azure AI Foundry) is chosen via `LlmProvider` and mapped to
 * the concrete dispatch kind by `src/lib/providers.ts` (`azure` is the kind
 * that serves the Azure provider). `stub` is the no-LLM smoke-test backend.
 */
export type AgentBackendKind = 'pi' | 'azure' | 'stub';

export const ALL_BACKENDS: ReadonlyArray<AgentBackendKind> = ['pi', 'azure', 'stub'];

export interface BackendBundle {
  /** Factory used for regular per-task agents. */
  agentFactory: AgentFactory;
  /**
   * Factory used by `runStageIntegrationWithResolver` to resolve merge
   * conflicts. `undefined` for backends that can't reasonably resolve
   * conflicts (stub) — the orchestrator will fail loud on conflict in
   * that case rather than silently shipping a bad merge.
   */
  conflictResolverFactory: AgentFactory | undefined;
  /** Display label used in the TUI backend selector. */
  label: string;
  /** Short description shown under the label. */
  description: string;
  /**
   * `true` when running this backend requires resolving an API key /
   * token before launch. Stub returns `false` so `--stub` can run
   * without OPENROUTER_API_KEY. Used by the App to decide whether to
   * open the api-key prompt screen.
   */
  requiresApiKey: boolean;
  /**
   * Name in `API_KEY_REGISTRY` whose presence the App should validate.
   * `undefined` for backends with no key requirement (stub).
   */
  apiKeySpecName?: string;
  /**
   * Whether this backend appears in the user-facing TUI BackendSelector.
   * `false` means "developer/test-only — only reachable via CLI flag".
   * Stub is the only false today: presenting it in a menu where regular
   * users pick a backend is misleading (a stub run won't actually do
   * the work). Surfaces only when `huu --stub` / `--backend=stub` is
   * explicit on the command line.
   */
  userSelectable: boolean;
}

/**
 * Resolve the bundle for a kind. Throws on unknown kind so a typo in
 * a CLI flag fails loudly rather than silently picking a default.
 */
export function selectBackend(kind: AgentBackendKind): BackendBundle {
  switch (kind) {
    case 'pi':
      return {
        agentFactory: piAgentFactory,
        conflictResolverFactory: piAgentFactory,
        label: 'Pi · OpenRouter',
        description: 'Default. Uses @mariozechner/pi-coding-agent over OpenRouter; pay-per-token.',
        requiresApiKey: true,
        apiKeySpecName: 'openrouter',
        userSelectable: true,
      };
    case 'azure':
      return {
        agentFactory: azureAgentFactory,
        conflictResolverFactory: azureAgentFactory,
        label: 'Pi · Azure AI Foundry',
        description:
          'Azure AI Foundry endpoint (any deployment). Requires API key + endpoint URL from the portal.',
        requiresApiKey: true,
        apiKeySpecName: 'azureApiKey',
        // Reached via the provider selector (LlmProvider='azure'), not as a
        // standalone backend entry — the UI shows providers, not backends.
        userSelectable: false,
      };
    case 'stub':
      return {
        agentFactory: stubAgentFactory,
        conflictResolverFactory: undefined,
        label: 'Stub',
        description: 'No real LLM. Writes STUB_*.md files and emits fake events. Smoke tests, demos.',
        requiresApiKey: false,
        // Test-only: reachable via `huu --stub` or `--backend=stub`,
        // not exposed in the BackendSelector TUI.
        userSelectable: false,
      };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown agent backend: ${String(exhaustive)}`);
    }
  }
}

/**
 * Parse a string into an AgentBackendKind. Accepts canonical kinds plus
 * legacy aliases (e.g. `real` → `pi`). Returns null on unknown input so
 * the caller can produce a friendly error.
 */
export function parseBackendKind(s: string): AgentBackendKind | null {
  const lower = s.trim().toLowerCase();
  if (lower === 'pi' || lower === 'real' || lower === 'openrouter') return 'pi';
  if (lower === 'azure' || lower === 'azure-openai' || lower === 'azure-foundry') return 'azure';
  if (lower === 'stub' || lower === 'fake' || lower === 'mock') return 'stub';
  return null;
}
