import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  effectiveRamPercent,
  loadWebSettings,
  saveWebSettings,
  webSettingsPath,
} from './web-settings.js';
import { DEFAULT_RAM_PERCENT } from './budget.js';

describe('web-settings', () => {
  it('webSettingsPath honors XDG_CONFIG_HOME', () => {
    expect(webSettingsPath({ XDG_CONFIG_HOME: '/x/cfg' })).toBe('/x/cfg/huu/web-settings.json');
    expect(webSettingsPath({})).toMatch(/\.config\/huu\/web-settings\.json$/);
  });

  it('webSettingsPath prefers HUU_CONFIG_DIR (the docker-mounted host config dir)', () => {
    expect(
      webSettingsPath({ HUU_CONFIG_DIR: '/host/.config/huu', XDG_CONFIG_HOME: '/x/cfg' }),
    ).toBe('/host/.config/huu/web-settings.json');
    expect(webSettingsPath({ HUU_CONFIG_DIR: '   ', XDG_CONFIG_HOME: '/x/cfg' })).toBe(
      '/x/cfg/huu/web-settings.json',
    );
  });

  it('round-trips settings through save + load (mkdir -p)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'huu-websettings-'));
    try {
      const path = join(dir, 'nested', 'web-settings.json');
      expect(saveWebSettings({ ramPercent: 50 }, path)).toBe(true);
      expect(loadWebSettings(path)).toEqual({ ramPercent: 50 });
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ramPercent: 50 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clamps a persisted out-of-range dial on load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'huu-websettings-'));
    try {
      const path = join(dir, 'web-settings.json');
      writeFileSync(path, JSON.stringify({ ramPercent: 999 }), 'utf8');
      expect(loadWebSettings(path)).toEqual({ ramPercent: 95 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('missing/corrupt file degrades to {} (never throws)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'huu-websettings-'));
    try {
      expect(loadWebSettings(join(dir, 'absent.json'))).toEqual({});
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, 'not json{', 'utf8');
      expect(loadWebSettings(bad)).toEqual({});
      writeFileSync(bad, JSON.stringify({ ramPercent: 'high' }), 'utf8');
      expect(loadWebSettings(bad)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('save reports false when the location is unwritable (degrade, never block)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'huu-websettings-'));
    try {
      // A FILE where the parent dir should be → mkdir fails → false.
      const blocker = join(dir, 'blocker');
      writeFileSync(blocker, 'x', 'utf8');
      const path = join(blocker, 'web-settings.json');
      expect(saveWebSettings({ ramPercent: 50 }, path)).toBe(false);
      void dirname; // (imported for symmetry with the module under test)
      void mkdirSync;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The layering that makes the dial MACHINE-global instead of web-only. Before
 * `effectiveRamPercent` the persisted store was consulted by the web alone, so a
 * dial saved from ⚙ Settings was silently ignored by the Ink TUI and by every
 * headless run.
 */
describe('effectiveRamPercent — explicit → stored → env → default', () => {
  const withEnv = (value: string | undefined, fn: () => void): void => {
    const prev = process.env.HUU_RAM_PERCENT;
    if (value === undefined) delete process.env.HUU_RAM_PERCENT;
    else process.env.HUU_RAM_PERCENT = value;
    try {
      fn();
    } finally {
      if (prev === undefined) delete process.env.HUU_RAM_PERCENT;
      else process.env.HUU_RAM_PERCENT = prev;
    }
  };

  const inTempStore = (fn: (path: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'huu-effective-ram-'));
    try {
      fn(join(dir, 'web-settings.json'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('an explicit value wins over everything (CLI flag / run config)', () => {
    inTempStore((path) => {
      saveWebSettings({ ramPercent: 40 }, path);
      withEnv('55', () => {
        expect(effectiveRamPercent(80, path)).toBe(80);
      });
    });
  });

  it('the persisted dial outranks the env var', () => {
    inTempStore((path) => {
      saveWebSettings({ ramPercent: 40 }, path);
      withEnv('55', () => {
        expect(effectiveRamPercent(undefined, path)).toBe(40);
      });
    });
  });

  it('falls back to the env var when nothing is persisted', () => {
    inTempStore((path) => {
      withEnv('55', () => {
        expect(effectiveRamPercent(undefined, path)).toBe(55);
      });
    });
  });

  it('falls back to the default when neither store nor env is set', () => {
    inTempStore((path) => {
      withEnv(undefined, () => {
        expect(effectiveRamPercent(undefined, path)).toBe(DEFAULT_RAM_PERCENT);
      });
    });
  });

  it('clamps at every layer, and a non-finite explicit value defers downward', () => {
    inTempStore((path) => {
      saveWebSettings({ ramPercent: 40 }, path);
      withEnv(undefined, () => {
        expect(effectiveRamPercent(999, path)).toBe(95);
        expect(effectiveRamPercent(1, path)).toBe(10);
        // NaN is not a choice — fall through to the stored dial.
        expect(effectiveRamPercent(Number.NaN, path)).toBe(40);
      });
    });
  });
});
