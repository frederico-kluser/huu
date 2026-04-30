import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createAssistantChat,
  DEFAULT_ASSISTANT_MODEL,
  HumanMessage,
} from './assistant-client.js';
import { AssistantTurnSchema } from './assistant-schema.js';

describe('createAssistantChat — stub mode', () => {
  let originalStubFlag: string | undefined;

  beforeEach(() => {
    originalStubFlag = process.env.HUU_LANGCHAIN_STUB;
  });

  afterEach(() => {
    if (originalStubFlag === undefined) delete process.env.HUU_LANGCHAIN_STUB;
    else process.env.HUU_LANGCHAIN_STUB = originalStubFlag;
  });

  it('returns the stub when apiKey === "stub"', async () => {
    const chat = createAssistantChat({ apiKey: 'stub' });
    expect(chat.modelId).toBe('stub/assistant');
  });

  it('returns the stub when HUU_LANGCHAIN_STUB=1', async () => {
    process.env.HUU_LANGCHAIN_STUB = '1';
    const chat = createAssistantChat({ apiKey: 'sk-or-real' });
    expect(chat.modelId).toBe('stub/assistant');
  });

  it('emits 3 questions then a pipeline, all valid against the schema', async () => {
    const chat = createAssistantChat({ apiKey: 'stub' });
    const turn1 = await chat.invokeStructured([new HumanMessage('quero algo')]);
    expect(AssistantTurnSchema.safeParse(turn1).success).toBe(true);
    expect(turn1.done).toBe(false);

    const turn2 = await chat.invokeStructured([new HumanMessage('a')]);
    expect(turn2.done).toBe(false);

    const turn3 = await chat.invokeStructured([new HumanMessage('b')]);
    expect(turn3.done).toBe(false);

    const turn4 = await chat.invokeStructured([new HumanMessage('c')]);
    expect(turn4.done).toBe(true);
    if (turn4.done === true) {
      expect(turn4.pipeline.steps.length).toBeGreaterThan(0);
    }
  });

  it('every stub question has a free-text last option', async () => {
    const chat = createAssistantChat({ apiKey: 'stub' });
    for (let i = 0; i < 3; i++) {
      const turn = await chat.invokeStructured([]);
      if (turn.done === false) {
        const last = turn.options[turn.options.length - 1];
        expect(last?.isFreeText).toBe(true);
      }
    }
  });
});

describe('createAssistantChat — real mode', () => {
  it('throws when apiKey is empty and not in stub mode', () => {
    delete process.env.HUU_LANGCHAIN_STUB;
    expect(() => createAssistantChat({ apiKey: '' })).toThrow(/API key/i);
  });

  it('returns the requested modelId (not the stub) for a real key', () => {
    delete process.env.HUU_LANGCHAIN_STUB;
    const chat = createAssistantChat({ apiKey: 'sk-or-test' });
    expect(chat.modelId).toBe(DEFAULT_ASSISTANT_MODEL);
  });

  it('respects an explicit modelId override', () => {
    delete process.env.HUU_LANGCHAIN_STUB;
    const chat = createAssistantChat({ apiKey: 'sk-or-test', modelId: 'openai/gpt-5.4' });
    expect(chat.modelId).toBe('openai/gpt-5.4');
  });
});
