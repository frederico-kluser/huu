import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../connection.js';
import { migrate, getAppliedMigrations } from '../migrator.js';

let db: Database.Database;
let tempDir: string;

afterEach(() => {
  db?.close();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTempMigrationDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'huu-test-mig-'));
  return tempDir;
}

describe('migrate', () => {
  it('should apply migrations from empty database', () => {
    db = openDatabase(':memory:');
    const dir = createTempMigrationDir();

    writeFileSync(
      join(dir, '0001_test.sql'),
      `CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT NOT NULL);`,
    );

    const result = migrate(db, dir);
    expect(result.applied).toBe(1);
    expect(result.current).toBe(1);

    // Verify table was created
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'",
      )
      .all();
    expect(tables).toHaveLength(1);
  });

  it('should skip already-applied migrations', () => {
    db = openDatabase(':memory:');
    const dir = createTempMigrationDir();

    writeFileSync(
      join(dir, '0001_test.sql'),
      `CREATE TABLE test_table (id INTEGER PRIMARY KEY);`,
    );

    const first = migrate(db, dir);
    expect(first.applied).toBe(1);

    const second = migrate(db, dir);
    expect(second.applied).toBe(0);
    expect(second.current).toBe(1);
  });

  it('should apply multiple migrations in order', () => {
    db = openDatabase(':memory:');
    const dir = createTempMigrationDir();

    writeFileSync(
      join(dir, '0001_create_a.sql'),
      `CREATE TABLE table_a (id INTEGER PRIMARY KEY);`,
    );
    writeFileSync(
      join(dir, '0002_create_b.sql'),
      `CREATE TABLE table_b (id INTEGER PRIMARY KEY);`,
    );

    const result = migrate(db, dir);
    expect(result.applied).toBe(2);
    expect(result.current).toBe(2);

    const applied = getAppliedMigrations(db);
    expect(applied).toHaveLength(2);
    expect(applied[0]!.version).toBe(1);
    expect(applied[1]!.version).toBe(2);
  });

  it('should detect checksum mismatch for modified migration', () => {
    db = openDatabase(':memory:');
    const dir = createTempMigrationDir();

    writeFileSync(
      join(dir, '0001_test.sql'),
      `CREATE TABLE test_table (id INTEGER PRIMARY KEY);`,
    );
    migrate(db, dir);

    // Tamper with the migration file
    writeFileSync(
      join(dir, '0001_test.sql'),
      `CREATE TABLE test_table (id INTEGER PRIMARY KEY, extra TEXT);`,
    );

    expect(() => migrate(db, dir)).toThrow('checksum mismatch');
  });

  it('should resume from partially migrated state', () => {
    db = openDatabase(':memory:');
    const dir = createTempMigrationDir();

    writeFileSync(
      join(dir, '0001_create_a.sql'),
      `CREATE TABLE table_a (id INTEGER PRIMARY KEY);`,
    );

    migrate(db, dir);

    // Add new migration
    writeFileSync(
      join(dir, '0002_create_b.sql'),
      `CREATE TABLE table_b (id INTEGER PRIMARY KEY);`,
    );

    const result = migrate(db, dir);
    expect(result.applied).toBe(1);
    expect(result.current).toBe(2);
  });

  it('should set PRAGMA user_version', () => {
    db = openDatabase(':memory:');
    const dir = createTempMigrationDir();

    writeFileSync(
      join(dir, '0001_test.sql'),
      `CREATE TABLE test_table (id INTEGER PRIMARY KEY);`,
    );

    migrate(db, dir);
    const version = db.pragma('user_version', { simple: true });
    expect(version).toBe(1);
  });
});

describe('getAppliedMigrations', () => {
  it('should return empty array for fresh database', () => {
    db = openDatabase(':memory:');
    const applied = getAppliedMigrations(db);
    expect(applied).toEqual([]);
  });
});
