import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../connection.js';
import { migrate } from '../migrator.js';
import { SessionRepository } from '../repositories/sessions.js';
import { EntityRepository } from '../repositories/entities.js';
import { RelationRepository } from '../repositories/relations.js';
import { ObservationRepository } from '../repositories/observations.js';
import { InstinctRepository } from '../repositories/instincts.js';
import { BeatStateRepository } from '../repositories/beat-state.js';
import { AuditLogRepository } from '../repositories/audit-log.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
});

afterEach(() => {
  db?.close();
});

// ── Sessions ───────────────────────────────────────────────────────────

describe('SessionRepository', () => {
  it('should create a running session', () => {
    const repo = new SessionRepository(db);
    const session = repo.create({ id: 's1', project_id: 'p1' });

    expect(session.id).toBe('s1');
    expect(session.status).toBe('running');
    expect(session.total_messages).toBe(0);
  });

  it('should end a session with status and summary', () => {
    const repo = new SessionRepository(db);
    repo.create({ id: 's1', project_id: 'p1' });

    const ended = repo.end({
      id: 's1',
      status: 'completed',
      summary_markdown: '# Done',
      summary_json: '{"tasks": 5}',
    });
    expect(ended).toBe(true);

    const session = repo.getById('s1')!;
    expect(session.status).toBe('completed');
    expect(session.ended_at).toBeTruthy();
    expect(session.summary_markdown).toBe('# Done');
  });

  it('should not end an already-ended session', () => {
    const repo = new SessionRepository(db);
    repo.create({ id: 's1', project_id: 'p1' });
    repo.end({ id: 's1', status: 'completed' });

    const result = repo.end({ id: 's1', status: 'failed' });
    expect(result).toBe(false);
  });

  it('should increment counters atomically', () => {
    const repo = new SessionRepository(db);
    repo.create({ id: 's1', project_id: 'p1' });
    repo.incrementCounters('s1', {
      messages: 3,
      tool_calls: 2,
      cost_usd: 0.05,
    });

    const session = repo.getById('s1')!;
    expect(session.total_messages).toBe(3);
    expect(session.total_tool_calls).toBe(2);
    expect(session.total_cost_usd).toBeCloseTo(0.05);
  });

  it('should retrieve recent sessions within 7-day window', () => {
    const repo = new SessionRepository(db);
    repo.create({ id: 's1', project_id: 'p1' });
    repo.end({ id: 's1', status: 'completed' });

    const recent = repo.getRecent('p1');
    expect(recent).toHaveLength(1);
  });
});

// ── Entities ───────────────────────────────────────────────────────────

describe('EntityRepository', () => {
  it('should insert a new entity', () => {
    const repo = new EntityRepository(db);
    const entity = repo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'src/main.ts',
      display_name: 'main.ts',
      summary: 'Entry point',
    });

    expect(entity.id).toBeDefined();
    expect(entity.entity_type).toBe('file');
    expect(entity.canonical_key).toBe('src/main.ts');
    expect(entity.confidence).toBe(0.7);
  });

  it('should upsert (update last_seen_at) on duplicate canonical_key', () => {
    const repo = new EntityRepository(db);
    const first = repo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'src/main.ts',
      display_name: 'main.ts',
    });

    const second = repo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'src/main.ts',
      display_name: 'main.ts (updated)',
      summary: 'Updated summary',
    });

    expect(second.id).toBe(first.id);
    expect(second.display_name).toBe('main.ts (updated)');
    expect(second.summary).toBe('Updated summary');
  });

  it('should get by canonical key', () => {
    const repo = new EntityRepository(db);
    repo.upsert({
      project_id: 'p1',
      entity_type: 'decision',
      canonical_key: 'use-wal-mode',
      display_name: 'Use WAL mode',
    });

    const found = repo.getByCanonicalKey('p1', 'use-wal-mode');
    expect(found).toBeDefined();
    expect(found!.display_name).toBe('Use WAL mode');
  });

  it('should list by type ordered by last_seen_at', () => {
    const repo = new EntityRepository(db);
    repo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'a.ts',
      display_name: 'a',
    });
    repo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'b.ts',
      display_name: 'b',
    });
    repo.upsert({
      project_id: 'p1',
      entity_type: 'decision',
      canonical_key: 'd1',
      display_name: 'decision 1',
    });

    const files = repo.listByType('p1', 'file');
    expect(files).toHaveLength(2);

    const decisions = repo.listByType('p1', 'decision');
    expect(decisions).toHaveLength(1);
  });

  it('should delete an entity', () => {
    const repo = new EntityRepository(db);
    const entity = repo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'x.ts',
      display_name: 'x',
    });

    expect(repo.delete(entity.id)).toBe(true);
    expect(repo.getById(entity.id)).toBeUndefined();
  });
});

