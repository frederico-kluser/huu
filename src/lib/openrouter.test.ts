import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchModelCapabilities,
  filterToolReasoningModels,
  listToolReasoningModels,
  projectAllModels,
  listAllModels,
  resetCapabilitiesCache,
  type OpenRouterModel,
} from './openrouter.js';

const fakeBody = (ids: string[]): { data: { id: string; name: string; context_length: number; pricing: { prompt: string; completion: string }; supported_parameters: string[] }[] } => ({
  data: ids.map((id) => ({
    id,
    name: id,
    context_length: 1000,
    pricing: { prompt: '0', completion: '0' },
    supported_parameters: [],
  })),
});

describe('fetchModelCapabilities — per-API-key cache', () => {
  beforeEach(() => {
    resetCapabilitiesCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetCapabilitiesCache();
  });

  it('caches the response per API key (no cross-key leak)', async () => {
    let call = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call++;
      return new Response(JSON.stringify(fakeBody([`model-${call}`])), { status: 200 });
    });

    // First key: 1 fetch, sees model-1
    const a1 = await fetchModelCapabilities('keyA');
    // Second key: 1 fetch (NOT a cache hit on keyA's data), sees model-2
    const b1 = await fetchModelCapabilities('keyB');
    // Re-asking keyA: cache hit, NO fetch, still sees model-1
    const a2 = await fetchModelCapabilities('keyA');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(Array.from(a1.keys())).toEqual(['model-1']);
    expect(Array.from(b1.keys())).toEqual(['model-2']);
    // The fix: a2 must be the same as a1, NOT b1's stale data.
    expect(Array.from(a2.keys())).toEqual(['model-1']);
  });

  it('treats whitespace-padded keys as the same key (trims before lookup)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify(fakeBody(['m'])), { status: 200 });
    });
    await fetchModelCapabilities('  keyA  ');
    await fetchModelCapabilities('keyA');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('resetCapabilitiesCache forces a re-fetch on the next call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify(fakeBody(['m'])), { status: 200 });
    });
    await fetchModelCapabilities('keyA');
    resetCapabilitiesCache();
    await fetchModelCapabilities('keyA');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws on non-OK HTTP without poisoning the cache', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementationOnce(async () => new Response('rate limit', { status: 429 }));
    await expect(fetchModelCapabilities('keyA')).rejects.toThrow(/HTTP 429/);
    // After the failure, a follow-up succeeds and caches normally.
    fetchSpy.mockImplementationOnce(async () =>
      new Response(JSON.stringify(fakeBody(['m'])), { status: 200 }),
    );
    const r = await fetchModelCapabilities('keyA');
    expect(Array.from(r.keys())).toEqual(['m']);
  });

  it('fetches the PUBLIC catalog with no key and sends no Authorization header', async () => {
    let sentAuth: string | null = 'unset';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sentAuth = new Headers(init?.headers).get('authorization');
      return new Response(JSON.stringify(fakeBody(['m'])), { status: 200 });
    });
    const r = await fetchModelCapabilities(); // argless → public list
    expect(Array.from(r.keys())).toEqual(['m']);
    expect(sentAuth).toBeNull();
  });

  it('sends a Bearer Authorization header when a key IS provided', async () => {
    let sentAuth: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sentAuth = new Headers(init?.headers).get('authorization');
      return new Response(JSON.stringify(fakeBody(['m'])), { status: 200 });
    });
    await fetchModelCapabilities('sk-or-abc');
    expect(sentAuth).toBe('Bearer sk-or-abc');
  });
});

describe('filterToolReasoningModels', () => {
  const model = (
    id: string,
    params: string[],
    prompt = '0',
    completion = '0',
    ctx = 1000,
  ): OpenRouterModel => ({
    id,
    name: id.toUpperCase(),
    context_length: ctx,
    pricing: { prompt, completion },
    supported_parameters: params,
  });

  it('keeps only models that support BOTH tools and reasoning, sorted by id', () => {
    const caps = new Map<string, OpenRouterModel>([
      ['b', model('b', ['tools'])],
      ['a', model('a', ['tools', 'reasoning'])],
      ['c', model('c', ['reasoning'])],
      ['d', model('d', [])],
      ['e', model('e', ['reasoning', 'tools', 'temperature'])],
    ]);
    expect(filterToolReasoningModels(caps).map((o) => o.id)).toEqual(['a', 'e']);
  });

  it('normalizes per-token price strings to $/1M and carries the context window', () => {
    const caps = new Map([['x', model('x', ['tools', 'reasoning'], '0.0000006', '0.0000025', 200000)]]);
    const [o] = filterToolReasoningModels(caps);
    expect(o.inputPricePerM).toBeCloseTo(0.6, 6);
    expect(o.outputPricePerM).toBeCloseTo(2.5, 6);
    expect(o.contextLength).toBe(200000);
    expect(o.name).toBe('X');
  });

  it('ignores a model with no supported_parameters array', () => {
    const bad = {
      id: 'z',
      name: 'z',
      context_length: 1,
      pricing: { prompt: '0', completion: '0' },
    } as OpenRouterModel;
    expect(filterToolReasoningModels(new Map([['z', bad]]))).toEqual([]);
  });
});

