import Database from 'better-sqlite3';
import fs from 'node:fs';

// ── PRAGMA configuration ────────────────────────────────────────────

export interface DatabaseConfig {
  /** Cache size in KB (negative = KB, positive = pages). Default: -65536 (~64MB) */
  cacheSizeKb?: number;
  /** synchronous mode. Default: 'NORMAL' */
  synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
  /** busy_timeout in ms. Default: 5000 */
  busyTimeoutMs?: number;
  /** WAL autocheckpoint threshold (pages). Default: 1000 */
  walAutocheckpoint?: number;
}

const PRAGMA_DEFAULTS: Required<DatabaseConfig> = {
  cacheSizeKb: -65536, // ~64MB cache
  synchronous: 'NORMAL',
  busyTimeoutMs: 5000,
  walAutocheckpoint: 1000,
};

/**
 * Open (or create) the project SQLite database with production pragmas.
 * WAL mode enables concurrent readers + single writer without SQLITE_BUSY.
 *
 * Optimized for large histories (10k+ to 1M+ records):
 * - WAL journal for concurrent reads
 * - ~64MB cache to reduce disk reads
 * - MEMORY temp_store for fast temporary tables
 * - Configurable synchronous mode
 */
export function openDatabase(
  filePath: string,
  config?: DatabaseConfig,
): Database.Database {
  const cfg = { ...PRAGMA_DEFAULTS, ...config };
  const db = new Database(filePath, { timeout: cfg.busyTimeoutMs });

  // Core pragmas — order matters: journal_mode first
  db.pragma('journal_mode = WAL');
  db.pragma(`synchronous = ${cfg.synchronous}`);
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${cfg.busyTimeoutMs}`);
  db.pragma('temp_store = MEMORY');
  db.pragma(`cache_size = ${cfg.cacheSizeKb}`);
  db.pragma(`wal_autocheckpoint = ${cfg.walAutocheckpoint}`);

  // Verify pragmas were applied correctly
  verifyPragma(db, 'journal_mode', 'wal');
  verifyPragma(db, 'foreign_keys', 1);

  return db;
}

/**
 * Read back a PRAGMA value and log a warning if it doesn't match expected.
 * SQLite silently ignores unknown PRAGMAs — this catches configuration drift.
 */
function verifyPragma(
  db: Database.Database,
  pragma: string,
  expected: string | number,
): void {
  const actual = db.pragma(pragma, { simple: true });
  const normalizedActual = typeof actual === 'string' ? actual.toLowerCase() : actual;
  const normalizedExpected = typeof expected === 'string' ? expected.toLowerCase() : expected;
  if (normalizedActual !== normalizedExpected) {
    console.warn(
      `[huu:db] PRAGMA ${pragma} expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

/** Returns current WAL mode and FK status for health checks. */
export function getDatabaseHealth(db: Database.Database): {
  journalMode: string;
  foreignKeys: number;
  walAutoCheckpoint: number;
  cacheSize: number;
  synchronous: number;
} {
  const journalMode = db.pragma('journal_mode', { simple: true }) as string;
  const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  const walAutoCheckpoint = db.pragma('wal_autocheckpoint', {
    simple: true,
  }) as number;
  const cacheSize = db.pragma('cache_size', { simple: true }) as number;
  const synchronous = db.pragma('synchronous', { simple: true }) as number;
  return { journalMode, foreignKeys, walAutoCheckpoint, cacheSize, synchronous };
}

/** Force a WAL checkpoint. Use when -wal file grows beyond threshold. */
export function walCheckpoint(
  db: Database.Database,
  mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'RESTART',
): { busy: number; log: number; checkpointed: number } {
  const result = db.pragma(`wal_checkpoint(${mode})`) as Array<{
    busy: number;
    log: number;
    checkpointed: number;
  }>;
  return result[0]!;
}

/**
 * Run PRAGMA optimize to update SQLite's internal statistics.
 * Should be called periodically (e.g., at session end or after bulk inserts).
 */
export function optimizeDatabase(db: Database.Database): void {
  db.pragma('optimize');
}

/**
 * Monitor WAL file size and trigger checkpoint if it exceeds threshold.
 * Returns the WAL file size in bytes, or -1 if not found.
 */
export function monitorWalSize(
  db: Database.Database,
  dbPath: string,
  thresholdBytes: number = 50 * 1024 * 1024, // 50MB default
): { walSizeBytes: number; checkpointed: boolean } {
  const walPath = dbPath + '-wal';
  let walSizeBytes = -1;
  let checkpointed = false;

  try {
    const stat = fs.statSync(walPath);
    walSizeBytes = stat.size;

    if (walSizeBytes > thresholdBytes) {
      walCheckpoint(db, 'RESTART');
      checkpointed = true;
    }
  } catch {
    // WAL file may not exist (empty db or after truncate)
  }

  return { walSizeBytes, checkpointed };
}
