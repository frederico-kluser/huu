import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_KEY_REGISTRY,
  configFilePath,
  findMissingKeysForBackend,
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
    'COPILOT_GITHUB_TOKEN',
    'COPILOT_GITHUB_TOKEN_FILE',
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
    it('includes both required keys', () => {
      const names = API_KEY_REGISTRY.map((s) => s.name);
      expect(names).toContain('openrouter');
      expect(names).toContain('artificialAnalysis');
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
    it('returns every required spec when nothing is set', () => {
      const missing = findMissingRequiredKeys();
      const names = missing.map((s) => s.name);
      expect(names).toContain('openrouter');
      expect(names).toContain('artificialAnalysis');
    });

    it('drops a spec once its key is in env', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-set';
      const missing = findMissingRequiredKeys();
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('openrouter');
    });

    it('drops a spec once its key is in the global store', () => {
      const spec = findSpec('artificialAnalysis')!;
      saveApiKey(spec, 'aa-stored');
      const missing = findMissingRequiredKeys();
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('artificialAnalysis');
    });

    it('does not return copilot spec by default (required: false)', () => {
      // The Copilot spec is `required: false` so legacy callers don't
      // gate a Pi run on a missing Copilot token. This is the
      // contract; if it changes, update both this test and the
      // App's missing-key check.
      const missing = findMissingRequiredKeys();
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('copilot');
    });
  });

  describe('findMissingKeysForBackend (backend-aware)', () => {
    it('pi backend: requires openrouter + universal AA key', () => {
      const missing = findMissingKeysForBackend('pi');
      const names = missing.map((s) => s.name);
      expect(names).toContain('openrouter');
      expect(names).toContain('artificialAnalysis');
      expect(names).not.toContain('copilot');
    });

    it('copilot backend: requires copilot + universal AA key', () => {
      // Regression guard: an earlier refactor accidentally dropped the
      // AA prompt when switching to backend-aware checking, breaking
      // catalog enrichment for Copilot users. AA is universal.
      const missing = findMissingKeysForBackend('copilot');
      const names = missing.map((s) => s.name);
      expect(names).toContain('copilot');
      expect(names).toContain('artificialAnalysis');
      expect(names).not.toContain('openrouter');
    });

    it('copilot backend: still requires copilot even though spec is required:false', () => {
      // backend-bound specs are enforced regardless of `required` flag
      // when the matching backend is active — choosing a backend IS
      // the implicit "I need this credential" signal.
      const missing = findMissingKeysForBackend('copilot');
      expect(missing.find((s) => s.name === 'copilot')).toBeDefined();
    });

    it('drops backend-bound spec when its key is set', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-set';
      const missing = findMissingKeysForBackend('pi');
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('openrouter');
    });

    it('drops universal spec when its key is set', () => {
      process.env.ARTIFICIAL_ANALYSIS_API_KEY = 'aa-set';
      const missing = findMissingKeysForBackend('pi');
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('artificialAnalysis');
    });

    it('does not include other backend\'s spec', () => {
      // Even if the user has openrouter set, switching to copilot
      // shouldn't list openrouter as still-needed.
      process.env.OPENROUTER_API_KEY = 'sk-or-set';
      const missing = findMissingKeysForBackend('copilot');
      const names = missing.map((s) => s.name);
      expect(names).not.toContain('openrouter');
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
