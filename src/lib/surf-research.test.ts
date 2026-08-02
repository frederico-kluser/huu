import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findSpec, saveApiKey } from './api-key.js';
import { addPoolKey } from './api-key-pool.js';
import {
  ensureSurfKeys,
  ensureSurfKeysInContainer,
  formatSurfUsage,
  probeSurf,
  readSurfUsage,
  resetSurfProbeCache,
  SURF_PROVIDERS,
  surfKeysPath,
  surfUsagePath,
} from './surf-research.js';

describe('surf-research', () => {
  // The surf CLI resolves its state through os.homedir(), so the tests point
  // HOME at a throwaway dir — same reason the module uses homedir() instead
  // of trusting the container's $HOME.
  const TRACKED_ENV = [
    'HOME',
    'HUU_CONFIG_DIR',
    'XDG_CONFIG_HOME',
    'TAVILY_API_KEY',
    'TAVILY_API_KEY_FILE',
    'PARALLEL_API_KEY',
    'PARALLEL_API_KEY_FILE',
    'BRAVE_API_KEY',
    'BRAVE_API_KEY_FILE',
    'HUU_SURF_CREDIT_USD_TAVILY',
    'HUU_IN_CONTAINER',
  ] as const;
  const saved: Record<string, string | undefined> = {};
  let tmpDir: string;

  beforeEach(() => {
    for (const k of TRACKED_ENV) saved[k] = process.env[k];
    for (const k of TRACKED_ENV) delete process.env[k];
    tmpDir = mkdtempSync(join(tmpdir(), 'huu-surf-test-'));
    process.env.HOME = join(tmpDir, 'home');
    process.env.HUU_CONFIG_DIR = join(tmpDir, 'cfg');
    mkdirSync(process.env.HOME, { recursive: true });
    resetSurfProbeCache();
  });

  afterEach(() => {
    for (const k of TRACKED_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(tmpDir, { recursive: true, force: true });
    resetSurfProbeCache();
  });

  const readKeysFile = (): Record<string, any> =>
    JSON.parse(readFileSync(surfKeysPath(), 'utf8'));

  describe('ensureSurfKeysInContainer', () => {
    it('is a no-op on the host (HUU_IN_CONTAINER unset)', () => {
      process.env.TAVILY_API_KEY = 'tvly-ENV';
      expect(ensureSurfKeysInContainer()).toBeNull();
      // nothing written
      expect(() => readFileSync(surfKeysPath(), 'utf8')).toThrow();
    });

    it('materializes inside the container when a key is configured', () => {
      process.env.HUU_IN_CONTAINER = '1';
      process.env.TAVILY_API_KEY = 'tvly-ENV';
      const res = ensureSurfKeysInContainer();
      expect(res?.written).toBe(true);
      expect(res?.providers).toEqual(['tavily']);
      expect(readKeysFile().tavily.keys).toEqual(['tvly-ENV']);
    });

    it('inside the container with no keys, reports written:false and stays quiet', () => {
      process.env.HUU_IN_CONTAINER = '1';
      const res = ensureSurfKeysInContainer();
      expect(res?.written).toBe(false);
      expect(res?.reason).toMatch(/no surf provider keys/i);
    });
  });

  describe('paths', () => {
    it('resolve under the CURRENT homedir (not a cached one)', () => {
      expect(surfKeysPath()).toBe(join(tmpDir, 'home', '.config', 'surf', 'keys.json'));
      expect(surfUsagePath()).toBe(join(tmpDir, 'home', '.cache', 'surf', 'usage.jsonl'));
    });
  });

  describe('ensureSurfKeys', () => {
    it('writes keys.json with mode 0600 from an env-provided key', () => {
      process.env.TAVILY_API_KEY = 'tvly-ENV';
      const res = ensureSurfKeys();

      expect(res.written).toBe(true);
      expect(res.providers).toEqual(['tavily']);
      expect(statSync(res.path).mode & 0o777).toBe(0o600);

      const file = readKeysFile();
      expect(file.schema_version).toBe(1);
      expect(file.tavily.keys).toEqual(['tvly-ENV']);
      // Every provider section exists, even the empty ones — surf normalizes
      // the same way and this keeps the file shape stable.
      for (const provider of SURF_PROVIDERS) {
        expect(file[provider]).toMatchObject({ keys: expect.any(Array), current: 0 });
      }
    });

    it('carries N keys from the huu POOL, resolver winner first', () => {
      const spec = findSpec('tavily')!;
      addPoolKey(spec, 'tvly-A');
      addPoolKey(spec, 'tvly-B');
      // A secret-mount-like winner (here: the store mirror) leads.
      const file = (ensureSurfKeys(), readKeysFile());
      expect(file.tavily.keys).toEqual(['tvly-A', 'tvly-B']);
      expect(ensureSurfKeys().keyCount).toBe(2);
    });

    it('covers all three providers', () => {
      process.env.TAVILY_API_KEY = 'tvly-1';
      saveApiKey(findSpec('parallel')!, 'par-1');
      addPoolKey(findSpec('brave')!, 'brv-1');

      const res = ensureSurfKeys();
      expect(res.providers).toEqual(['tavily', 'parallel', 'brave']);
      const file = readKeysFile();
      expect(file.tavily.keys).toEqual(['tvly-1']);
      expect(file.parallel.keys).toEqual(['par-1']);
      expect(file.brave.keys).toEqual(['brv-1']);
    });

    it('MERGES with an existing keys.json: unions keys and PRESERVES learned state', () => {
      // The learned state is the only place rate-limit knowledge survives
      // between executions — overwriting it is never acceptable.
      writeExistingKeysFile({
        schema_version: 1,
        last_ok_provider: 'parallel',
        tavily: {
          keys: ['tvly-SURF-OLD', 'tvly-SURF-BURNED'],
          current: 1,
          burned: [{ index: 1, at: '2026-07-01T00:00:00.000Z', reason: '401' }],
          cooldowns: [{ index: 0, until: '2099-01-01T00:00:00.000Z' }],
        },
        parallel: { keys: ['par-SURF'], current: 0, burned: [], cooldowns: [] },
        brave: { keys: [], current: 0, burned: [], cooldowns: [] },
      });

      process.env.TAVILY_API_KEY = 'tvly-HUU';
      ensureSurfKeys();

      const file = readKeysFile();
      // huu's keys go FIRST, surf's keep their order after them.
      expect(file.tavily.keys).toEqual(['tvly-HUU', 'tvly-SURF-OLD', 'tvly-SURF-BURNED']);
      expect(file.last_ok_provider).toBe('parallel');
      // Untouched provider survives verbatim.
      expect(file.parallel.keys).toEqual(['par-SURF']);

      // …and every preserved index was REMAPPED, so it still points at the
      // SAME KEY. Keeping the raw index would have marked the fresh huu key
      // as burned — the exact opposite of preserving state.
      expect(file.tavily.keys[file.tavily.burned[0].index]).toBe('tvly-SURF-BURNED');
      expect(file.tavily.burned[0].reason).toBe('401');
      expect(file.tavily.cooldowns[0].until).toBe('2099-01-01T00:00:00.000Z');
      expect(file.tavily.keys[file.tavily.cooldowns[0].index]).toBe('tvly-SURF-OLD');
      expect(file.tavily.keys[file.tavily.current]).toBe('tvly-SURF-BURNED'); // was current: 1
    });

    it('does not duplicate a key huu and surf both hold (and keeps its state)', () => {
      writeExistingKeysFile({
        schema_version: 1,
        last_ok_provider: null,
        tavily: {
          keys: ['tvly-SHARED'],
          current: 0,
          burned: [],
          cooldowns: [{ index: 0, until: '2099-01-01T00:00:00.000Z' }],
        },
      });
      process.env.TAVILY_API_KEY = 'tvly-SHARED';
      ensureSurfKeys();

      const file = readKeysFile();
      expect(file.tavily.keys).toEqual(['tvly-SHARED']);
      expect(file.tavily.cooldowns).toHaveLength(1);
      expect(file.tavily.cooldowns[0].index).toBe(0);
    });

    it('LEAVES an existing file alone when huu has no keys at all', () => {
      writeExistingKeysFile({
        schema_version: 1,
        last_ok_provider: 'brave',
        brave: { keys: ['brv-SURF'], current: 0, burned: [], cooldowns: [] },
      });
      const before = readFileSync(surfKeysPath(), 'utf8');

      const res = ensureSurfKeys();
      expect(res.written).toBe(false);
      expect(res.reason).toMatch(/no surf provider keys/i);
      expect(readFileSync(surfKeysPath(), 'utf8')).toBe(before);
    });

    it('never throws on a corrupt existing file — it rebuilds from huu’s keys', () => {
      mkdirSync(join(tmpDir, 'home', '.config', 'surf'), { recursive: true });
      writeFileSync(surfKeysPath(), '{ not json at all');
      process.env.TAVILY_API_KEY = 'tvly-OK';

      const res = ensureSurfKeys();
      expect(res.written).toBe(true);
      expect(readKeysFile().tavily.keys).toEqual(['tvly-OK']);
    });

    it('is idempotent: a second call reproduces the same file', () => {
      process.env.TAVILY_API_KEY = 'tvly-1';
      ensureSurfKeys();
      const first = readFileSync(surfKeysPath(), 'utf8');
      ensureSurfKeys();
      expect(readFileSync(surfKeysPath(), 'utf8')).toBe(first);
    });
  });

  describe('probeSurf', () => {
    it('reports research/free false with a reason when the CLI is not on PATH', () => {
      const res = probeSurf({ PATH: join(tmpDir, 'empty-bin') } as NodeJS.ProcessEnv);
      expect(res.research).toBe(false);
      expect(res.free).toBe(false);
      expect(res.reason).toBeTruthy();
      expect(res.version).toBeUndefined();
    });

    it('caches per process (same PATH → same object)', () => {
      const env = { PATH: join(tmpDir, 'empty-bin') } as NodeJS.ProcessEnv;
      const a = probeSurf(env);
      const b = probeSurf(env);
      expect(b).toBe(a);
      resetSurfProbeCache();
      expect(probeSurf(env)).not.toBe(a);
    });

    it('detects a fake CLI on PATH and reads its --version', () => {
      const bin = join(tmpDir, 'bin');
      mkdirSync(bin, { recursive: true });
      writeFakeBin(join(bin, 'surf-research-skill'), '9.9.9');
      // surf-free-skill deliberately absent: published 5.0.0 has no keyless
      // tier, and `free` must tell the truth rather than assume it exists.
      const res = probeSurf({ PATH: bin } as NodeJS.ProcessEnv);
      expect(res.research).toBe(true);
      expect(res.version).toBe('9.9.9');
      expect(res.free).toBe(false);
      expect(res.reason).toBeUndefined();
    });
  });

  describe('readSurfUsage', () => {
    const FIXTURE = [
      '{"ts":"2026-07-01T10:00:00.000Z","op":"search","provider":"tavily","key_index":0,"credits":1,"cached":false,"latency_ms":812}',
      '{"ts":"2026-07-01T10:00:05.000Z","op":"search","provider":"tavily","credits":2,"cached":false}',
      '{"ts":"2026-07-01T10:00:09.000Z","op":"search","provider":"tavily","credits":0,"cached":true}',
      '{"ts":"2026-07-02T09:00:00.000Z","op":"research","provider":"parallel","credits":5,"cached":false}',
      '{"ts":"2026-07-02T09:30:00.000Z","op":"search","provider":"brave","credits":1,"cached":false}',
      // surf <= 4.x wrote no provider — bucketed, never dropped.
      '{"ts":"2026-05-01T00:59:12.833Z","endpoint":"/search","credits":1,"cached":false}',
      'not json at all',
      '',
    ].join('\n');

    function writeUsage(text: string): void {
      mkdirSync(join(tmpDir, 'home', '.cache', 'surf'), { recursive: true });
      writeFileSync(surfUsagePath(), text);
    }

    it('returns zeros when the ledger does not exist', () => {
      expect(readSurfUsage()).toEqual({ calls: 0, costUsd: 0, byProvider: {} });
    });

    it('parses the ledger, buckets by provider and skips malformed lines', () => {
      writeUsage(FIXTURE);
      const usage = readSurfUsage();

      expect(usage.calls).toBe(6);
      expect(usage.byProvider.tavily).toEqual({ calls: 3, credits: 3, costUsd: 3 * 0.008 });
      expect(usage.byProvider.parallel).toEqual({ calls: 1, credits: 5, costUsd: 5 * 0.005 });
      expect(usage.byProvider.brave).toEqual({ calls: 1, credits: 1, costUsd: 0.003 });
      expect(usage.byProvider.unknown.calls).toBe(1);
      expect(usage.costUsd).toBeCloseTo(3 * 0.008 + 5 * 0.005 + 0.003 + 0.005, 10);
    });

    it('honors the sinceMs window', () => {
      writeUsage(FIXTURE);
      const usage = readSurfUsage(Date.parse('2026-07-02T00:00:00.000Z'));
      expect(usage.calls).toBe(2);
      expect(usage.byProvider.tavily).toBeUndefined();
      expect(usage.byProvider.parallel.calls).toBe(1);
      expect(usage.byProvider.brave.calls).toBe(1);
    });

    it('an explicit cost_usd on a line WINS over the estimate table', () => {
      writeUsage('{"ts":"2026-07-01T10:00:00.000Z","provider":"tavily","credits":10,"cost_usd":0.42}');
      expect(readSurfUsage().costUsd).toBe(0.42);
    });

    it('HUU_SURF_CREDIT_USD_<PROVIDER> overrides the estimate', () => {
      process.env.HUU_SURF_CREDIT_USD_TAVILY = '0.1';
      writeUsage('{"ts":"2026-07-01T10:00:00.000Z","provider":"tavily","credits":2,"cached":false}');
      expect(readSurfUsage().costUsd).toBeCloseTo(0.2, 10);
    });

    it('formatSurfUsage renders the one-line run summary, empty when idle', () => {
      writeUsage(FIXTURE);
      const line = formatSurfUsage(readSurfUsage());
      expect(line).toMatch(/^web research: 6 calls, \$0\.\d{4} \(/);
      expect(line).toContain('tavily 3');
      expect(line).toContain('parallel 1');
      expect(formatSurfUsage({ calls: 0, costUsd: 0, byProvider: {} })).toBe('');
    });
  });

  function writeExistingKeysFile(state: Record<string, unknown>): void {
    mkdirSync(join(tmpDir, 'home', '.config', 'surf'), { recursive: true });
    writeFileSync(surfKeysPath(), JSON.stringify(state, null, 2), { mode: 0o600 });
  }

  function writeFakeBin(path: string, version: string): void {
    writeFileSync(path, `#!/bin/sh\necho "${version}"\n`, { mode: 0o755 });
  }
});
