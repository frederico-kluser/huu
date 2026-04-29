import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/huu',
  'X-OpenRouter-Title': 'huu',
};

export const DEFAULT_REFINEMENT_MODEL = 'moonshotai/kimi-k2.6';

export interface RefinementChat {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
  modelId: string;
}

export interface CreateRefinementChatOptions {
  apiKey: string;
  modelId?: string;
  /** Enable OpenRouter `reasoning` parameter (extra tokens billed). Default false. */
  reasoning?: boolean;
  temperature?: number;
}

class StubRefinementChat implements RefinementChat {
  modelId = 'stub/refinement';
  private turn = 0;

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.turn += 1;
    const lastUserText = lastUserMessageText(messages);
    if (this.turn === 1) {
      return new AIMessage(
        `Stub: entendi que você quer "${truncate(lastUserText, 80)}". Quer me dar um exemplo concreto do resultado esperado?`,
      );
    }
    if (this.turn === 2) {
      return new AIMessage('Stub: ok, e qual a restrição mais importante? (formato, performance, escopo de arquivos)');
    }
    return new AIMessage(
      `Stub-refined: ${truncate(lastUserText, 200)}`,
    );
  }
}

function lastUserMessageText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m._getType() === 'human') {
      const c = m.content;
      return typeof c === 'string' ? c : JSON.stringify(c);
    }
  }
  return '';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * Builds a LangChain.js chat model bound to OpenRouter. Uses ChatOpenAI with a
 * custom baseURL — the documented integration path. Returns a stub that emits
 * deterministic turns when `HUU_LANGCHAIN_STUB=1` so tests and `--stub` runs
 * never touch the network.
 */
export function createRefinementChat(opts: CreateRefinementChatOptions): RefinementChat {
  // The TUI passes 'stub' as apiKey when running with --stub / no real key.
  // Mirror that contract so stub runs never reach the network.
  if (process.env.HUU_LANGCHAIN_STUB === '1' || opts.apiKey.trim() === 'stub') {
    return new StubRefinementChat();
  }

  const apiKey = opts.apiKey.trim();
  if (!apiKey) {
    throw new Error('OpenRouter API key ausente. Defina OPENROUTER_API_KEY ou monte /run/secrets/openrouter_api_key.');
  }
  const modelId = (opts.modelId ?? DEFAULT_REFINEMENT_MODEL).trim();
  if (!modelId) throw new Error('refinementModel vazio.');

  const modelKwargs: Record<string, unknown> = {};
  if (opts.reasoning) modelKwargs.reasoning = { effort: 'medium' };

  const chat = new ChatOpenAI({
    model: modelId,
    temperature: opts.temperature ?? 0.7,
    modelKwargs,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      defaultHeaders: OPENROUTER_HEADERS,
    },
  });

  return {
    modelId,
    async invoke(messages: BaseMessage[]): Promise<AIMessage> {
      const result = await chat.invoke(messages);
      return result as AIMessage;
    },
  };
}
