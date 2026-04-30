import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import type { AgentFactory, SpawnedAgent } from '../../types.js';
import { supportsThinking } from '../../../lib/model-factory.js';
import {
  fetchModelCapabilities,
  modelSupportsReasoning,
} from '../../../lib/openrouter.js';
import { buildAgentMessageHeader } from '../_shared/build-message.js';
import { createDisposableState } from '../_shared/lifecycle.js';
import { translatePiEvent } from './event-mapper.js';

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/huu',
  'X-OpenRouter-Title': 'huu',
};

async function resolveThinkingLevel(
  modelId: string,
  apiKey: string,
): Promise<'medium' | 'off'> {
  if (supportsThinking(modelId)) return 'medium';
  try {
    const capabilities = await fetchModelCapabilities(apiKey);
    if (modelSupportsReasoning(modelId, capabilities)) return 'medium';
  } catch {
    /* fall through */
  }
  return 'off';
}

export const piAgentFactory: AgentFactory = async (
  task,
  config,
  _systemPromptHint,
  cwd,
  onEvent,
  runtimeContext,
) => {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error('OpenRouter API key ausente. Defina OPENROUTER_API_KEY.');
  const modelId = config.modelId.trim();
  if (!modelId) throw new Error('Model ID ausente.');

  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey('openrouter', apiKey);

  const model = getModel('openrouter', modelId as never);
  if (!model) {
    throw new Error(
      `Modelo "${modelId}" nao encontrado no Pi SDK registry para provider "openrouter". ` +
        `Verifique o ID ou a versao instalada de @mariozechner/pi-ai.`,
    );
  }

  const modelRegistry = ModelRegistry.create(authStorage);
  modelRegistry.registerProvider('openrouter', { headers: OPENROUTER_HEADERS });

  const thinkingLevel = await resolveThinkingLevel(modelId, apiKey);

  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    cwd,
    // tools omitted → default built-ins (read, bash, edit, write) are enabled.
  });

  const unsubscribe = session.subscribe((event: unknown) => {
    try {
      translatePiEvent(event, onEvent);
    } catch (err) {
      onEvent({
        type: 'log',
        level: 'warn',
        message: `event translate error: ${err instanceof Error ? err.message : String(err)}`,
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
      // Pi SDK swallows streamFn errors; re-extract from state.
      const state = (session as unknown as {
        state?: { messages?: Array<{ stopReason?: string; errorMessage?: string }> };
      }).state;
      const lastMsg = state?.messages?.[state.messages.length - 1];
      if (lastMsg?.stopReason === 'error' && lastMsg?.errorMessage) {
        onEvent({ type: 'error', message: lastMsg.errorMessage });
        throw new Error(lastMsg.errorMessage);
      }
      onEvent({ type: 'done' });
    },
    dispose: lifecycle.dispose,
  };

  return spawned;
};
