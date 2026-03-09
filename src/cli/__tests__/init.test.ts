import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initAction } from '../commands/init.js';
import { loadConfig } from '../config.js';
import { setGlobalLogger, Logger } from '../logger.js';

describe('huu init', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huu-init-test-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // Use quiet logger for tests
    setGlobalLogger(new Logger('quiet'));
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create .huu directory, database, and config', async () => {
    await initAction({ yes: true });

    expect(fs.existsSync(path.join(tmpDir, '.huu'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.huu', 'huu.db'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.huu', 'config.json'))).toBe(
      true,
    );
  });

  it('should create a valid config file', async () => {
    await initAction({ yes: true });
    const config = loadConfig(tmpDir);
    expect(config.version).toBe(2);
    expect(config.database.journalMode).toBe('WAL');
    expect(config.orchestrator.maxConcurrency).toBe(5);
  });

  it('should create database with WAL mode', async () => {
    await initAction({ yes: true });

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(tmpDir, '.huu', 'huu.db'));
    const journalMode = db.pragma('journal_mode', { simple: true }) as string;
    expect(journalMode.toLowerCase()).toBe('wal');
    db.close();
  });

  it('should run migrations and create schema', async () => {
    await initAction({ yes: true });

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(tmpDir, '.huu', 'huu.db'));

    // Check that schema_migrations table exists and has entries
    const migrations = db
      .prepare('SELECT * FROM schema_migrations')
      .all();
    expect(migrations.length).toBeGreaterThan(0);

    // Check for core tables
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('messages');
    expect(tableNames).toContain('audit_log');

    db.close();
  });

  it('should be idempotent (re-run safely)', async () => {
    await initAction({ yes: true });

    // Re-run
    await initAction({ yes: true });

    // Everything should still be valid
    const config = loadConfig(tmpDir);
    expect(config.version).toBe(2);

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(tmpDir, '.huu', 'huu.db'));
    const journalMode = db.pragma('journal_mode', { simple: true }) as string;
    expect(journalMode.toLowerCase()).toBe('wal');
    db.close();
  });

  it('should not overwrite existing config without --force', async () => {
    await initAction({ yes: true });

    // Modify config manually
    const configPath = path.join(tmpDir, '.huu', 'config.json');
    const original = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    original.orchestrator.maxConcurrency = 10;
    fs.writeFileSync(configPath, JSON.stringify(original, null, 2));

    // Re-run without force
    await initAction({ yes: true });

    // Config should still have modified value
    const config = loadConfig(tmpDir);
    expect(config.orchestrator.maxConcurrency).toBe(10);
  });

  it('should overwrite config with --force', async () => {
    await initAction({ yes: true });

    // Modify config
    const configPath = path.join(tmpDir, '.huu', 'config.json');
    const original = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    original.orchestrator.maxConcurrency = 10;
    fs.writeFileSync(configPath, JSON.stringify(original, null, 2));

    // Re-run with force
    await initAction({ yes: true, force: true });

    // Config should be reset to defaults
    const config = loadConfig(tmpDir);
    expect(config.orchestrator.maxConcurrency).toBe(5);
  });

  it('--dry-run should produce no filesystem mutations', async () => {
    await initAction({ dryRun: true });

    expect(fs.existsSync(path.join(tmpDir, '.huu'))).toBe(false);
  });
});
