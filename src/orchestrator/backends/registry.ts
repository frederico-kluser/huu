import type { AgentFactory } from '../types.js';
import { piAgentFactory } from './pi/factory.js';
import { stubAgentFactory } from './stub/factory.js';
import { copilotAgentFactory } from './copilot/factory.js';

/**
 * Single dispatch table from "what kind of agent is the user choosing"
 * to a concrete factory. Adding a new backend is a one-line case append
 * here — `cli.tsx` and `Orchestrator` never need to learn about it.
 *
 * The kind names match user-facing CLI flags (`--backend=<kind>`) and
 * the `AppConfig.backend` field, so changing one means changing both
 * intentionally.
 */
export type AgentBackendKind = 'pi' | 'copilot' | 'stub';

export const ALL_BACKENDS: ReadonlyArray<AgentBackendKind> = ['pi', 'copilot', 'stub'];

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
        label: 'Pi (OpenRouter)',
        description: 'Default. Uses @mariozechner/pi-coding-agent over OpenRouter; pay-per-token.',
        requiresApiKey: true,
        apiKeySpecName: 'openrouter',
      };
    case 'copilot':
      return {
        agentFactory: copilotAgentFactory,
        conflictResolverFactory: copilotAgentFactory,
        label: 'GitHub Copilot',
        description: 'Uses @github/copilot-sdk; subscription-based with premium-request quota.',
        requiresApiKey: true,
        apiKeySpecName: 'copilot',
      };
    case 'stub':
      return {
        agentFactory: stubAgentFactory,
        conflictResolverFactory: undefined,
        label: 'Stub',
        description: 'No real LLM. Writes STUB_*.md files and emits fake events. Smoke tests, demos.',
        requiresApiKey: false,
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
  if (lower === 'copilot' || lower === 'gh-copilot' || lower === 'github-copilot') {
    return 'copilot';
  }
  if (lower === 'stub' || lower === 'fake' || lower === 'mock') return 'stub';
  return null;
}
