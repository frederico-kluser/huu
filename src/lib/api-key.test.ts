import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_KEY_REGISTRY,
  configFilePath,
  findMissingKeysForBackend,
  findMissingKeysForProvider,
  findMissingRequiredKeys,
  findSpec,
  loadStoredApiKey,
  resolveApiKey,
  resolveOpenRouterApiKey,
  saveApiKey,
} from './api-key.js';

describe('api-key registry', () => {
  // Tests must isolate from the user's real ~/.config/huu/config.json.
  // We point XDG_CONFIG_HOME at a tmpdir for every test so saves and
  // loads land there.
  const TRACKED_ENV = [
    'OPENROUTER_API_KEY',
    'OPENROUTER_API_KEY_FILE',
    'ARTIFICIAL_ANALYSIS_API_KEY',
    'ARTIFICIAL_ANALYSIS_API_KEY_FILE',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_API_KEY_FILE',
    'AZURE_OPENAI_BASE_URL',
    'AZURE_OPENAI_BASE_URL_FILE',
    'XDG_CONFIG_HOME',
  ] as const;
  const saved: Record<string, string | undefined> = {};
  let tmpDir: string;
  let configHome: string;

  beforeEach(() => {
    for (const k of TRACKED_ENV) saved[k] = process.env[k];
    for (const k of TRACKED_ENV) delete process.env[k];
    tmpDir = mkdtempSync(join(tmpdir(), 'huu-api-key-test-'));
    configHome = join(tmpDir, 'xdg');
    process.env.XDG_CONFIG_HOME = configHome;
  });

  afterEach(() => {
    for (const k of TRACKED_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('registry shape', () => {
    it('includes openrouter + artificialAnalysis specs', () => {
      const names = API_KEY_REGISTRY.map((s) => s.name);
      expect(names).toContain('openrouter');
      expect(names).toContain('artificialAnalysis');
    });

    it('artificialAnalysis is optional (required: false)', () => {
      // AA is purely informational — used by the model selector to enrich
      // entries with benchmark metrics. Demoting `required` to false
      // removed a foot-gun where AA was prompted AFTER pipeline + backend +
      // model selection, blocking the run at the last step.
      const aa = findSpec('artificialAnalysis')!;
      expect(aa.required).toBe(false);
    });

    it('every entry has the secret-mount path under /run/secrets', () => {
      for (const spec of API_KEY_REGISTRY) {
        expect(spec.secretMountPath.startsWith('/run/secrets/')).toBe(true);
      }
    });

    it('findSpec returns by name', () => {
      const s = findSpec('openrouter');
      expect(s?.envVar).toBe('OPENROUTER_API_KEY');
    });
  });

  describe('resolveApiKey', () => {
    it('returns empty when nothing is set anywhere', () => {
      const spec = findSpec('openrouter')!;
      expect(resolveApiKey(spec)).toBe('');
    });

    it('reads the env var when set', () => {
      const spec = findSpec('openrouter')!;
      process.env.OPENROUTER_API_KEY = '  sk-or-plain  ';
      expect(resolveApiKey(spec)).toBe('sk-or-plain');
    });

    it('reads via _FILE env var (trimmed)', () => {
      const spec = findSpec('openrouter')!;
      const path = join(tmpDir, 'key.txt');
      writeFileSync(path, 'sk-or-from-file\n');
      process.env.OPENROUTER_API_KEY_FILE = path;
      expect(resolveApiKey(spec)).toBe('sk-or-from-file');
    });

    it('_FILE wins over plain env when both are set', () => {
      const spec = findSpec('openrouter')!;
      const path = join(tmpDir, 'key.txt');
      writeFileSync(path, 'sk-or-from-file');
      process.env.OPENROUTER_API_KEY_FILE = path;
      process.env.OPENROUTER_API_KEY = 'sk-or-plain';
      expect(resolveApiKey(spec)).toBe('sk-or-from-file');
    });

    it('falls back to plain env when _FILE points at a missing path', () => {
      const spec = findSpec('openrouter')!;
      process.env.OPENROUTER_API_KEY_FILE = join(tmpDir, 'does-not-exist');
      process.env.OPENROUTER_API_KEY = 'sk-or-fallback';
      expect(resolveApiKey(spec)).toBe('sk-or-fallback');
    });

    it('falls back to the global store when env is empty', () => {
      const spec = findSpec('openrouter')!;
      saveApiKey(spec, 'sk-or-from-store');
      expect(resolveApiKey(spec)).toBe('sk-or-from-store');
    });

    it('env wins over the global store', () => {
      const spec = findSpec('openrouter')!;
      saveApiKey(spec, 'sk-or-from-store');
      process.env.OPENROUTER_API_KEY = 'sk-or-from-env';
      expect(resolveApiKey(spec)).toBe('sk-or-from-env');
    });

    it('resolves arbitrary specs (artificialAnalysis)', () => {
      const spec = findSpec('artificialAnalysis')!;
      process.env.ARTIFICIAL_ANALYSIS_API_KEY = 'aa-12345';
      expect(resolveApiKey(spec)).toBe('aa-12345');
    });
  });

  describe('saveApiKey', () => {
    it('writes the global store with mode 0600 in a 0700 dir', () => {
      const spec = findSpec('openrouter')!;
      saveApiKey(spec, 'sk-or-saved');
      const path = configFilePath();
      expect(path.startsWith(configHome)).toBe(true);
      // 0o777 mask filters umask noise.
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      expect(parsed.openrouter).toBe('sk-or-saved');
    });

    it('preserves other keys when saving one', () => {
      const or = findSpec('openrouter')!;
      const aa = findSpec('artificialAnalysis')!;
      saveApiKey(or, 'sk-or-1');
      saveApiKey(aa, 'aa-2');
      const parsed = JSON.parse(readFileSync(configFilePath(), 'utf8'));
      expect(parsed).toEqual({ openrouter: 'sk-or-1', artificialAnalysis: 'aa-2' });
    });

    it('ignores empty values (doesn’t pollute the store)', () => {
      const spec = findSpec('openrouter')!;
      saveApiKey(spec, '   ');
      expect(loadStoredApiKey(spec)).toBe('');
    });
  });

  describe('findMissingRequiredKeys', () => {
    it('returns openrouter when nothing is set', () => {
      const missing = findMissingRequiredKeys();
      const names = missing.map((s) => s.name);
      expect(names).toContain('openrouter');
    });

    it('does not return artificialAnalysis (required: false)', () => {
      // AA is optional — see "artificialAnalysis is optional" test above.
      const missing = findMissingRequiredKeys();
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('artificialAnalysis');
    });

    it('drops a spec once its key is in env', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-set';
      const missing = findMissingRequiredKeys();
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('openrouter');
    });

    it('drops a spec once its key is in the global store', () => {
      const spec = findSpec('openrouter')!;
      saveApiKey(spec, 'sk-or-stored');
      const missing = findMissingRequiredKeys();
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('openrouter');
    });

    it('the removed copilot spec is gone from the registry', () => {
      const names = API_KEY_REGISTRY.map((s) => s.name);
      expect(names).not.toContain('copilot');
    });

    it('does not require azure specs by default (required: false)', () => {
      // Azure specs are `required: false` so an OpenRouter run never gates
      // on a missing Azure key. They're enforced only when the Azure
      // provider is active (see findMissingKeysForBackend below).
      const missing = findMissingRequiredKeys();
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('azureApiKey');
      expect(names).not.toContain('azureEndpoint');
    });
  });

  describe('findMissingKeysForBackend (backend-aware)', () => {
    it('pi backend: requires openrouter (AA + azure optional)', () => {
      const missing = findMissingKeysForBackend('pi');
      const names = missing.map((s) => s.name);
      expect(names).toContain('openrouter');
      // AA is `required: false` — the run flow no longer gates on it.
      // The model selector still uses it when present (graceful degrade).
      expect(names).not.toContain('artificialAnalysis');
      expect(names).not.toContain('azureApiKey');
    });

    it('azure backend: requires the azure key + endpoint (not openrouter)', () => {
      const missing = findMissingKeysForBackend('azure');
      const names = missing.map((s) => s.name);
      expect(names).toContain('azureApiKey');
      expect(names).toContain('azureEndpoint');
      expect(names).not.toContain('openrouter');
    });

    it('azure backend: still requires the key even though spec is required:false', () => {
      // backend-bound specs are enforced regardless of `required` flag
      // when the matching backend is active — choosing a provider IS
      // the implicit "I need this credential" signal.
      const missing = findMissingKeysForBackend('azure');
      expect(missing.find((s) => s.name === 'azureApiKey')).toBeDefined();
    });

    it('stub backend: requires nothing', () => {
      expect(findMissingKeysForBackend('stub')).toEqual([]);
    });

    it('drops backend-bound spec when its key is set', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-set';
      const missing = findMissingKeysForBackend('pi');
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('openrouter');
    });

    it('does not include other backend\'s spec', () => {
      // Even with openrouter set, switching to azure shouldn't list
      // openrouter as still-needed.
      process.env.OPENROUTER_API_KEY = 'sk-or-set';
      const missing = findMissingKeysForBackend('azure');
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('openrouter');
    });
  });

  describe('findMissingKeysForProvider', () => {
    it('openrouter provider needs the openrouter key', () => {
      const names = findMissingKeysForProvider('openrouter').map((s) => s.name);
      expect(names).toContain('openrouter');
    });

    it('azure provider needs the azure key + endpoint', () => {
      const names = findMissingKeysForProvider('azure').map((s) => s.name);
      expect(names).toContain('azureApiKey');
      expect(names).toContain('azureEndpoint');
    });
  });

  describe('resolveOpenRouterApiKey (legacy shim)', () => {
    it('returns the OpenRouter key via the registry path', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-legacy';
      expect(resolveOpenRouterApiKey()).toBe('sk-or-legacy');
    });

    it('is empty when nothing is set', () => {
      expect(resolveOpenRouterApiKey()).toBe('');
    });
  });
});
