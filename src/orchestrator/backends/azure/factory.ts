import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from '@mariozechner/pi-coding-agent';
import { getModel, clampThinkingLevel, type Model } from '@mariozechner/pi-ai';
import type { AgentEvent, AgentFactory, SpawnedAgent } from '../../types.js';
import { supportsThinking } from '../../../lib/model-factory.js';
import { checkAzureReachable } from '../../../lib/azure.js';
import { AuthError } from '../../../lib/auth-error.js';
import { buildAgentMessageHeader } from '../_shared/build-message.js';
import { createDisposableState } from '../_shared/lifecycle.js';
import { translatePiEvent } from '../pi/event-mapper.js';
import { pickThinkingLevel } from '../pi/factory.js';

const AZURE_PROVIDER = 'azure-openai-responses' as const;

/**
 * Build a Model object for the Azure `azure-openai-responses` provider.
 *
 * Strategy:
 *   1. Try the Pi SDK's built-in catalog (covers all OpenAI models on Azure).
 *   2. If the model ID is not in the catalog (e.g. Llama-3.3-70B-Instruct,
 *      phi-4, DeepSeek-R1 from the Azure Foundry Marketplace), construct a
 *      minimal model object. The Pi SDK's `streamAzureOpenAIResponses` only
 *      needs `api`, `provider`, and `baseUrl` to be correct; the cost/context
 *      fields are informational only.
 *
 * In both cases we override `baseUrl` with the user-supplied endpoint so the
 * Pi SDK's `resolveAzureConfig` picks it up from `model.baseUrl`.
 */
function buildAzureModel(modelId: string, endpoint: string): Model<'azure-openai-responses'> {
  const catalogModel = getModel(AZURE_PROVIDER, modelId as never) as
    | Model<'azure-openai-responses'>
    | undefined;

  if (catalogModel) {
    return { ...catalogModel, baseUrl: endpoint };
  }

  // Dynamic model: Azure Foundry Marketplace deployment not in Pi SDK catalog.
  return {
    id: modelId,
    name: modelId,
    api: AZURE_PROVIDER,
    provider: AZURE_PROVIDER,
    baseUrl: endpoint,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}

async function resolveThinkingLevel(
  modelId: string,
  onEvent: (e: AgentEvent) => void,
): Promise<'medium' | 'off'> {
  if (supportsThinking(modelId)) return 'medium';
  // Unlike OpenRouter, Azure does not have a /models capability endpoint
  // we can easily probe for reasoning support. Fall back to heuristic only.
  onEvent({
    type: 'log',
    level: 'warn',
    message: `Azure: thinking capability unknown for "${modelId}" — defaulting to thinkingLevel='off'. Add model to model-factory.ts thinkingPrefixes if it supports reasoning.`,
  });
  return 'off';
}

export const azureAgentFactory: AgentFactory = async (
  task,
  config,
  _systemPromptHint,
  cwd,
  onEvent,
  runtimeContext,
) => {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error('Azure API key missing. Set AZURE_OPENAI_API_KEY.');

  const endpoint = config.endpoint?.trim() ?? '';
  if (!endpoint) {
    throw new Error(
      'Azure endpoint URL missing. Set AZURE_OPENAI_BASE_URL or store via the TUI.',
    );
  }
  if (!endpoint.startsWith('https://')) {
    throw new Error(`Azure endpoint must start with https://. Got: ${endpoint}`);
  }

  const modelId = config.modelId.trim();
  if (!modelId) throw new Error('Model ID missing.');

  // Quick reachability probe — fails loudly in <8 s instead of waiting for
  // the Pi SDK's retry chain (~32 s per agent).
  const reach = await checkAzureReachable(apiKey, endpoint);
  if (reach.kind === 'unauthorized') {
    throw new AuthError({
      backendKind: 'azure',
      specName: 'azureApiKey',
      message:
        `Azure endpoint rejected the API key (HTTP ${reach.status}). ` +
        `Update AZURE_OPENAI_API_KEY in the Options screen.`,
    });
  }
  if (reach.kind === 'unreachable') {
    onEvent({
      type: 'log',
      level: 'warn',
      message: `Azure reachability probe failed: ${reach.reason} — proceeding anyway.`,
    });
  }

  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey(AZURE_PROVIDER, apiKey);

  const model = buildAzureModel(modelId, endpoint);

  const modelRegistry = ModelRegistry.create(authStorage);
  modelRegistry.registerProvider(AZURE_PROVIDER, {});

  const baseThinking = await resolveThinkingLevel(modelId, onEvent);
  // The conflict-resolver (integration) agent runs at the model's max thinking
  // level; regular agents keep the base level.
  const thinkingLevel = pickThinkingLevel(
    baseThinking,
    runtimeContext?.maxThinking ?? false,
    clampThinkingLevel(model, 'xhigh'),
  );

  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    cwd,
  });

  const unsubscribe = session.subscribe((event: unknown) => {
    try {
      translatePiEvent(event, onEvent);
    } catch (err) {
      onEvent({
        type: 'log',
        level: 'warn',
        message: `Azure event translate error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  const lifecycle = createDisposableState([
    () => unsubscribe(),
    () => session.dispose(),
  ]);

  const spawned: SpawnedAgent = {
    agentId: task.agentId,
    task,
    async abort(): Promise<void> {
      if (lifecycle.isDisposed()) return;
      try {
        await session.abort();
      } catch {
        /* best-effort */
      }
    },
    async prompt(message: string): Promise<void> {
      lifecycle.assertLive();
      const fullMessage = buildAgentMessageHeader(
        task,
        message,
        cwd,
        runtimeContext?.ports,
        runtimeContext?.shimAvailable ?? false,
      );
      try {
        await session.prompt(fullMessage);
      } catch (err) {
        onEvent({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      const stateErr = session.state.errorMessage;
      if (stateErr) {
        onEvent({ type: 'error', message: stateErr });
        throw new Error(stateErr);
      }
      onEvent({ type: 'done' });
    },
    dispose: lifecycle.dispose,
  };

  return spawned;
};
