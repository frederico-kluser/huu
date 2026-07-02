import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveHermeticEnabled,
  hermeticAgentDir,
  loadRepoContextFiles,
  buildPiSessionEnvironment,
} from './hermetic.js';

/** Recursive name-only snapshot of a tree — order-stable for equality checks. */
function snapshotTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      out.push(rel);
      if (e.isDirectory()) walk(join(dir, e.name), rel);
    }
  };
  walk(root, '');
  return out;
}

/**
 * A fake $HOME seeded with the exact host-global state that used to leak into
 * huu agents: an auth.json canary provider, a settings.json with a `packages`
 * entry (the pi-animations vector), and a skill.
 */
function seedFakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'huu-hermetic-home-'));
  const agent = join(home, '.pi', 'agent');
  mkdirSync(join(agent, 'skills', 'canary'), { recursive: true });
  writeFileSync(
    join(agent, 'auth.json'),
    JSON.stringify({ canaryprov: { type: 'api-key', key: 'CANARY' } }),
  );
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['pi-animations'] }));
  writeFileSync(
    join(agent, 'skills', 'canary', 'SKILL.md'),
    '---\nname: canary\ndescription: leaked host skill\n---\nBODY\n',
  );
  return home;
}

const SAVED_KEYS = ['HOME', 'HUU_HOST_HOME', 'PI_CODING_AGENT_DIR'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of SAVED_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of SAVED_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveHermeticEnabled', () => {
  it('defaults ON; only explicit 0/false opt out', () => {
    expect(resolveHermeticEnabled({})).toBe(true);
    expect(resolveHermeticEnabled({ HUU_PI_HERMETIC: '1' })).toBe(true);
    expect(resolveHermeticEnabled({ HUU_PI_HERMETIC: '0' })).toBe(false);
    expect(resolveHermeticEnabled({ HUU_PI_HERMETIC: 'false' })).toBe(false);
    expect(resolveHermeticEnabled({ HUU_PI_HERMETIC: ' FALSE ' })).toBe(false);
  });
});

describe('loadRepoContextFiles', () => {
  it('reads AGENTS.md/CLAUDE.md from the cwd root ONLY — never ancestors', () => {
    const parent = mkdtempSync(join(tmpdir(), 'huu-ctx-'));
    writeFileSync(join(parent, 'AGENTS.md'), 'PARENT GUIDANCE');
    const repo = join(parent, 'repo');
    mkdirSync(repo);
    writeFileSync(join(repo, 'AGENTS.md'), 'REPO GUIDANCE');
    const files = loadRepoContextFiles(repo);
    expect(files).toHaveLength(1);
    expect(files[0]!.content).toBe('REPO GUIDANCE');
    expect(files[0]!.path).toBe(join(repo, 'AGENTS.md'));
  });

  it('dedupes a CLAUDE.md -> AGENTS.md symlink by realpath (huu-style repos)', () => {
    const repo = mkdtempSync(join(tmpdir(), 'huu-ctx-'));
    writeFileSync(join(repo, 'AGENTS.md'), 'ONE CONTENT');
    symlinkSync(join(repo, 'AGENTS.md'), join(repo, 'CLAUDE.md'));
    const files = loadRepoContextFiles(repo);
    expect(files).toHaveLength(1);
  });

  it('missing/empty files → empty list, never throws', () => {
    const repo = mkdtempSync(join(tmpdir(), 'huu-ctx-'));
    writeFileSync(join(repo, 'CLAUDE.md'), '   \n');
    expect(loadRepoContextFiles(repo)).toEqual([]);
    expect(loadRepoContextFiles(join(repo, 'nope'))).toEqual([]);
  });
});