// ── Relations ──────────────────────────────────────────────────────────

describe('RelationRepository', () => {
  function createTwoEntities() {
    const entityRepo = new EntityRepository(db);
    const e1 = entityRepo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'a.ts',
      display_name: 'a',
    });
    const e2 = entityRepo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'b.ts',
      display_name: 'b',
    });
    return { e1, e2 };
  }

  it('should create a relation between entities', () => {
    const { e1, e2 } = createTwoEntities();
    const repo = new RelationRepository(db);

    const rel = repo.upsert({
      project_id: 'p1',
      from_entity_id: e1.id,
      to_entity_id: e2.id,
      relation_type: 'depends_on',
    });

    expect(rel.id).toBeDefined();
    expect(rel.relation_type).toBe('depends_on');
    expect(rel.confidence).toBe(0.7);
  });

  it('should upsert (update last_seen_at) on duplicate edge', () => {
    const { e1, e2 } = createTwoEntities();
    const repo = new RelationRepository(db);

    const first = repo.upsert({
      project_id: 'p1',
      from_entity_id: e1.id,
      to_entity_id: e2.id,
      relation_type: 'depends_on',
      confidence: 0.5,
    });
    const second = repo.upsert({
      project_id: 'p1',
      from_entity_id: e1.id,
      to_entity_id: e2.id,
      relation_type: 'depends_on',
      confidence: 0.9,
    });

    expect(second.id).toBe(first.id);
    expect(second.confidence).toBe(0.9);
  });

  it('should reject self-referencing relation', () => {
    const entityRepo = new EntityRepository(db);
    const e = entityRepo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'c.ts',
      display_name: 'c',
    });
    const repo = new RelationRepository(db);

    expect(() =>
      repo.upsert({
        project_id: 'p1',
        from_entity_id: e.id,
        to_entity_id: e.id,
        relation_type: 'depends_on',
      }),
    ).toThrow();
  });

  it('should traverse by from_entity and to_entity', () => {
    const { e1, e2 } = createTwoEntities();
    const repo = new RelationRepository(db);

    repo.upsert({
      project_id: 'p1',
      from_entity_id: e1.id,
      to_entity_id: e2.id,
      relation_type: 'depends_on',
    });

    const outgoing = repo.getFromEntity('p1', e1.id);
    expect(outgoing).toHaveLength(1);

    const incoming = repo.getToEntity('p1', e2.id);
    expect(incoming).toHaveLength(1);

    // Filter by relation_type
    const filtered = repo.getFromEntity('p1', e1.id, 'depends_on');
    expect(filtered).toHaveLength(1);

    const noMatch = repo.getFromEntity('p1', e1.id, 'implements');
    expect(noMatch).toHaveLength(0);
  });

  it('should delete a relation', () => {
    const { e1, e2 } = createTwoEntities();
    const repo = new RelationRepository(db);

    const rel = repo.upsert({
      project_id: 'p1',
      from_entity_id: e1.id,
      to_entity_id: e2.id,
      relation_type: 'references',
    });

    expect(repo.delete(rel.id)).toBe(true);
    expect(repo.getFromEntity('p1', e1.id)).toHaveLength(0);
  });
});

