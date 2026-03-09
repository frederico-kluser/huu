import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import {
  validatePromoteInput,
  computeDedupeHash,
  promoteToInstinct,
} from '../promote.js';
import type { PromoteInput } from '../promote.js';

let db: Database.Database;
let queue: MessageQueue;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  queue = new MessageQueue(db);
});

afterEach(() => {
  db?.close();
});

function makeInput(overrides: Partial<PromoteInput> = {}): PromoteInput {
  return {
    taskId: 'task-1',
    agentId: 'builder',
    projectId: 'proj-1',
    title: 'Always validate inputs',
    content: 'When processing user data, always validate and sanitize inputs before use.',
    tags: ['validation', 'security'],
    confidence: 0.6,
    ...overrides,
  };
}

describe('validatePromoteInput', () => {
  it('accepts valid input', () => {
    expect(validatePromoteInput(makeInput()).valid).toBe(true);
  });

  it('rejects empty title', () => {
    const result = validatePromoteInput(makeInput({ title: '' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('title');
  });

  it('rejects empty content', () => {
    const result = validatePromoteInput(makeInput({ content: '' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('content');
  });

  it('rejects confidence below 0.3', () => {
    const result = validatePromoteInput(makeInput({ confidence: 0.1 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('confidence');
  });

  it('rejects confidence above 0.85', () => {
    const result = validatePromoteInput(makeInput({ confidence: 0.9 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('confidence');
  });

  it('accepts boundary confidence values', () => {
    expect(validatePromoteInput(makeInput({ confidence: 0.3 })).valid).toBe(true);
    expect(validatePromoteInput(makeInput({ confidence: 0.85 })).valid).toBe(true);
  });
});

describe('computeDedupeHash', () => {
  it('produces consistent hash for same input', () => {
    const h1 = computeDedupeHash('title', 'content', 'task-1');
    const h2 = computeDedupeHash('title', 'content', 'task-1');
    expect(h1).toBe(h2);
  });

  it('produces different hash for different inputs', () => {
    const h1 = computeDedupeHash('title A', 'content', 'task-1');
    const h2 = computeDedupeHash('title B', 'content', 'task-1');
    expect(h1).not.toBe(h2);
  });

  it('normalizes case and whitespace', () => {
    const h1 = computeDedupeHash('Title', 'Content', 'task-1');
    const h2 = computeDedupeHash('  title  ', '  content  ', 'task-1');
    expect(h1).toBe(h2);
  });
});

describe('promoteToInstinct', () => {
  it('creates an instinct with full provenance', () => {
    const result = promoteToInstinct(db, queue, makeInput());

    expect(result.success).toBe(true);
    expect(result.instinctId).toBeGreaterThan(0);
    expect(result.duplicate).toBeUndefined();

    // Verify in database
    const instinct = db.prepare('SELECT * FROM instincts WHERE id = ?')
      .get(result.instinctId) as any;
    expect(instinct.title).toBe('Always validate inputs');
    expect(instinct.confidence).toBe(0.6);
    expect(instinct.state).toBe('candidate');

    const metadata = JSON.parse(instinct.metadata_json);
    expect(metadata.source_task_id).toBe('task-1');
    expect(metadata.source_agent_id).toBe('builder');
    expect(metadata.created_by).toBe('human');
    expect(metadata.tags).toEqual(['validation', 'security']);
    expect(metadata.dedupe_hash).toBeTruthy();
  });

  it('detects duplicate and returns existing instinct id', () => {
    const r1 = promoteToInstinct(db, queue, makeInput());
    expect(r1.success).toBe(true);

    const r2 = promoteToInstinct(db, queue, makeInput());
    expect(r2.success).toBe(false);
    expect(r2.duplicate).toBe(true);
    expect(r2.instinctId).toBe(r1.instinctId);
    expect(r2.error).toContain('duplicate');
  });

  it('allows different learnings from different tasks', () => {
    const r1 = promoteToInstinct(db, queue, makeInput({
      taskId: 'task-1',
      title: 'Learning from task 1',
    }));
    expect(r1.success).toBe(true);

    const r2 = promoteToInstinct(db, queue, makeInput({
      taskId: 'task-2',
      title: 'Learning from task 2',
    }));
    expect(r2.success).toBe(true);
    expect(r2.instinctId).not.toBe(r1.instinctId);
  });

  it('rejects invalid input', () => {
    const result = promoteToInstinct(db, queue, makeInput({ title: '' }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('title');
  });

  it('publishes promote_instinct message', () => {
    promoteToInstinct(db, queue, makeInput());

    const msg = queue.dequeue({ recipient: 'orchestrator' });
    expect(msg).toBeDefined();
    expect(msg!.message_type).toBe('promote_instinct');

    const payload = JSON.parse(msg!.payload_json);
    expect(payload.kind).toBe('promote');
    expect(payload.state).toBe('applied');
    expect(payload.instinctId).toBeGreaterThan(0);
  });
});
