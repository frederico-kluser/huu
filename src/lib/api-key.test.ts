import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_KEY_REGISTRY,
  clearStoredApiKey,
  configFilePath,
  findMissingKeysForBackend,
  findMissingKeysForProvider,
  findMissingRequiredKeys,
  findSpec,
  keyRemedyHint,
  loadStoredApiKey,
  maskKey,
  resolveApiKey,
  resolveApiKeyWithSource,
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
    'TAVILY_API_KEY',
    'TAVILY_API_KEY_FILE',
    'PARALLEL_API_KEY',
    'PARALLEL_API_KEY_FILE',
    'BRAVE_API_KEY',
    'BRAVE_API_KEY_FILE',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_API_KEY_FILE',
    'XDG_CONFIG_HOME',
    'HUU_CONFIG_DIR',
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

    it('includes the three web-research specs (tavily/parallel/brave)', () => {
      const names = API_KEY_REGISTRY.map((s) => s.name);
      expect(names).toContain('tavily');
      expect(names).toContain('parallel');
      expect(names).toContain('brave');
      expect(findSpec('tavily')?.envVar).toBe('TAVILY_API_KEY');
      expect(findSpec('parallel')?.envVar).toBe('PARALLEL_API_KEY');
      expect(findSpec('brave')?.envVar).toBe('BRAVE_API_KEY');
      expect(findSpec('tavily')?.validatePrefix).toBe('tvly-');
    });

    it('includes the deepseek spec the jcode backend points at', () => {
      // `selectBackend('jcode').apiKeySpecName === 'deepseek'`. Without this
      // entry findSpec returns undefined and docker-reexec — which iterates
      // API_KEY_REGISTRY to build secret mounts and the -e passthrough —
      // never carries DEEPSEEK_API_KEY into the container.
      const spec = findSpec('deepseek')!;
      expect(spec.envVar).toBe('DEEPSEEK_API_KEY');
      expect(spec.envFileVar).toBe('DEEPSEEK_API_KEY_FILE');
      expect(spec.secretMountPath).toBe('/run/secrets/deepseek_api_key');
      expect(spec.hostSecretScope).toBe('huu-deepseek-key');
      expect(spec.validatePrefix).toBe('sk-');
    });

    it('deepseek is bound to jcode and optional (never gates other backends)', () => {
      const spec = findSpec('deepseek')!;
      expect(spec.backendBound).toBe('jcode');
      // `required: false` on purpose: an OpenRouter or Azure run must not
      // block on a credential only the jcode backend consumes. The binding,
      // not the flag, is what enforces it for jcode.
      expect(spec.required).toBe(false);
    });

    it('the research specs are optional AND unbound — invisible to the run gate', () => {
      // `findMissingKeysForBackend` only enforces a spec without
      // `backendBound` when `required: true`. Both flags together are what
      // keeps a missing research key from ever blocking a run.
      for (const name of ['tavily', 'parallel', 'brave']) {
        const spec = findSpec(name)!;
        expect(spec.required, `${name}.required`).toBe(false);
        expect(spec.backendBound, `${name}.backendBound`).toBeUndefined();
      }
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

    it('the saved store wins over the env var (explicit beats ambient)', () => {
      const spec = findSpec('openrouter')!;
      saveApiKey(spec, 'sk-or-from-store');
      process.env.OPENROUTER_API_KEY = 'sk-or-from-env';
      expect(resolveApiKey(spec)).toBe('sk-or-from-store');
    });

    it('resolves arbitrary specs (artificialAnalysis)', () => {
      const spec = findSpec('artificialAnalysis')!;
      process.env.ARTIFICIAL_ANALYSIS_API_KEY = 'aa-12345';
      expect(resolveApiKey(spec)).toBe('aa-12345');
    });
  });

  describe('resolveApiKeyWithSource', () => {
    const spec = () => findSpec('openrouter')!;

    it('reports source "none" when nothing is set', () => {
      const r = resolveApiKeyWithSource(spec());
      expect(r).toEqual({ value: '', source: 'none', storedOverridesEnv: false });
    });

    it('reports source "stored" when only the global store has it', () => {
      saveApiKey(spec(), 'sk-or-stored');
      const r = resolveApiKeyWithSource(spec());
      expect(r.value).toBe('sk-or-stored');
      expect(r.source).toBe('stored');
      // No ambient env var, so nothing is being overridden.
      expect(r.storedOverridesEnv).toBe(false);
    });

    it('reports source "env" when the env var is the only key (no saved key)', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env';
      const r = resolveApiKeyWithSource(spec());
      expect(r.value).toBe('sk-or-env');
      expect(r.source).toBe('env');
      expect(r.storedOverridesEnv).toBe(false);
    });

    it('reports source "env-file" when the _FILE var wins', () => {
      const path = join(tmpDir, 'key.txt');
      writeFileSync(path, 'sk-or-from-file\n');
      process.env.OPENROUTER_API_KEY_FILE = path;
      const r = resolveApiKeyWithSource(spec());
      expect(r.value).toBe('sk-or-from-file');
      expect(r.source).toBe('env-file');
    });

    it('flags storedOverridesEnv when a saved key overrides a DIFFERENT env var', () => {
      // The inverted production bug: a valid key saved in Options now WINS over
      // a stale key in the environment (e.g. exported from ~/.secrets), so the
      // saved key is used and the env var is flagged as ignored.
      saveApiKey(spec(), 'sk-or-v1-valid-saved');
      process.env.OPENROUTER_API_KEY = 'sk-or-v1-stale-env';
      const r = resolveApiKeyWithSource(spec());
      expect(r.value).toBe('sk-or-v1-valid-saved');
      expect(r.source).toBe('stored');
      expect(r.storedOverridesEnv).toBe(true);
    });

    it('does NOT flag storedOverridesEnv when env and store hold the same key', () => {
      saveApiKey(spec(), 'sk-or-same');
      process.env.OPENROUTER_API_KEY = 'sk-or-same';
      const r = resolveApiKeyWithSource(spec());
      expect(r.source).toBe('stored');
      expect(r.storedOverridesEnv).toBe(false);
    });

    it('value matches resolveApiKey for every tier (no behavior drift)', () => {
      saveApiKey(spec(), 'sk-or-stored');
      process.env.OPENROUTER_API_KEY = 'sk-or-env';
      expect(resolveApiKeyWithSource(spec()).value).toBe(resolveApiKey(spec()));
    });
  });

  describe('keyRemedyHint', () => {
    const spec = () => findSpec('openrouter')!;

    it('the stored-overrides-env case names the ignored env var and points at Options', () => {
      const hint = keyRemedyHint(spec(), {
        value: 'x',
        source: 'stored',
        storedOverridesEnv: true,
      });
      expect(hint).toContain('OPENROUTER_API_KEY');
      expect(hint).toContain('IGNORED');
      expect(hint).toContain('Options');
      expect(hint).toContain('precedence');
      expect(hint).toContain('rejected');
    });

    it('the plain stored case tells you to update the saved key in Options', () => {
      const hint = keyRemedyHint(spec(), {
        value: 'x',
        source: 'stored',
        storedOverridesEnv: false,
      });
      expect(hint).toContain('Options screen');
      expect(hint).toContain('rejected');
    });

    it('the none case asks the user to add a key', () => {
      const hint = keyRemedyHint(spec(), {
        value: '',
        source: 'none',
        storedOverridesEnv: false,
      });
      expect(hint).toContain('No OPENROUTER_API_KEY');
    });

    it('never leaks the key value into the hint', () => {
      const secret = 'sk-or-v1-supersecret-value';
      for (const source of ['env', 'env-file', 'secret-mount', 'stored', 'none'] as const) {
        const hint = keyRemedyHint(spec(), { value: secret, source, storedOverridesEnv: true });
        expect(hint).not.toContain(secret);
      }
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

    it('does not require the web-research specs (required: false)', () => {
      const names = findMissingRequiredKeys().map((s) => s.name);
      expect(names).not.toContain('tavily');
      expect(names).not.toContain('parallel');
      expect(names).not.toContain('brave');
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

    it('pi backend: returns ONLY openrouter — the research keys never gate a run', () => {
      // Regression pin for the tavily/parallel/brave additions: they carry no
      // `backendBound` and `required: false`, so with nothing configured the
      // pi gate must still name exactly one missing credential.
      expect(findMissingKeysForBackend('pi').map((s) => s.name)).toEqual(['openrouter']);
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

    it('jcode backend: requires ONLY deepseek when nothing is configured', () => {
      // The non-vacuous half of this pair: delete the deepseek spec and this
      // returns [] instead, so the assertion actually pins the registry entry
      // (and not just the resolver's ability to find nothing).
      expect(findMissingKeysForBackend('jcode').map((s) => s.name)).toEqual(['deepseek']);
    });

    it('jcode backend: stops requiring deepseek once the key resolves', () => {
      process.env.DEEPSEEK_API_KEY = 'sk-jcode-set';
      expect(findMissingKeysForBackend('jcode')).toEqual([]);
    });

    it('jcode backend: the same key also resolves through the saved store', () => {
      saveApiKey(findSpec('deepseek')!, 'sk-jcode-stored');
      expect(findMissingKeysForBackend('jcode')).toEqual([]);
      expect(resolveApiKey(findSpec('deepseek')!)).toBe('sk-jcode-stored');
    });

    it('deepseek never leaks into another backend\'s gate (and vice versa)', () => {
      // Cross-backend isolation: a pi run must not ask for the DeepSeek key,
      // and a jcode run must not ask for the OpenRouter one.
      expect(findMissingKeysForBackend('pi').map((s) => s.name)).not.toContain('deepseek');
      expect(findMissingKeysForBackend('azure').map((s) => s.name)).not.toContain('deepseek');
      expect(findMissingKeysForBackend('jcode').map((s) => s.name)).not.toContain('openrouter');
    });

    it('deepseek does not gate a pi run even when unset (required: false)', () => {
      expect(findMissingRequiredKeys().map((s) => s.name)).not.toContain('deepseek');
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

  describe('HUU_CONFIG_DIR override (docker-mounted host store)', () => {
    it('configFilePath prefers HUU_CONFIG_DIR over XDG_CONFIG_HOME', () => {
      process.env.HUU_CONFIG_DIR = join(tmpDir, 'hostcfg');
      expect(configFilePath()).toBe(join(tmpDir, 'hostcfg', 'config.json'));
      delete process.env.HUU_CONFIG_DIR;
      expect(configFilePath()).toBe(join(configHome, 'huu', 'config.json'));
    });

    it('save + load + resolve go through the HUU_CONFIG_DIR store', () => {
      process.env.HUU_CONFIG_DIR = join(tmpDir, 'hostcfg');
      const spec = findSpec('openrouter')!;
      saveApiKey(spec, 'sk-or-host');
      expect(loadStoredApiKey(spec)).toBe('sk-or-host');
      expect(resolveApiKeyWithSource(spec)).toMatchObject({
        value: 'sk-or-host',
        source: 'stored',
      });
      expect(
        JSON.parse(readFileSync(join(tmpDir, 'hostcfg', 'config.json'), 'utf8')),
      ).toMatchObject({ openrouter: 'sk-or-host' });
    });
  });

  describe('clearStoredApiKey', () => {
    it('removes the entry so resolution falls back to the env var', () => {
      const spec = findSpec('openrouter')!;
      saveApiKey(spec, 'sk-or-stale');
      process.env.OPENROUTER_API_KEY = 'sk-or-fresh';
      expect(resolveApiKeyWithSource(spec).source).toBe('stored');

      expect(clearStoredApiKey(spec)).toBe(true);
      const after = resolveApiKeyWithSource(spec);
      expect(after.source).toBe('env');
      expect(after.value).toBe('sk-or-fresh');
    });

    it('keeps OTHER specs untouched and returns false when nothing was stored', () => {
      const or = findSpec('openrouter')!;
      const az = findSpec('azureApiKey')!;
      saveApiKey(or, 'sk-or-keep');
      saveApiKey(az, 'az-keep');
      expect(clearStoredApiKey(az)).toBe(true);
      expect(loadStoredApiKey(or)).toBe('sk-or-keep');
      expect(loadStoredApiKey(az)).toBe('');
      expect(clearStoredApiKey(az)).toBe(false); // already gone
    });
  });

  describe('maskKey', () => {
    it('shows a prefix + the last 4 chars, never the middle', () => {
      const m = maskKey('sk-or-v1-abcdefghijklmnop');
      expect(m).toBe('sk-or-…mnop');
      expect(m).not.toContain('abcdefghijkl');
    });

    it('degrades for short/empty values', () => {
      expect(maskKey('')).toBe('(none)');
      expect(maskKey('   ')).toBe('(none)');
      expect(maskKey('short')).toBe('••••');
    });
  });
});