// ── Observations ───────────────────────────────────────────────────────

describe('ObservationRepository', () => {
  function createSession() {
    const sessionRepo = new SessionRepository(db);
    return sessionRepo.create({ id: 'sess-1', project_id: 'p1' });
  }

  it('should create an observation', () => {
    createSession();
    const repo = new ObservationRepository(db);
    const obs = repo.create({
      project_id: 'p1',
      session_id: 'sess-1',
      agent_id: 'builder',
      tool_name: 'write',
      tool_phase: 'post',
      success: true,
      latency_ms: 120,
    });

    expect(obs.id).toBeDefined();
    expect(obs.success).toBe(1);
    expect(obs.latency_ms).toBe(120);
    expect(obs.expires_at).toBeTruthy();
  });

  it('should list by agent and tool', () => {
    createSession();
    const repo = new ObservationRepository(db);
    repo.create({
      project_id: 'p1',
      session_id: 'sess-1',
      agent_id: 'builder',
      tool_name: 'write',
      tool_phase: 'post',
      success: true,
    });
    repo.create({
      project_id: 'p1',
      session_id: 'sess-1',
      agent_id: 'builder',
      tool_name: 'read',
      tool_phase: 'post',
      success: true,
    });

    const writeObs = repo.listByAgentTool('p1', 'builder', 'write');
    expect(writeObs).toHaveLength(1);
  });

  it('should clean up expired observations', () => {
    createSession();
    const repo = new ObservationRepository(db);

    // Insert with already-expired date
    db.prepare(
      `INSERT INTO observations (
         project_id, session_id, agent_id, tool_name, tool_phase, success, expires_at
       ) VALUES ('p1', 'sess-1', 'builder', 'write', 'post', 1, '2000-01-01T00:00:00.000Z')`,
    ).run();

    const removed = repo.cleanupExpired();
    expect(removed).toBe(1);
  });
});

// ── Instincts ──────────────────────────────────────────────────────────

describe('InstinctRepository', () => {
  it('should create an instinct within valid confidence range', () => {
    const repo = new InstinctRepository(db);
    const instinct = repo.create({
      project_id: 'p1',
      title: 'Prefer small commits',
      instinct_text: 'Smaller commits are easier to review',
      confidence: 0.5,
    });

    expect(instinct.id).toBeDefined();
    expect(instinct.state).toBe('candidate');
    expect(instinct.confidence).toBe(0.5);
    expect(instinct.evidence_count).toBe(0);
  });

  it('should reject confidence below 0.30', () => {
    const repo = new InstinctRepository(db);
    expect(() =>
      repo.create({
        project_id: 'p1',
        title: 'Low confidence',
        instinct_text: 'Too uncertain',
        confidence: 0.1,
      }),
    ).toThrow();
  });

  it('should reject confidence above 0.85', () => {
    const repo = new InstinctRepository(db);
    expect(() =>
      repo.create({
        project_id: 'p1',
        title: 'High confidence',
        instinct_text: 'Too certain for instinct',
        confidence: 0.9,
      }),
    ).toThrow();
  });

  it('should update confidence and state', () => {
    const repo = new InstinctRepository(db);
    const instinct = repo.create({
      project_id: 'p1',
      title: 'Test pattern',
      instinct_text: 'Some pattern',
      confidence: 0.5,
    });

    repo.update({
      id: instinct.id,
      confidence: 0.75,
      state: 'active',
      evidence_count: 5,
    });

    const updated = repo.getById(instinct.id)!;
    expect(updated.confidence).toBe(0.75);
    expect(updated.state).toBe('active');
    expect(updated.evidence_count).toBe(5);
    expect(updated.last_validated_at).toBeTruthy();
  });

  it('should list active instincts ordered by confidence', () => {
    const repo = new InstinctRepository(db);
    repo.create({
      project_id: 'p1',
      title: 'Pattern A',
      instinct_text: 'A',
      confidence: 0.5,
      state: 'active',
    });
    repo.create({
      project_id: 'p1',
      title: 'Pattern B',
      instinct_text: 'B',
      confidence: 0.8,
      state: 'active',
    });
    repo.create({
      project_id: 'p1',
      title: 'Pattern C',
      instinct_text: 'C',
      confidence: 0.6,
      state: 'candidate',
    });

    const active = repo.listActive('p1');
    expect(active).toHaveLength(2);
    expect(active[0]!.confidence).toBe(0.8);
    expect(active[1]!.confidence).toBe(0.5);
  });

  it('should enforce UNIQUE(project_id, title)', () => {
    const repo = new InstinctRepository(db);
    repo.create({
      project_id: 'p1',
      title: 'Same title',
      instinct_text: 'First',
      confidence: 0.5,
    });

    expect(() =>
      repo.create({
        project_id: 'p1',
        title: 'Same title',
        instinct_text: 'Duplicate',
        confidence: 0.6,
      }),
    ).toThrow();
  });
});

