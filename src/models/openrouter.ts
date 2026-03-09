// ── OpenRouter Client ────────────────────────────────────────────────
// Wraps the OpenAI SDK to communicate with OpenRouter's API.
// OpenRouter provides an OpenAI-compatible endpoint at https://openrouter.ai/api/v1

import OpenAI from 'openai';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_KEY_PREFIX = 'sk-or-v1-';

// ── Validation ───────────────────────────────────────────────────────

/**
 * Validate OpenRouter API key format.
 * Keys start with "sk-or-v1-" and are at least 40 characters.
 */
export function validateOpenRouterKey(key: string): { valid: boolean; error?: string } {
  const trimmed = key.trim();

  if (!trimmed) {
    return { valid: false, error: 'API key cannot be empty' };
  }

  if (!trimmed.startsWith(OPENROUTER_KEY_PREFIX)) {
    return { valid: false, error: `API key must start with "${OPENROUTER_KEY_PREFIX}"` };
  }

  if (trimmed.length < 40) {
    return { valid: false, error: 'API key seems too short (expected 40+ characters)' };
  }

  return { valid: true };
}

/**
 * Verify an OpenRouter API key by making a lightweight API call.
 * Returns true if the key is valid and has credits available.
 */
export async function verifyOpenRouterKey(key: string): Promise<{ valid: boolean; error?: string }> {
  const formatCheck = validateOpenRouterKey(key);
  if (!formatCheck.valid) return formatCheck;

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/auth/key`, {
      headers: {
        'Authorization': `Bearer ${key.trim()}`,
      },
    });

    if (response.ok) {
      return { valid: true };
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key — authentication failed' };
    }

    if (response.status === 402) {
      return { valid: false, error: 'API key valid but no credits available' };
    }

    return { valid: false, error: `OpenRouter returned status ${response.status}` };
  } catch (err) {
    return {
      valid: false,
      error: `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Client Factory ───────────────────────────────────────────────────

/**
 * Create an OpenAI-compatible client configured for OpenRouter.
 * Uses the OPENROUTER_API_KEY environment variable if no key is provided.
 */
export function createOpenRouterClient(apiKey?: string): OpenAI {
  const key = apiKey ?? process.env['OPENROUTER_API_KEY'];

  if (!key) {
    throw new Error(
      'OPENROUTER_API_KEY environment variable is not set. ' +
      'Get your key at https://openrouter.ai/keys',
    );
  }

  return new OpenAI({
    apiKey: key,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/frederico-kluser/huu',
      'X-Title': 'HUU Multi-Agent Orchestrator',
    },
  });
}

// ── Message Conversion ───────────────────────────────────────────────
// The OpenRouter API is OpenAI-compatible, so messages use the same format.
// This module provides types and helpers for the tool-use loop.

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Execute a chat completion request against OpenRouter.
 */
export async function chatCompletion(
  client: OpenAI,
  params: {
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    signal?: AbortSignal;
  },
): Promise<ChatCompletionResult> {
  const createParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    model: params.model,
    messages: params.messages as OpenAI.ChatCompletionMessageParam[],
    max_tokens: params.maxTokens ?? 8192,
  };

  if (params.tools && params.tools.length > 0) {
    createParams.tools = params.tools as OpenAI.ChatCompletionTool[];
  }

  const response = await client.chat.completions.create(
    createParams,
    { signal: params.signal },
  );

  const choice = response.choices[0];

  return {
    content: choice?.message?.content ?? null,
    toolCalls: (choice?.message?.tool_calls ?? []) as ToolCall[],
    finishReason: choice?.finish_reason ?? null,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  };
}
