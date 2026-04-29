import { describe, it, expect } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createRefinementChat, DEFAULT_REFINEMENT_MODEL } from './langchain-client.js';

describe('createRefinementChat', () => {
  it('returns a stub chat when apiKey === "stub"', async () => {
    const chat = createRefinementChat({ apiKey: 'stub' });
    const reply = await chat.invoke([
      new SystemMessage('sys'),
      new HumanMessage('quero refinar um prompt'),
    ]);
    expect(typeof reply.content).toBe('string');
    expect(String(reply.content)).toMatch(/Stub:/);
  });

  it('produces a deterministic synthesis output on the third turn', async () => {
    const chat = createRefinementChat({ apiKey: 'stub' });
    await chat.invoke([new HumanMessage('um')]);
    await chat.invoke([new HumanMessage('um'), new HumanMessage('dois')]);
    const finalReply = await chat.invoke([
      new HumanMessage('um'),
      new HumanMessage('dois'),
      new HumanMessage('finalize agora'),
    ]);
    expect(String(finalReply.content)).toMatch(/Stub-refined:/);
  });

  it('throws when apiKey is empty AND not in stub mode', () => {
    delete process.env.HUU_LANGCHAIN_STUB;
    expect(() => createRefinementChat({ apiKey: '' })).toThrow(/api key ausente/i);
  });

  it('honors HUU_LANGCHAIN_STUB env var even with a non-stub key', async () => {
    const prev = process.env.HUU_LANGCHAIN_STUB;
    process.env.HUU_LANGCHAIN_STUB = '1';
    try {
      const chat = createRefinementChat({ apiKey: 'sk-real-key', modelId: 'foo/bar' });
      const reply = await chat.invoke([new HumanMessage('hi')]);
      expect(String(reply.content)).toMatch(/Stub:/);
    } finally {
      if (prev === undefined) delete process.env.HUU_LANGCHAIN_STUB;
      else process.env.HUU_LANGCHAIN_STUB = prev;
    }
  });

  it('exports DEFAULT_REFINEMENT_MODEL pointing at kimi-k2.6', () => {
    expect(DEFAULT_REFINEMENT_MODEL).toBe('moonshotai/kimi-k2.6');
  });
});