describe('listToolReasoningModels', () => {
  beforeEach(() => resetCapabilitiesCache());
  afterEach(() => {
    vi.restoreAllMocks();
    resetCapabilitiesCache();
  });

  it('fetches the catalog and returns only tool+reasoning models', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'p/keep', name: 'Keep', context_length: 2, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools', 'reasoning'] },
              { id: 'p/drop', name: 'Drop', context_length: 2, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
            ],
          }),
          { status: 200 },
        ),
    );
    const out = await listToolReasoningModels('k');
    expect(out.map((o) => o.id)).toEqual(['p/keep']);
  });
});

describe('projectAllModels', () => {
  const model = (id: string, params: string[]): OpenRouterModel => ({
    id,
    name: id.toUpperCase(),
    context_length: 1000,
    pricing: { prompt: '0', completion: '0' },
    supported_parameters: params,
  });

  it('keeps EVERY model (no capability filter), sorted by id, with flags', () => {
    const caps = new Map<string, OpenRouterModel>([
      ['b', model('b', ['tools'])],
      ['a', model('a', ['tools', 'reasoning'])],
      ['c', model('c', ['reasoning'])],
      ['d', model('d', [])],
    ]);
    const out = projectAllModels(caps);
    expect(out.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    const byId = Object.fromEntries(out.map((o) => [o.id, o]));
    expect(byId.a.supportsTools).toBe(true);
    expect(byId.a.supportsReasoning).toBe(true);
    expect(byId.b.supportsTools).toBe(true);
    expect(byId.b.supportsReasoning).toBe(false);
    expect(byId.c.supportsTools).toBe(false);
    expect(byId.c.supportsReasoning).toBe(true);
    expect(byId.d.supportsTools).toBe(false);
    expect(byId.d.supportsReasoning).toBe(false);
  });

  it('treats a missing supported_parameters array as no capabilities (still kept)', () => {
    const bad = {
      id: 'z',
      name: 'z',
      context_length: 1,
      pricing: { prompt: '0', completion: '0' },
    } as OpenRouterModel;
    const out = projectAllModels(new Map([['z', bad]]));
    expect(out.map((o) => o.id)).toEqual(['z']);
    expect(out[0].supportsTools).toBe(false);
    expect(out[0].supportsReasoning).toBe(false);
  });
});

describe('listAllModels', () => {
  beforeEach(() => resetCapabilitiesCache());
  afterEach(() => {
    vi.restoreAllMocks();
    resetCapabilitiesCache();
  });

  it('fetches the catalog and returns ALL models, capability-annotated, sorted', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'p/dual', name: 'Dual', context_length: 2, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools', 'reasoning'] },
              { id: 'p/toolsonly', name: 'ToolsOnly', context_length: 2, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
              { id: 'p/plain', name: 'Plain', context_length: 2, pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
            ],
          }),
          { status: 200 },
        ),
    );
    const out = await listAllModels('k');
    // Nothing dropped — even the tools-only and no-capability models survive.
    expect(out.map((o) => o.id)).toEqual(['p/dual', 'p/plain', 'p/toolsonly']);
    const dual = out.find((o) => o.id === 'p/dual')!;
    expect(dual.supportsTools).toBe(true);
    expect(dual.supportsReasoning).toBe(true);
    expect(dual.inputPricePerM).toBeCloseTo(1, 6);
    const plain = out.find((o) => o.id === 'p/plain')!;
    expect(plain.supportsTools).toBe(false);
    expect(plain.supportsReasoning).toBe(false);
  });

  it('lists the public catalog with NO key (argless)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'p/a', name: 'A', context_length: 2, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
            ],
          }),
          { status: 200 },
        ),
    );
    const out = await listAllModels(); // no key → public list
    expect(out.map((o) => o.id)).toEqual(['p/a']);
  });
});
