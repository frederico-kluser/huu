import Database from 'better-sqlite3';

/**
 * Open (or create) the project SQLite database with production pragmas.
 * WAL mode enables concurrent readers + single writer without SQLITE_BUSY.
 */
export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath, { timeout: 5000 });

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  db.pragma('wal_autocheckpoint = 1000');

  return db;
}

/** Returns current WAL mode and FK status for health checks. */
export function getDatabaseHealth(db: Database.Database): {
  journalMode: string;
  foreignKeys: number;
  walAutoCheckpoint: number;
} {
  const journalMode = db.pragma('journal_mode', { simple: true }) as string;
  const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  const walAutoCheckpoint = db.pragma('wal_autocheckpoint', {
    simple: true,
  }) as number;
  return { journalMode, foreignKeys, walAutoCheckpoint };
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
