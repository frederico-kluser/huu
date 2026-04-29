import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOpenRouterApiKey } from './api-key.js';

describe('resolveOpenRouterApiKey', () => {
  const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENROUTER_API_KEY_FILE'] as const;
  const saved: Record<string, string | undefined> = {};
  let tmpDir: string;

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    tmpDir = mkdtempSync(join(tmpdir(), 'huu-api-key-test-'));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty string when nothing is set', () => {
    expect(resolveOpenRouterApiKey()).toBe('');
  });

  it('reads OPENROUTER_API_KEY when set', () => {
    process.env.OPENROUTER_API_KEY = '  sk-or-plain  ';
    expect(resolveOpenRouterApiKey()).toBe('sk-or-plain');
  });

  it('reads OPENROUTER_API_KEY_FILE and trims whitespace/newlines', () => {
    const path = join(tmpDir, 'key.txt');
    writeFileSync(path, 'sk-or-from-file\n');
    process.env.OPENROUTER_API_KEY_FILE = path;
    expect(resolveOpenRouterApiKey()).toBe('sk-or-from-file');
  });

  it('OPENROUTER_API_KEY_FILE wins over OPENROUTER_API_KEY when both are set', () => {
    const path = join(tmpDir, 'key.txt');
    writeFileSync(path, 'sk-or-from-file');
    process.env.OPENROUTER_API_KEY_FILE = path;
    process.env.OPENROUTER_API_KEY = 'sk-or-plain';
    // /run/secrets path doesn't exist, _FILE does — _FILE wins.
    expect(resolveOpenRouterApiKey()).toBe('sk-or-from-file');
  });

  it('falls back to OPENROUTER_API_KEY when _FILE points at a missing path', () => {
    process.env.OPENROUTER_API_KEY_FILE = join(tmpDir, 'does-not-exist');
    process.env.OPENROUTER_API_KEY = 'sk-or-fallback';
    expect(resolveOpenRouterApiKey()).toBe('sk-or-fallback');
  });

  it('returns empty when the _FILE path exists but is empty', () => {
    const path = join(tmpDir, 'empty.txt');
    writeFileSync(path, '   \n  \t\n');
    process.env.OPENROUTER_API_KEY_FILE = path;
    expect(resolveOpenRouterApiKey()).toBe('');
  });
});
