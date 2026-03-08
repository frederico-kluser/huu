import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase, getDatabaseHealth, walCheckpoint } from '../connection.js';

let db: Database.Database;

afterEach(() => {
  db?.close();
});

describe('openDatabase', () => {
  it('should create an in-memory database with WAL pragmas', () => {
    db = openDatabase(':memory:');
    const health = getDatabaseHealth(db);

    // In-memory databases use 'memory' journal mode instead of WAL
    // WAL requires an actual file on disk
    expect(health.foreignKeys).toBe(1);
    expect(health.walAutoCheckpoint).toBe(1000);
  });

  it('should set foreign_keys ON', () => {
    db = openDatabase(':memory:');
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });
});

describe('getDatabaseHealth', () => {
  it('should return health info', () => {
    db = openDatabase(':memory:');
    const health = getDatabaseHealth(db);
    expect(health).toHaveProperty('journalMode');
    expect(health).toHaveProperty('foreignKeys');
    expect(health).toHaveProperty('walAutoCheckpoint');
  });
});

describe('walCheckpoint', () => {
  it('should execute without error on in-memory db', () => {
    db = openDatabase(':memory:');
    const result = walCheckpoint(db, 'PASSIVE');
    expect(result).toHaveProperty('busy');
    expect(result).toHaveProperty('log');
    expect(result).toHaveProperty('checkpointed');
  });
});
