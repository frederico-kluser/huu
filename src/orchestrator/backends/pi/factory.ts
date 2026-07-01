import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from '@mariozechner/pi-coding-agent';
import { getModel, clampThinkingLevel, type ModelThinkingLevel } from '@mariozechner/pi-ai';
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

/** Ascending strength order of the Pi SDK thinking levels. */
const THINKING_LEVEL_ORDER: ModelThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

/**
 * Pick the effective thinking level for an agent. `base` is what we'd use
 * normally (from `resolveThinkingLevel`). When `maxThinking` is requested
 * (the conflict-resolver agent) and the model actually reasons, bump up to
 * the model's true maximum (`modelMax`, from `clampThinkingLevel(model,
 * 'xhigh')`) — but NEVER below `base`, so a model that only supports a low
 * level can't accidentally downgrade the resolver, and a non-thinking model
 * (`base === 'off'`) stays off. Pure + networkless, so it is unit-tested.
 */
export function pickThinkingLevel(
  base: ModelThinkingLevel,
  maxThinking: boolean,
  modelMax: ModelThinkingLevel,
): ModelThinkingLevel {
  if (!maxThinking || base === 'off') return base;
  return THINKING_LEVEL_ORDER.indexOf(modelMax) > THINKING_LEVEL_ORDER.indexOf(base)
    ? modelMax
    : base;
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
  if (!apiKey) throw new Error('OpenRouter API key missing. Set OPENROUTER_API_KEY.');
  const modelId = config.modelId.trim();
  if (!modelId) throw new Error('Model ID missing.');

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

  const baseThinking = await resolveThinkingLevel(modelId, apiKey, onEvent);
  // The conflict-resolver (integration) agent runs at the model's max thinking
  // level; regular agents keep the base level.
  const thinkingLevel = pickThinkingLevel(
    baseThinking,
    runtimeContext?.maxThinking ?? false,
    clampThinkingLevel(model, 'xhigh'),
  );

  // Fase 2.3: persist the session so a memory-guard preemption can PAUSE this
  // agent (checkpoint → reconstruct later) instead of killing it. The JSONL
  // transcript MUST live OUTSIDE the agent worktree (`cwd`) — otherwise the
  // finalize step's `git stageAll` would commit pi's transcript into the user's
  // repo. `dirname(cwd)` is the run's worktree root (.huu-worktrees/<runId>/),
  // so `.huu-sessions/<agent-dir>/` is a sibling that the run teardown cleans
  // along with the worktrees. When `restoreSessionPath` is set (resume), we
  // OPEN that file instead so the agent continues from its prior transcript;
  // `cwdOverride = cwd` re-points it at the (reused) worktree. Verified end to
  // end by the P0 runtime spike (abort mid-task → open → continue, no redo).
  const sessionDir = join(dirname(cwd), '.huu-sessions', basename(cwd));
  const restorePath = runtimeContext?.restoreSessionPath;
  const sessionManager =
    restorePath && existsSync(restorePath)
      ? SessionManager.open(restorePath, undefined, cwd)
      : SessionManager.create(cwd, sessionDir);

  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    sessionManager,
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
    async checkpoint(): Promise<string | null> {
      // Fase 2.3 pause hook. Return a pointer to the persisted transcript so the
      // orchestrator can resume this agent later (via restoreSessionPath).
      // Completed turns are already flushed to the JSONL on each message_end; an
      // in-flight turn is NOT, and is simply re-attempted on resume. We do NOT
      // abort or dispose here — the caller disposes immediately after (mirrors
      // destroyAgent's dispose→reject, so no extra interception is needed). When
      // nothing durable exists yet, return null so the caller falls back to
      // kill+requeue (never a regression).
      if (lifecycle.isDisposed()) return null;
      try {
        const file = session.sessionFile;
        if (file && existsSync(file) && statSync(file).size > 0) return file;
      } catch {
        /* unreadable session file → null → caller falls back to destroyAgent */
      }
      return null;
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