describe('buildPiSessionEnvironment — hermetic (default)', () => {
  it('CANARY: never reads host ~/.pi (auth invisible, discovery empty, tree untouched)', async () => {
    const home = seedFakeHome();
    process.env.HOME = home;
    process.env.HUU_HOST_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const cwd = mkdtempSync(join(tmpdir(), 'huu-wt-'));
    const before = snapshotTree(join(home, '.pi'));

    const fakeEnv: NodeJS.ProcessEnv = {};
    const piEnv = await buildPiSessionEnvironment({
      provider: 'openrouter',
      apiKey: 'sk-run-key',
      providerConfig: { headers: { 'X-Test': '1' } } as never,
      cwd,
      env: fakeEnv,
    });

    expect(piEnv.hermetic).toBe(true);
    // The host auth canary is INVISIBLE; the run key is what resolves.
    expect(piEnv.authStorage.has('canaryprov')).toBe(false);
    expect(piEnv.authStorage.getApiKey('openrouter')).toBeTruthy();
    // Settings are in-memory — the settings.json `packages` vector is dead.
    expect(piEnv.settingsManager!.getPackages()).toEqual([]);
    // Every discovery surface is empty despite the seeded host skill/packages.
    const loader = piEnv.resourceLoader!;
    expect(loader.getExtensions().extensions).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);
    expect(loader.getPrompts().prompts).toEqual([]);
    expect(loader.getThemes().themes).toEqual([]);
    expect(loader.getSystemPrompt()).toBeUndefined();
    expect(loader.getAppendSystemPrompt()).toEqual([]);
    // And the host ~/.pi tree is byte-structure identical (nothing created).
    expect(snapshotTree(join(home, '.pi'))).toEqual(before);
  });

  it('creates the huu-owned agent dir and exports PI_CODING_AGENT_DIR only when unset', async () => {
    const home = seedFakeHome();
    process.env.HOME = home;
    process.env.HUU_HOST_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const cwd = mkdtempSync(join(tmpdir(), 'huu-wt-'));

    const fakeEnv: NodeJS.ProcessEnv = {};
    const piEnv = await buildPiSessionEnvironment({
      provider: 'openrouter',
      apiKey: 'k',
      cwd,
      env: fakeEnv,
    });
    expect(piEnv.agentDir).toBe(join(home, '.huu', 'pi-agent'));
    expect(snapshotTree(join(home, '.huu'))).toContain('pi-agent');
    expect(fakeEnv.PI_CODING_AGENT_DIR).toBe(piEnv.agentDir);

    // Preset value is NEVER overwritten (user override wins).
    const preset: NodeJS.ProcessEnv = { PI_CODING_AGENT_DIR: '/user/custom' };
    await buildPiSessionEnvironment({ provider: 'openrouter', apiKey: 'k', cwd, env: preset });
    expect(preset.PI_CODING_AGENT_DIR).toBe('/user/custom');
  });

  it('injects SCOPED repo context (worktree root only) — and none when disabled', async () => {
    const home = seedFakeHome();
    process.env.HOME = home;
    process.env.HUU_HOST_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const parent = mkdtempSync(join(tmpdir(), 'huu-wt-'));
    writeFileSync(join(parent, 'AGENTS.md'), 'PARENT');
    const cwd = join(parent, 'repo');
    mkdirSync(cwd);
    writeFileSync(join(cwd, 'CLAUDE.md'), 'REPO RULES');

    const withCtx = await buildPiSessionEnvironment({
      provider: 'openrouter',
      apiKey: 'k',
      cwd,
      env: {},
    });
    const files = withCtx.resourceLoader!.getAgentsFiles().agentsFiles;
    expect(files).toHaveLength(1);
    expect(files[0]!.content).toBe('REPO RULES');

    const noCtx = await buildPiSessionEnvironment({
      provider: 'openrouter',
      apiKey: 'k',
      cwd,
      includeRepoContext: false,
      env: {},
    });
    expect(noCtx.resourceLoader!.getAgentsFiles().agentsFiles).toEqual([]);
  });
});

describe('buildPiSessionEnvironment — legacy escape hatch (HUU_PI_HERMETIC=0)', () => {
  it('reproduces host-global behavior: file-backed auth sees the host canary', async () => {
    const home = seedFakeHome();
    process.env.HOME = home;
    process.env.HUU_HOST_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR; // AuthStorage.create() resolves via homedir()
    const cwd = mkdtempSync(join(tmpdir(), 'huu-wt-'));

    const piEnv = await buildPiSessionEnvironment({
      provider: 'openrouter',
      apiKey: 'k',
      cwd,
      env: { HUU_PI_HERMETIC: '0' },
    });
    expect(piEnv.hermetic).toBe(false);
    expect(piEnv.agentDir).toBeUndefined();
    expect(piEnv.settingsManager).toBeUndefined();
    expect(piEnv.resourceLoader).toBeUndefined();
    // The legacy composition reads the HOST auth store — the canary is visible.
    expect(piEnv.authStorage.has('canaryprov')).toBe(true);
  });
});
