import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchModelCapabilities, resetCapabilitiesCache } from './openrouter.js';

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
});
