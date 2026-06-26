import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findSpec } from '../lib/api-key.js';
import { listBackendsInfo, listModelsForBackend, validateKeyValue } from './api-data.js';
import { resetCapabilitiesCache } from '../lib/openrouter.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listBackendsInfo', () => {
  it('exposes apiKeySpecName so the browser can look up its session key', () => {
    const backends = listBackendsInfo();
    expect(backends.find((b) => b.id === 'pi')?.apiKeySpecName).toBe('openrouter');
    expect(backends.find((b) => b.id === 'azure')?.apiKeySpecName).toBe('azureApiKey');
    // stub needs no key — no spec to look up.
    expect(backends.find((b) => b.id === 'stub')?.apiKeySpecName).toBeUndefined();
  });
});

describe('listModelsForBackend', () => {
  beforeEach(() => resetCapabilitiesCache());
  afterEach(() => resetCapabilitiesCache());

  const catalog = (rows: unknown[]) =>
    new Response(JSON.stringify({ data: rows }), { status: 200 });

  it('returns the recommended catalog with no key, without hitting the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await listModelsForBackend(process.cwd(), 'pi', '');
    expect(r.source).toBe('recommended');
    expect(r.models.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the LIVE tool+reasoning catalog for pi when a key is provided', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog([
      { id: 'p/keep', name: 'Keep', context_length: 4, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools', 'reasoning'] },
      { id: 'p/skip', name: 'Skip', context_length: 4, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['reasoning'] },
    ])));
    const r = await listModelsForBackend(process.cwd(), 'pi', 'sk-or-x');
    expect(r.source).toBe('openrouter-live');
    expect(r.models.map((m) => m.id)).toEqual(['p/keep']);
    expect(r.models[0].thinking).toBe(true);
    expect(r.models[0].label).toBe('Keep');
    expect(r.models[0].inputPrice).toBeCloseTo(1, 6);
    expect(r.models[0].contextLength).toBe(4);
  });

  it('falls back to the recommended catalog when the live fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await listModelsForBackend(process.cwd(), 'pi', 'sk-or-x');
    expect(r.source).toBe('recommended');
    expect(r.models.length).toBeGreaterThan(0);
  });

  it('ignores the key for azure (static catalog, no network)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await listModelsForBackend(process.cwd(), 'azure', 'sk-or-x');
    expect(r.source).toBe('recommended');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('validateKeyValue', () => {
  const openrouter = () => findSpec('openrouter')!;

  it('returns unverifiable for an empty value without hitting the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await validateKeyValue(openrouter(), '   ');
    expect(r).toEqual({ status: 'unverifiable', reason: 'empty value' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns valid when OpenRouter accepts the key (HTTP 200)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    expect(await validateKeyValue(openrouter(), 'sk-or-good')).toEqual({ status: 'valid' });
  });

  it('returns invalid WITH the http status when OpenRouter rejects (401)', async () => {
    // This is the exact failure the whole change is about: a key the
    // provider actively rejects must never be accepted.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    expect(await validateKeyValue(openrouter(), 'sk-or-bad')).toEqual({
      status: 'invalid',
      httpStatus: 401,
    });
  });

  it('treats a network failure as unverifiable so offline/VPN users are not hard-blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    const r = await validateKeyValue(openrouter(), 'sk-or-x');
    expect(r.status).toBe('unverifiable');
  });

  it('returns unverifiable for a spec with no cheap probe (Azure endpoint URL), no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await validateKeyValue(findSpec('azureEndpoint')!, 'https://x.openai.azure.com');
    expect(r).toEqual({ status: 'unverifiable', reason: 'no validator for this key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an Azure key with no endpoint is unverifiable (endpoint required first)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await validateKeyValue(findSpec('azureApiKey')!, 'az-key');
    expect(r).toEqual({ status: 'unverifiable', reason: 'endpoint required to validate' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
