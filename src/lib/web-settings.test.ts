import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadWebSettings, saveWebSettings, webSettingsPath } from './web-settings.js';

describe('web-settings', () => {
  it('webSettingsPath honors XDG_CONFIG_HOME', () => {
    expect(webSettingsPath({ XDG_CONFIG_HOME: '/x/cfg' })).toBe('/x/cfg/huu/web-settings.json');
    expect(webSettingsPath({})).toMatch(/\.config\/huu\/web-settings\.json$/);
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
