import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  AssistantTurnSchema,
  validateQuestionShape,
  type AssistantTurn,
  type PipelineDraft,
} from './assistant-schema.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/frederico-kluser/huu',
  'X-OpenRouter-Title': 'huu',
};

export const DEFAULT_ASSISTANT_MODEL = 'moonshotai/kimi-k2.6';

export interface AssistantChat {
  modelId: string;
  /**
   * Run one turn through the structured-output pipeline. Throws if Zod
   * validation fails (caller decides whether to retry with a correction
   * message or surface the error).
   */
  invokeStructured(messages: BaseMessage[]): Promise<AssistantTurn>;
}

export interface CreateAssistantChatOptions {
  apiKey: string;
  modelId?: string;
  temperature?: number;
}

export { AIMessage, HumanMessage, SystemMessage };
export type { BaseMessage };

/**
 * Bind LangChain's ChatOpenAI to OpenRouter and wrap it with structured-output
 * enforcement against `AssistantTurnSchema`. Returns a stub that emits a
 * deterministic 3-turn-then-pipeline sequence when running with `--stub` (or
 * `HUU_LANGCHAIN_STUB=1`) so smoke tests never touch the network.
 */
export function createAssistantChat(opts: CreateAssistantChatOptions): AssistantChat {
  if (process.env.HUU_LANGCHAIN_STUB === '1' || opts.apiKey.trim() === 'stub') {
    return new StubAssistantChat();
  }

  const apiKey = opts.apiKey.trim();
  if (!apiKey) {
    throw new Error(
      'OpenRouter API key ausente. Defina OPENROUTER_API_KEY ou monte /run/secrets/openrouter_api_key.',
    );
  }
  const modelId = (opts.modelId ?? DEFAULT_ASSISTANT_MODEL).trim();
  if (!modelId) throw new Error('assistant modelId vazio.');

  const chat = new ChatOpenAI({
    model: modelId,
    temperature: opts.temperature ?? 0.4,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      defaultHeaders: OPENROUTER_HEADERS,
    },
  });

  const structured = chat.withStructuredOutput(AssistantTurnSchema, {
    name: 'AssistantTurn',
    method: 'functionCalling',
  });

  return {
    modelId,
    async invokeStructured(messages: BaseMessage[]): Promise<AssistantTurn> {
      const result = (await structured.invoke(messages)) as AssistantTurn;
      const parsed = AssistantTurnSchema.parse(result);
      if (parsed.done === false) validateQuestionShape(parsed);
      return parsed;
    },
  };
}

/**
 * Stub implementation: 3 canned questions followed by a canned pipeline.
 * Mirrors the AssistantTurn schema exactly. Used by `--stub` runs and by the
 * unit tests below — the assistant TUI never calls the network in either.
 */
class StubAssistantChat implements AssistantChat {
  modelId = 'stub/assistant';
  private turn = 0;

  async invokeStructured(_messages: BaseMessage[]): Promise<AssistantTurn> {
    this.turn += 1;
    if (this.turn === 1) {
      return {
        done: false,
        question: 'Qual a granularidade da pipeline?',
        rationale: 'Stub: pergunta 1 fixa.',
        options: [
          { label: 'Projeto inteiro (1 step, 1 agent)' },
          { label: 'Por arquivo (N agents em paralelo)' },
          { label: 'Outra opção (digite)', isFreeText: true },
        ],
      };
    }
    if (this.turn === 2) {
      return {
        done: false,
        question: 'Quantos steps?',
        options: [
          { label: '1 step' },
          { label: '2 steps' },
          { label: '3 steps' },
          { label: 'Outra opção (digite)', isFreeText: true },
        ],
      };
    }
    if (this.turn === 3) {
      return {
        done: false,
        question: 'Modelo principal?',
        options: [
          { label: 'Kimi K2.6 (default)' },
          { label: 'GPT-5.4 Mini (mais barato)' },
          { label: 'Outra opção (digite)', isFreeText: true },
        ],
      };
    }
    const draft: PipelineDraft = {
      name: 'stub-pipeline',
      steps: [
        {
          name: 'step-1',
          prompt: 'Stub step prompt — substitua antes de rodar com modelo real.',
          scope: 'project',
        },
      ],
    };
    return { done: true, pipeline: draft };
  }
}