// ── Beat State ─────────────────────────────────────────────────────────

describe('BeatStateRepository', () => {
  it('should upsert beat state', () => {
    const repo = new BeatStateRepository(db);
    const state = repo.upsert({
      project_id: 'p1',
      run_id: 'run-1',
      current_act: 1,
      current_sequence: 'setup',
      current_beat: 'scaffolding',
      progress_pct: 10,
      status: 'running',
    });

    expect(state.project_id).toBe('p1');
    expect(state.current_act).toBe(1);
    expect(state.progress_pct).toBe(10);
    expect(state.status).toBe('running');
  });

  it('should update on upsert (same project_id)', () => {
    const repo = new BeatStateRepository(db);
    repo.upsert({
      project_id: 'p1',
      run_id: 'run-1',
      current_act: 1,
      progress_pct: 10,
      status: 'running',
    });
    const updated = repo.upsert({
      project_id: 'p1',
      run_id: 'run-1',
      current_act: 2,
      progress_pct: 50,
      status: 'running',
    });

    expect(updated.current_act).toBe(2);
    expect(updated.progress_pct).toBe(50);
  });

  it('should get by project_id (O(1) via PK)', () => {
    const repo = new BeatStateRepository(db);
    repo.upsert({
      project_id: 'p1',
      run_id: 'run-1',
      current_act: 1,
      progress_pct: 0,
      status: 'running',
    });

    const state = repo.get('p1');
    expect(state).toBeDefined();
    expect(state!.project_id).toBe('p1');
  });

  it('should block and unblock', () => {
    const repo = new BeatStateRepository(db);
    repo.upsert({
      project_id: 'p1',
      run_id: 'run-1',
      current_act: 1,
      progress_pct: 30,
      status: 'running',
    });

    repo.block('p1', 'merge conflict');
    let state = repo.get('p1')!;
    expect(state.status).toBe('blocked');
    expect(state.blocked_reason).toBe('merge conflict');

    repo.unblock('p1');
    state = repo.get('p1')!;
    expect(state.status).toBe('running');
    expect(state.blocked_reason).toBeNull();
  });

  it('should reject act outside 1-3', () => {
    const repo = new BeatStateRepository(db);
    expect(() =>
      repo.upsert({
        project_id: 'p1',
        run_id: 'run-1',
        current_act: 0,
        progress_pct: 0,
        status: 'running',
      }),
    ).toThrow();

    expect(() =>
      repo.upsert({
        project_id: 'p1',
        run_id: 'run-1',
        current_act: 4,
        progress_pct: 0,
        status: 'running',
      }),
    ).toThrow();
  });

  it('should reject progress_pct outside 0-100', () => {
    const repo = new BeatStateRepository(db);
    expect(() =>
      repo.upsert({
        project_id: 'p1',
        run_id: 'run-1',
        current_act: 1,
        progress_pct: -1,
        status: 'running',
      }),
    ).toThrow();

    expect(() =>
      repo.upsert({
        project_id: 'p1',
        run_id: 'run-1',
        current_act: 1,
        progress_pct: 101,
        status: 'running',
      }),
    ).toThrow();
  });
});

