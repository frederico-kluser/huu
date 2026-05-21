import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import type { AgentEvent, AgentFactory, SpawnedAgent } from '../../types.js';
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
  onEvent: (e: AgentEvent) => void,
): Promise<'medium' | 'off'> {
  if (supportsThinking(modelId)) return 'medium';
  try {
    const capabilities = await fetchModelCapabilities(apiKey);
    if (modelSupportsReasoning(modelId, capabilities)) return 'medium';
    return 'off';
  } catch (err) {
    // Capability probe failed (network blip, OpenRouter 5xx, rate limit).
    // Without this log, the user picks a thinking-capable model, pays for
    // it, and silently gets non-thinking responses.
    onEvent({
      type: 'log',
      level: 'warn',
      message: `thinking capability check failed for ${modelId}: ${
        err instanceof Error ? err.message : String(err)
      } — defaulting to thinkingLevel='off'`,
    });
    return 'off';
  }
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
      `Model "${modelId}" not found in the Pi SDK registry for provider "openrouter". ` +
        `Check the ID or the installed version of @mariozechner/pi-ai.`,
    );
  }

  const modelRegistry = ModelRegistry.create(authStorage);
  modelRegistry.registerProvider('openrouter', { headers: OPENROUTER_HEADERS });

  const thinkingLevel = await resolveThinkingLevel(modelId, apiKey, onEvent);

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
    async abort(): Promise<void> {
      if (lifecycle.isDisposed()) return;
      try {
        await session.abort();
      } catch {
        /* best-effort — dispose() will still try */
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
      // Defensive: pi 0.73.x propagates most provider errors via `prompt()`
      // rejection (the 0.71 fix for Anthropic SSE truncation), but the
      // public AgentState.errorMessage is still set on aborted/error
      // turns. Reading the public getter (no `as unknown` cast) ensures we
      // surface anything the SDK left without throwing.
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
