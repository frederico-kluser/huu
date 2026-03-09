import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import { OrchestratorMonitor, classifyMessages, parsePayload } from '../monitor.js';
import type { Message } from '../../types/index.js';

describe('OrchestratorMonitor', () => {
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

  function enqueue(type: string, payload: unknown = {}, runId = 'run-1') {
    queue.enqueue({
      project_id: 'proj-1',
      message_type: type as any,
      sender_agent: 'builder',
      recipient_agent: 'orchestrator',
      run_id: runId,
      payload,
    });
  }

  describe('poll', () => {
    it('should return empty result when no messages exist', () => {
      const monitor = new OrchestratorMonitor(db);
      const result = monitor.poll();
      expect(result.messages).toHaveLength(0);
      expect(result.newWatermark).toBe(0);
    });

    it('should return new messages and advance watermark', () => {
      enqueue('task_progress', { turn: 1 });
      enqueue('task_progress', { turn: 2 });

      const monitor = new OrchestratorMonitor(db);
      const result = monitor.poll();
      expect(result.messages).toHaveLength(2);
      expect(result.newWatermark).toBe(result.messages[1]!.id);
    });

    it('should not return same messages twice (watermark)', () => {
      enqueue('task_progress', { turn: 1 });

      const monitor = new OrchestratorMonitor(db);
      const r1 = monitor.poll();
      expect(r1.messages).toHaveLength(1);

      const r2 = monitor.poll();
      expect(r2.messages).toHaveLength(0);
    });

    it('should return only new messages after watermark', () => {
      enqueue('task_progress', { turn: 1 });

      const monitor = new OrchestratorMonitor(db);
      monitor.poll(); // consumes first message

      enqueue('task_done', { state: 'completed' });

      const r2 = monitor.poll();
      expect(r2.messages).toHaveLength(1);
      expect(r2.messages[0]!.message_type).toBe('task_done');
    });

    it('should respect batch size', () => {
      for (let i = 0; i < 10; i++) {
        enqueue('task_progress', { turn: i });
      }

      const monitor = new OrchestratorMonitor(db, { batchSize: 3 });
      const r1 = monitor.poll();
      expect(r1.messages).toHaveLength(3);

      const r2 = monitor.poll();
      expect(r2.messages).toHaveLength(3);
    });

    it('should filter by message types when specified', () => {
      enqueue('task_progress', { turn: 1 });
      enqueue('task_done', { state: 'completed' });
      enqueue('broadcast', { msg: 'hello' });

      const monitor = new OrchestratorMonitor(db, {
        messageTypes: ['task_done'],
      });
      const result = monitor.poll();
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.message_type).toBe('task_done');
    });
  });

  describe('watermark management', () => {
    it('should allow getting watermark', () => {
      const monitor = new OrchestratorMonitor(db);
      expect(monitor.getWatermark()).toBe(0);
    });

    it('should allow setting watermark (crash recovery)', () => {
      enqueue('task_progress', { turn: 1 });
      enqueue('task_progress', { turn: 2 });
      enqueue('task_done', { state: 'completed' });

      const monitor = new OrchestratorMonitor(db);

      // Simulate crash recovery: set watermark to after first two messages
      const r1 = monitor.poll();
      const midWatermark = r1.messages[1]!.id;

      const monitor2 = new OrchestratorMonitor(db);
      monitor2.setWatermark(midWatermark);

      const r2 = monitor2.poll();
      expect(r2.messages).toHaveLength(1);
      expect(r2.messages[0]!.message_type).toBe('task_done');
    });

    it('should reject negative watermark', () => {
      const monitor = new OrchestratorMonitor(db);
      expect(() => monitor.setWatermark(-1)).toThrow('non-negative');
    });
  });

  describe('hasPending', () => {
    it('should return false when no messages', () => {
      const monitor = new OrchestratorMonitor(db);
      expect(monitor.hasPending()).toBe(false);
    });

    it('should return true when messages exist', () => {
      enqueue('task_progress', { turn: 1 });
      const monitor = new OrchestratorMonitor(db);
      expect(monitor.hasPending()).toBe(true);
    });

    it('should return false after all consumed', () => {
      enqueue('task_progress', { turn: 1 });
      const monitor = new OrchestratorMonitor(db);
      monitor.poll();
      expect(monitor.hasPending()).toBe(false);
    });
  });

  describe('pollAndClassify', () => {
    it('should classify messages by type', () => {
      enqueue('task_progress', { turn: 1 });
      enqueue('task_done', { state: 'completed' });
      enqueue('merge_result', { outcome: 'merged' });
      enqueue('escalation', { error: 'oops' });
      enqueue('health_check', { seq: 1 });
      enqueue('broadcast', { msg: 'hi' });

      const monitor = new OrchestratorMonitor(db);
      const classified = monitor.pollAndClassify();

      expect(classified.taskProgress).toHaveLength(1);
      expect(classified.taskDone).toHaveLength(1);
      expect(classified.mergeResult).toHaveLength(1);
      expect(classified.escalation).toHaveLength(1);
      expect(classified.healthCheck).toHaveLength(1);
      expect(classified.other).toHaveLength(1);
      expect(classified.all).toHaveLength(6);
    });
  });
});

describe('classifyMessages', () => {
  it('should handle empty array', () => {
    const result = classifyMessages([]);
    expect(result.all).toHaveLength(0);
    expect(result.taskProgress).toHaveLength(0);
  });
});

describe('parsePayload', () => {
  it('should parse valid JSON payload', () => {
    const msg = { payload_json: '{"key":"value"}' } as Message;
    expect(parsePayload(msg)).toEqual({ key: 'value' });
  });

  it('should return empty object for invalid JSON', () => {
    const msg = { payload_json: 'not-json' } as Message;
    expect(parsePayload(msg)).toEqual({});
  });
});
