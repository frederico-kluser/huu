import { describe, it, expect } from 'vitest';
import { resolveCopilotCreds } from './auth.js';

describe('resolveCopilotCreds', () => {
  it('returns hasAuth=false when nothing is set', () => {
    const r = resolveCopilotCreds({});
    expect(r.hasAuth).toBe(false);
    expect(r.source).toBe('none');
    expect(r.env).toEqual({});
  });

  it('prefers COPILOT_GITHUB_TOKEN over GH_TOKEN/GITHUB_TOKEN', () => {
    const r = resolveCopilotCreds({
      COPILOT_GITHUB_TOKEN: 'ghp_copilot',
      GH_TOKEN: 'ghp_gh',
      GITHUB_TOKEN: 'ghp_github',
    });
    expect(r.source).toBe('COPILOT_GITHUB_TOKEN');
    expect(r.env.COPILOT_GITHUB_TOKEN).toBe('ghp_copilot');
    expect(r.env.GH_TOKEN).toBeUndefined();
    expect(r.hasAuth).toBe(true);
  });

  it('falls back to GH_TOKEN when COPILOT_GITHUB_TOKEN is empty', () => {
    const r = resolveCopilotCreds({
      COPILOT_GITHUB_TOKEN: '',
      GH_TOKEN: 'ghp_gh',
    });
    expect(r.source).toBe('GH_TOKEN');
    expect(r.env.GH_TOKEN).toBe('ghp_gh');
  });

  it('falls back to GITHUB_TOKEN when others empty', () => {
    const r = resolveCopilotCreds({
      GITHUB_TOKEN: 'ghp_github',
    });
    expect(r.source).toBe('GITHUB_TOKEN');
    expect(r.env.GITHUB_TOKEN).toBe('ghp_github');
  });

  it('treats whitespace-only tokens as missing', () => {
    const r = resolveCopilotCreds({
      COPILOT_GITHUB_TOKEN: '   ',
      GH_TOKEN: '\t',
    });
    expect(r.hasAuth).toBe(false);
  });

  it('accepts BYOK as valid auth when API key + base URL both set', () => {
    const r = resolveCopilotCreds({
      COPILOT_PROVIDER_BASE_URL: 'http://localhost:11434/v1',
      COPILOT_PROVIDER_API_KEY: 'ollama',
    });
    expect(r.source).toBe('byok_only');
    expect(r.hasAuth).toBe(true);
    expect(r.env).toEqual({});
  });

  it('rejects BYOK with only one of the two pieces set', () => {
    const onlyKey = resolveCopilotCreds({
      COPILOT_PROVIDER_API_KEY: 'k',
    });
    expect(onlyKey.hasAuth).toBe(false);

    const onlyBase = resolveCopilotCreds({
      COPILOT_PROVIDER_BASE_URL: 'http://x',
    });
    expect(onlyBase.hasAuth).toBe(false);
  });

  it('GitHub token takes precedence over BYOK', () => {
    const r = resolveCopilotCreds({
      COPILOT_GITHUB_TOKEN: 'ghp_copilot',
      COPILOT_PROVIDER_BASE_URL: 'http://localhost:11434/v1',
      COPILOT_PROVIDER_API_KEY: 'ollama',
    });
    expect(r.source).toBe('COPILOT_GITHUB_TOKEN');
  });
});
