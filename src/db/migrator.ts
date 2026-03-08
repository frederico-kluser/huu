import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { SchemaMigration } from '../types/index.js';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

function computeChecksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Load migration files from disk, sorted by version number. */
function loadMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  files.sort();

  return files.map((filename) => {
    const match = /^(\d+)_(.+)\.sql$/.exec(filename);
    if (!match) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }
    const sql = readFileSync(join(dir, filename), 'utf-8');
    return {
      version: parseInt(match[1]!, 10),
      name: match[2]!,
      sql,
      checksum: computeChecksum(sql),
    };
  });
}

/** Ensure the schema_migrations tracking table exists. */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

/** Get all applied migrations from the database. */
export function getAppliedMigrations(
  db: Database.Database,
): SchemaMigration[] {
  ensureMigrationsTable(db);
  return db
    .prepare('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version')
    .all() as SchemaMigration[];
}

/**
 * Run all pending migrations in order.
 * Each migration runs inside BEGIN IMMEDIATE to prevent concurrent runs.
 * Checksum validation detects tampered previously-applied migrations.
 */
export function migrate(
  db: Database.Database,
  dir: string = MIGRATIONS_DIR,
): { applied: number; current: number } {
  ensureMigrationsTable(db);

  const migrations = loadMigrationFiles(dir);
  const applied = new Map<number, SchemaMigration>();

  for (const row of getAppliedMigrations(db)) {
    applied.set(row.version, row);
  }

  // Validate checksums of already-applied migrations
  for (const mig of migrations) {
    const existing = applied.get(mig.version);
    if (existing && existing.checksum !== mig.checksum) {
      throw new Error(
        `Migration ${mig.version}_${mig.name} checksum mismatch: ` +
          `expected ${existing.checksum}, got ${mig.checksum}. ` +
          `Applied migrations must not be modified.`,
      );
    }
  }

  let appliedCount = 0;
  let currentVersion = 0;

  for (const mig of migrations) {
    if (applied.has(mig.version)) {
      currentVersion = mig.version;
      continue;
    }

    const runMigration = db.transaction(() => {
      db.exec(mig.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
      ).run(mig.version, mig.name, mig.checksum);
      db.pragma(`user_version = ${mig.version}`);
    });

    runMigration.immediate();
    appliedCount++;
    currentVersion = mig.version;
  }

  return { applied: appliedCount, current: currentVersion };
}
