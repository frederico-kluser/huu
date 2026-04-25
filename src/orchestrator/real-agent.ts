import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import type { AgentFactory, AgentEvent, SpawnedAgent } from './types.js';
import { generateAgentSystemPrompt } from './agents-md-generator.js';
import { supportsThinking } from '../lib/model-factory.js';
import { fetchModelCapabilities, modelSupportsReasoning } from '../lib/openrouter.js';

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/programatic-agent',
  'X-OpenRouter-Title': 'programatic-agent',
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

function extractFileFromArgs(args: any): string | null {
  if (!args || typeof args !== 'object') return null;
  if (typeof args.path === 'string') return args.path;
  if (typeof args.file_path === 'string') return args.file_path;
  if (typeof args.filePath === 'string') return args.filePath;
  return null;
}

const WRITE_TOOLS = new Set(['edit', 'write', 'create', 'patch']);

function translateEvent(event: any, onEvent: (e: AgentEvent) => void): void {
  if (!event || typeof event !== 'object') return;

  switch (event.type) {
    case 'agent_start':
      onEvent({ type: 'state_change', state: 'streaming' });
      onEvent({ type: 'log', message: 'agent started' });
      break;

    case 'tool_execution_start': {
      const file = extractFileFromArgs(event.args);
      const msg = `tool: ${event.toolName}${file ? ` → ${file}` : ''}`;
      onEvent({ type: 'state_change', state: 'tool_running' });
      onEvent({ type: 'log', message: msg });
      if (file && WRITE_TOOLS.has(String(event.toolName).toLowerCase())) {
        onEvent({ type: 'file_write', file });
      }
      break;
    }

    case 'tool_execution_end':
      onEvent({ type: 'state_change', state: 'streaming' });
      if (event.isError) {
        onEvent({ type: 'log', level: 'error', message: `tool error: ${event.toolName}` });
      } else {
        onEvent({ type: 'log', message: `tool done: ${event.toolName}` });
      }
      break;

    case 'message_end': {
      const usage = event.message?.usage ?? event.usage;
      if (usage) {
        const inp = usage.input ?? usage.inputTokens ?? 0;
        const out = usage.output ?? usage.outputTokens ?? 0;
        const cost = usage.cost?.total ?? 0;
        onEvent({
          type: 'log',
          message: `tokens +${inp}in +${out}out${cost > 0 ? ` $${cost.toFixed(6)}` : ''}`,
        });
      }
      break;
    }

    case 'agent_end':
      onEvent({ type: 'log', message: 'agent finished' });
      break;

    case 'auto_compaction_start':
      onEvent({ type: 'log', level: 'warn', message: `auto-compaction: ${event.reason ?? ''}` });
      break;

    case 'error':
      onEvent({ type: 'error', message: event.message ?? 'unknown error' });
      break;
  }
}

/**
 * Builds the full message sent to the agent: instructions header (role, scope, rules)
 * + the user's actual prompt. Pi SDK >=0.70 doesn't expose setSystemPrompt anymore,
 * so we embed our role context directly in the user message.
 */
function buildFullMessage(
  agentId: number,
  files: string[],
  userPrompt: string,
  branchName: string,
  worktreePath: string,
): string {
  const header = generateAgentSystemPrompt(agentId, files, userPrompt, branchName, worktreePath);
  return header;
}

export const realAgentFactory: AgentFactory = async (
  task,
  config,
  _systemPromptHint,
  cwd,
  onEvent,
) => {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error('OpenRouter API key ausente. Defina OPENROUTER_API_KEY.');
  const modelId = config.modelId.trim();
  if (!modelId) throw new Error('Model ID ausente.');

  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey('openrouter', apiKey);

  const model = getModel('openrouter', modelId as any);
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

  const unsubscribe = session.subscribe((event: any) => {
    try {
      translateEvent(event, onEvent);
    } catch (err) {
      onEvent({
        type: 'log',
        level: 'warn',
        message: `event translate error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  let disposed = false;

  const spawned: SpawnedAgent = {
    agentId: task.agentId,
    task,
    async prompt(message: string): Promise<void> {
      if (disposed) throw new Error('agent already disposed');
      const fullMessage = buildFullMessage(
        task.agentId,
        task.files,
        message,
        task.branchName,
        cwd,
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
      const state = (session as any).state;
      const lastMsg = state?.messages?.[state.messages.length - 1];
      if (lastMsg?.stopReason === 'error' && lastMsg?.errorMessage) {
        onEvent({ type: 'error', message: lastMsg.errorMessage });
        throw new Error(lastMsg.errorMessage);
      }
      onEvent({ type: 'done' });
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        unsubscribe();
      } catch {
        /* best effort */
      }
      try {
        session.dispose();
      } catch {
        /* best effort */
      }
      const ref = spawned as unknown as { task: unknown };
      ref.task = null;
    },
  };

  return spawned;
};
