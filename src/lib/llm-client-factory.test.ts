import { describe, expect, it } from 'vitest';
import { buildChatClient, type LlmClientContext } from './llm-client-factory.js';

const openrouterCtx: LlmClientContext = {
  backend: 'pi',
  openrouterApiKey: 'sk-or-test-key',
};

const azureCtx: LlmClientContext = {
  backend: 'azure',
  azureApiKey: 'az-test-key',
  azureEndpoint: 'https://example.openai.azure.com/openai/v1/',
};

describe('buildChatClient reasoningEffort', () => {
  it('omits reasoning params by default — byte-identical to legacy helper calls', () => {
    // ChatOpenAI defaults modelKwargs to {} when the caller passes nothing; the
    // whole point of gating on `reasoningEffort` is that existing helpers stay
    // exactly as they were.
    const client = buildChatClient(openrouterCtx, { modelId: 'moonshotai/kimi-k2.6' });
    expect(client.modelKwargs).toEqual({});
  });

  it('sends OpenRouter `reasoning.effort` when requested (the GLM-5.2 merge path)', () => {
    const client = buildChatClient(openrouterCtx, {
      modelId: 'z-ai/glm-5.2',
      reasoningEffort: 'high',
    });
    expect(client.modelKwargs).toEqual({ reasoning: { effort: 'high' } });
  });

  it('sends Azure `reasoning_effort` when requested', () => {
    const client = buildChatClient(azureCtx, {
      modelId: 'gpt-5',
      reasoningEffort: 'high',
    });
    expect(client.modelKwargs).toEqual({ reasoning_effort: 'high' });
  });
});
