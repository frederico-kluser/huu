import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDefaultConfig,
  validateConfig,
  writeConfigAtomic,
  loadConfig,
  configExists,
  huuDirExists,
  getConfigPath,
  getDbPath,
  getHuuDir,
  getConfigValue,
  setConfigValue,
  CONFIGURABLE_KEYS,
} from '../config.js';
import type { HuuConfig } from '../config.js';

describe('Config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huu-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createDefaultConfig', () => {
    it('should create a valid default config', () => {
      const config = createDefaultConfig();
      expect(config.version).toBe(1);
      expect(config.projectRoot).toBe('.');
      expect(config.database.journalMode).toBe('WAL');
      expect(config.orchestrator.maxConcurrency).toBe(5);
      expect(config.logging.level).toBe('notice');
    });
  });

  describe('validateConfig', () => {
    it('should validate a correct config', () => {
      const config = createDefaultConfig();
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject null', () => {
      const result = validateConfig(null);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid version', () => {
      const config = createDefaultConfig();
      (config as Record<string, unknown>)['version'] = 0;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('version'))).toBe(true);
    });

    it('should reject invalid maxConcurrency', () => {
      const config = createDefaultConfig();
      config.orchestrator.maxConcurrency = 50;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('maxConcurrency')),
      ).toBe(true);
    });

    it('should reject invalid model', () => {
      const config = createDefaultConfig();
      config.orchestrator.defaultAgentModel.orchestrator = 'gpt4';
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid log level', () => {
      const config = createDefaultConfig();
      config.logging.level = 'verbose';
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  describe('writeConfigAtomic / loadConfig', () => {
    it('should write and read config atomically', () => {
      const huuDir = path.join(tmpDir, '.huu');
      fs.mkdirSync(huuDir, { recursive: true });

      const config = createDefaultConfig();
      writeConfigAtomic(tmpDir, config);

      const loaded = loadConfig(tmpDir);
      expect(loaded.version).toBe(config.version);
      expect(loaded.orchestrator.maxConcurrency).toBe(
        config.orchestrator.maxConcurrency,
      );
    });

    it('should throw for missing config', () => {
      expect(() => loadConfig(tmpDir)).toThrow();
    });

    it('should throw for invalid JSON', () => {
      const huuDir = path.join(tmpDir, '.huu');
      fs.mkdirSync(huuDir, { recursive: true });
      fs.writeFileSync(path.join(huuDir, 'config.json'), 'not json');
      expect(() => loadConfig(tmpDir)).toThrow();
    });
  });

  describe('path helpers', () => {
    it('getConfigPath returns correct path', () => {
      expect(getConfigPath('/foo')).toBe('/foo/.huu/config.json');
    });

    it('getDbPath returns correct path', () => {
      expect(getDbPath('/foo')).toBe('/foo/.huu/huu.db');
    });

    it('getHuuDir returns correct path', () => {
      expect(getHuuDir('/foo')).toBe('/foo/.huu');
    });

    it('configExists returns false when missing', () => {
      expect(configExists(tmpDir)).toBe(false);
    });

    it('huuDirExists returns false when missing', () => {
      expect(huuDirExists(tmpDir)).toBe(false);
    });

    it('configExists returns true when present', () => {
      const huuDir = path.join(tmpDir, '.huu');
      fs.mkdirSync(huuDir, { recursive: true });
      fs.writeFileSync(
        path.join(huuDir, 'config.json'),
        JSON.stringify(createDefaultConfig()),
      );
      expect(configExists(tmpDir)).toBe(true);
    });
  });

  describe('getConfigValue / setConfigValue', () => {
    it('should get maxConcurrency', () => {
      const config = createDefaultConfig();
      expect(getConfigValue(config, 'orchestrator.maxConcurrency')).toBe(5);
    });

    it('should set maxConcurrency', () => {
      const config = createDefaultConfig();
      setConfigValue(config, 'orchestrator.maxConcurrency', 10);
      expect(config.orchestrator.maxConcurrency).toBe(10);
    });

    it('should get/set log level', () => {
      const config = createDefaultConfig();
      setConfigValue(config, 'logging.level', 'debug');
      expect(getConfigValue(config, 'logging.level')).toBe('debug');
    });

    it('should get/set model', () => {
      const config = createDefaultConfig();
      setConfigValue(
        config,
        'orchestrator.defaultAgentModel.worker',
        'haiku',
      );
      expect(
        getConfigValue(config, 'orchestrator.defaultAgentModel.worker'),
      ).toBe('haiku');
    });
  });

  describe('CONFIGURABLE_KEYS', () => {
    it('should have entries for all configurable fields', () => {
      expect(CONFIGURABLE_KEYS.length).toBeGreaterThanOrEqual(5);
      const keys = CONFIGURABLE_KEYS.map((k) => k.key);
      expect(keys).toContain('orchestrator.maxConcurrency');
      expect(keys).toContain('logging.level');
    });
  });
});
