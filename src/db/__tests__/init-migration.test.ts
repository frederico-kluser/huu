import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../connection.js';
import { migrate } from '../migrator.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db); // Apply 0001_init.sql from src/db/migrations/
});

afterEach(() => {
  db?.close();
});

describe('0001_init migration', () => {
  it('should create all expected tables', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('messages');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('entities');
    expect(tableNames).toContain('relations');
    expect(tableNames).toContain('observations');
    expect(tableNames).toContain('instincts');
    expect(tableNames).toContain('beat_state');
    expect(tableNames).toContain('audit_log');
    expect(tableNames).toContain('schema_migrations');
  });

  it('should create expected indexes', () => {
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_messages_dequeue');
    expect(names).toContain('idx_messages_timeout');
    expect(names).toContain('idx_messages_correlation');
    expect(names).toContain('idx_sessions_recent');
    expect(names).toContain('idx_entities_type');
    expect(names).toContain('idx_relations_from');
    expect(names).toContain('idx_relations_to');
    expect(names).toContain('idx_observations_recent');
    expect(names).toContain('idx_observations_expiry');
    expect(names).toContain('idx_observations_agent_tool');
    expect(names).toContain('idx_instincts_state_conf');
    expect(names).toContain('idx_audit_time');
    expect(names).toContain('idx_audit_agent_tool');
  });

  it('should create audit_log triggers', () => {
    const triggers = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    const names = triggers.map((t) => t.name);
    expect(names).toContain('audit_log_no_update');
    expect(names).toContain('audit_log_no_delete');
  });

  it('should enforce message_type CHECK constraint', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO messages (project_id, message_type, sender_agent, recipient_agent, payload_json)
         VALUES ('p1', 'invalid_type', 'sender', 'recipient', '{}')`,
      ).run();
    }).toThrow();
  });

  it('should enforce message status CHECK constraint', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO messages (project_id, message_type, sender_agent, recipient_agent, payload_json, status)
         VALUES ('p1', 'task_assigned', 'sender', 'recipient', '{}', 'invalid_status')`,
      ).run();
    }).toThrow();
  });

  it('should enforce payload_json validity', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO messages (project_id, message_type, sender_agent, recipient_agent, payload_json)
         VALUES ('p1', 'task_assigned', 'sender', 'recipient', 'not-json')`,
      ).run();
    }).toThrow();
  });

  it('should enforce entity UNIQUE(project_id, canonical_key)', () => {
    db.prepare(
      `INSERT INTO entities (project_id, entity_type, canonical_key, display_name)
       VALUES ('p1', 'file', 'src/main.ts', 'main.ts')`,
    ).run();

    expect(() => {
      db.prepare(
        `INSERT INTO entities (project_id, entity_type, canonical_key, display_name)
         VALUES ('p1', 'file', 'src/main.ts', 'main.ts duplicate')`,
      ).run();
    }).toThrow();
  });

  it('should enforce relation self-reference CHECK', () => {
    const entity = db
      .prepare(
        `INSERT INTO entities (project_id, entity_type, canonical_key, display_name)
         VALUES ('p1', 'file', 'src/a.ts', 'a.ts') RETURNING id`,
      )
      .get() as { id: number };

    expect(() => {
      db.prepare(
        `INSERT INTO relations (project_id, from_entity_id, to_entity_id, relation_type)
         VALUES ('p1', ?, ?, 'depends_on')`,
      ).run(entity.id, entity.id);
    }).toThrow();
  });

  it('should enforce instinct confidence range (0.30-0.85)', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO instincts (project_id, title, instinct_text, confidence, state)
         VALUES ('p1', 'test', 'text', 0.1, 'candidate')`,
      ).run();
    }).toThrow();

    expect(() => {
      db.prepare(
        `INSERT INTO instincts (project_id, title, instinct_text, confidence, state)
         VALUES ('p1', 'test', 'text', 0.9, 'candidate')`,
      ).run();
    }).toThrow();
  });

  it('should enforce beat_state current_act range (1-3)', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO beat_state (project_id, run_id, current_act, progress_pct, status)
         VALUES ('p1', 'run1', 0, 0, 'running')`,
      ).run();
    }).toThrow();

    expect(() => {
      db.prepare(
        `INSERT INTO beat_state (project_id, run_id, current_act, progress_pct, status)
         VALUES ('p1', 'run1', 4, 0, 'running')`,
      ).run();
    }).toThrow();
  });

  it('should enforce session status CHECK constraint', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO sessions (id, project_id, status)
         VALUES ('s1', 'p1', 'invalid_status')`,
      ).run();
    }).toThrow();
  });

  it('should cascade delete relations when entity is deleted', () => {
    const e1 = db
      .prepare(
        `INSERT INTO entities (project_id, entity_type, canonical_key, display_name)
         VALUES ('p1', 'file', 'a.ts', 'a') RETURNING id`,
      )
      .get() as { id: number };
    const e2 = db
      .prepare(
        `INSERT INTO entities (project_id, entity_type, canonical_key, display_name)
         VALUES ('p1', 'file', 'b.ts', 'b') RETURNING id`,
      )
      .get() as { id: number };

    db.prepare(
      `INSERT INTO relations (project_id, from_entity_id, to_entity_id, relation_type)
       VALUES ('p1', ?, ?, 'depends_on')`,
    ).run(e1.id, e2.id);

    db.prepare('DELETE FROM entities WHERE id = ?').run(e1.id);

    const relations = db
      .prepare('SELECT * FROM relations WHERE from_entity_id = ?')
      .all(e1.id);
    expect(relations).toHaveLength(0);
  });

  it('should prevent UPDATE on audit_log', () => {
    db.prepare(
      `INSERT INTO sessions (id, project_id, status) VALUES ('s1', 'p1', 'running')`,
    ).run();

    db.prepare(
      `INSERT INTO audit_log (project_id, session_id, agent_id, tool_name, params_json, result_json, result_status)
       VALUES ('p1', 's1', 'builder', 'write', '{}', '{}', 'success')`,
    ).run();

    expect(() => {
      db.prepare(
        `UPDATE audit_log SET agent_id = 'hacked' WHERE id = 1`,
      ).run();
    }).toThrow('audit_log is append-only');
  });

  it('should prevent DELETE on audit_log', () => {
    db.prepare(
      `INSERT INTO sessions (id, project_id, status) VALUES ('s1', 'p1', 'running')`,
    ).run();

    db.prepare(
      `INSERT INTO audit_log (project_id, session_id, agent_id, tool_name, params_json, result_json, result_status)
       VALUES ('p1', 's1', 'builder', 'write', '{}', '{}', 'success')`,
    ).run();

    expect(() => {
      db.prepare('DELETE FROM audit_log WHERE id = 1').run();
    }).toThrow('audit_log is append-only');
  });
});