// ── Audit Log ──────────────────────────────────────────────────────────

describe('AuditLogRepository', () => {
  function createSession() {
    const sessionRepo = new SessionRepository(db);
    return sessionRepo.create({ id: 'audit-sess', project_id: 'p1' });
  }

  it('should append an audit entry', () => {
    createSession();
    const repo = new AuditLogRepository(db);
    const entry = repo.append({
      project_id: 'p1',
      session_id: 'audit-sess',
      agent_id: 'builder',
      tool_name: 'write',
      params_json: '{"file": "a.ts"}',
      result_json: '{"ok": true}',
      result_status: 'success',
      duration_ms: 45,
    });

    expect(entry.id).toBeDefined();
    expect(entry.result_status).toBe('success');
    expect(entry.duration_ms).toBe(45);
  });

  it('should prevent update on audit_log', () => {
    createSession();
    const repo = new AuditLogRepository(db);
    repo.append({
      project_id: 'p1',
      session_id: 'audit-sess',
      agent_id: 'builder',
      tool_name: 'write',
      params_json: '{}',
      result_json: '{}',
      result_status: 'success',
    });

    expect(() => {
      db.prepare(
        "UPDATE audit_log SET agent_id = 'tampered' WHERE id = 1",
      ).run();
    }).toThrow('audit_log is append-only');
  });

  it('should prevent delete on audit_log', () => {
    createSession();
    const repo = new AuditLogRepository(db);
    repo.append({
      project_id: 'p1',
      session_id: 'audit-sess',
      agent_id: 'builder',
      tool_name: 'write',
      params_json: '{}',
      result_json: '{}',
      result_status: 'success',
    });

    expect(() => {
      db.prepare('DELETE FROM audit_log WHERE id = 1').run();
    }).toThrow('audit_log is append-only');
  });

  it('should list recent entries', () => {
    createSession();
    const repo = new AuditLogRepository(db);

    for (let i = 0; i < 5; i++) {
      repo.append({
        project_id: 'p1',
        session_id: 'audit-sess',
        agent_id: 'builder',
        tool_name: `tool_${i}`,
        params_json: '{}',
        result_json: '{}',
        result_status: 'success',
      });
    }

    const recent = repo.listRecent('p1', 3);
    expect(recent).toHaveLength(3);
  });

  it('should list by agent and tool', () => {
    createSession();
    const repo = new AuditLogRepository(db);

    repo.append({
      project_id: 'p1',
      session_id: 'audit-sess',
      agent_id: 'builder',
      tool_name: 'write',
      params_json: '{}',
      result_json: '{}',
      result_status: 'success',
    });
    repo.append({
      project_id: 'p1',
      session_id: 'audit-sess',
      agent_id: 'builder',
      tool_name: 'read',
      params_json: '{}',
      result_json: '{}',
      result_status: 'success',
    });

    const entries = repo.listByAgentTool('p1', 'builder', 'write');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.tool_name).toBe('write');
  });

  it('should reject invalid params_json', () => {
    createSession();
    const repo = new AuditLogRepository(db);

    expect(() =>
      repo.append({
        project_id: 'p1',
        session_id: 'audit-sess',
        agent_id: 'builder',
        tool_name: 'write',
        params_json: 'not-json',
        result_json: '{}',
        result_status: 'success',
      }),
    ).toThrow();
  });
});
