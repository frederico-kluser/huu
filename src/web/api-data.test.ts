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

  it('downloads the FULL public catalog for pi even with NO key (no auth header)', async () => {
    // OpenRouter's /models is public — a key-less user must still see every
    // model, not just the static recommended shortlist. The request must NOT
    // carry an Authorization header (an empty `Bearer ` is rejected with 401).
    let sentAuth: string | null = 'unset';
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      sentAuth = new Headers(init?.headers).get('authorization');
      return catalog([
        { id: 'p/dual', name: 'Dual', context_length: 4, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools', 'reasoning'] },
        { id: 'p/plain', name: 'Plain', context_length: 4, pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
      ]);
    }));
    const r = await listModelsForBackend(process.cwd(), 'pi', '');
    expect(r.source).toBe('openrouter-live');
    expect(r.models.map((m) => m.id)).toEqual(['p/dual', 'p/plain']);
    expect(sentAuth).toBeNull();
  });

  it('returns the FULL live catalog for pi when a key is provided, capability-annotated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog([
      { id: 'p/dual', name: 'Dual', context_length: 4, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools', 'reasoning'] },
      { id: 'p/reasononly', name: 'ReasonOnly', context_length: 4, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['reasoning'] },
      { id: 'p/toolsonly', name: 'ToolsOnly', context_length: 4, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
    ])));
    const r = await listModelsForBackend(process.cwd(), 'pi', 'sk-or-x');
    expect(r.source).toBe('openrouter-live');
    // No model is hidden anymore — the user can pick (or type) any of them.
    expect(r.models.map((m) => m.id)).toEqual(['p/dual', 'p/reasononly', 'p/toolsonly']);
    const byId = Object.fromEntries(r.models.map((m) => [m.id, m]));
    expect(byId['p/dual'].thinking).toBe(true);
    expect(byId['p/dual'].tools).toBe(true);
    expect(byId['p/dual'].label).toBe('Dual');
    expect(byId['p/dual'].inputPrice).toBeCloseTo(1, 6);
    expect(byId['p/dual'].contextLength).toBe(4);
    // reasoning-only: thinking on, tools off (the picker badges "no tools").
    expect(byId['p/reasononly'].thinking).toBe(true);
    expect(byId['p/reasononly'].tools).toBe(false);
    // tools-only (e.g. deepseek-chat): a perfectly valid agent model, no reasoning.
    expect(byId['p/toolsonly'].thinking).toBe(false);
    expect(byId['p/toolsonly'].tools).toBe(true);
  });

  it('falls back to the recommended catalog when the live fetch fails (even with no key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await listModelsForBackend(process.cwd(), 'pi', '');
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
