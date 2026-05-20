import { describe, it, expect } from 'vitest';
import { resolveCopilotCreds } from './auth.js';

describe('resolveCopilotCreds', () => {
  it('returns hasAuth=false when nothing is set', () => {
    const r = resolveCopilotCreds({});
    expect(r.hasAuth).toBe(false);
    expect(r.source).toBe('none');
  });

  it('prefers COPILOT_GITHUB_TOKEN over GH_TOKEN/GITHUB_TOKEN', () => {
    const r = resolveCopilotCreds({
      COPILOT_GITHUB_TOKEN: 'ghp_copilot',
      GH_TOKEN: 'ghp_gh',
      GITHUB_TOKEN: 'ghp_github',
    });
    expect(r.source).toBe('COPILOT_GITHUB_TOKEN');
    expect(r.hasAuth).toBe(true);
    // Env-var sources do NOT populate token — CLI inherits via process.env.
    expect(r.token).toBeUndefined();
  });

  it('falls back to GH_TOKEN when COPILOT_GITHUB_TOKEN is empty', () => {
    const r = resolveCopilotCreds({
      COPILOT_GITHUB_TOKEN: '',
      GH_TOKEN: 'ghp_gh',
    });
    expect(r.source).toBe('GH_TOKEN');
    expect(r.hasAuth).toBe(true);
  });

  it('falls back to GITHUB_TOKEN when others empty', () => {
    const r = resolveCopilotCreds({
      GITHUB_TOKEN: 'ghp_github',
    });
    expect(r.source).toBe('GITHUB_TOKEN');
    expect(r.hasAuth).toBe(true);
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

  it('BYOK_only does not populate token (provider auth replaces it)', () => {
    const r = resolveCopilotCreds({
      COPILOT_PROVIDER_API_KEY: 'ollama',
      COPILOT_PROVIDER_BASE_URL: 'http://localhost:11434/v1',
    });
    expect(r.source).toBe('byok_only');
    expect(r.hasAuth).toBe(true);
    expect(r.token).toBeUndefined();
  });

  it('env_file populates token so factory can forward to SDK gitHubToken', async () => {
    // The Copilot CLI does NOT recognise COPILOT_GITHUB_TOKEN_FILE
    // natively; huu reads the file itself and forwards the token via
    // CopilotClient({ gitHubToken }). hasAuth=true without a populated
    // token would be a silent auth failure downstream.
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'huu-auth-test-'));
    const tokenFile = join(dir, 'token');
    try {
      writeFileSync(tokenFile, 'ghp_from_file\n');
      const r = resolveCopilotCreds({
        COPILOT_GITHUB_TOKEN_FILE: tokenFile,
      });
      expect(r.source).toBe('env_file');
      expect(r.hasAuth).toBe(true);
      expect(r.token).toBe('ghp_from_file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
