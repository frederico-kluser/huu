import { afterEach, describe, expect, it, vi } from 'vitest';
import { findSpec } from '../lib/api-key.js';
import { listBackendsInfo, validateKeyValue } from './api-data.js';

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

  it('returns unverifiable for a key with no cheap probe (copilot), no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await validateKeyValue(findSpec('copilot')!, 'ghp_whatever');
    expect(r.status).toBe('unverifiable');
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
