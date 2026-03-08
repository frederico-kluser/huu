import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../connection.js';
import { migrate } from '../migrator.js';
import { MessageQueue } from '../queue.js';

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

describe('MessageQueue', () => {
  describe('enqueue', () => {
    it('should enqueue a message and return it', () => {
      const msg = queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orchestrator',
        recipient_agent: 'builder',
        payload: { task: 'implement feature' },
      });

      expect(msg.id).toBeDefined();
      expect(msg.status).toBe('pending');
      expect(msg.message_type).toBe('task_assigned');
      expect(msg.attempt_count).toBe(0);
      expect(JSON.parse(msg.payload_json)).toEqual({
        task: 'implement feature',
      });
    });

    it('should support all message types', () => {
      const types = [
        'task_assigned', 'task_progress', 'task_done',
        'merge_ready', 'merge_result', 'escalation',
        'health_check', 'broadcast',
        'steer', 'follow_up', 'abort_requested', 'abort_ack', 'promote_instinct',
      ] as const;

      for (const type of types) {
        const msg = queue.enqueue({
          project_id: 'p1',
          message_type: type,
          sender_agent: 'sender',
          recipient_agent: 'recipient',
          payload: {},
        });
        expect(msg.message_type).toBe(type);
      }
    });

    it('should respect priority ordering', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: { order: 'low-priority' },
        priority: 200,
      });
      queue.enqueue({
        project_id: 'p1',
        message_type: 'escalation',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: { order: 'high-priority' },
        priority: 1,
      });

      const msg = queue.dequeue({ recipient: 'builder' });
      expect(msg).toBeDefined();
      expect(JSON.parse(msg!.payload_json).order).toBe('high-priority');
    });

    it('should support correlation_id and causation_id', () => {
      const first = queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
        correlation_id: 'corr-123',
      });

      const second = queue.enqueue({
        project_id: 'p1',
        message_type: 'task_progress',
        sender_agent: 'builder',
        recipient_agent: 'orch',
        payload: {},
        correlation_id: 'corr-123',
        causation_id: first.id,
      });

      expect(second.correlation_id).toBe('corr-123');
      expect(second.causation_id).toBe(first.id);
    });
  });

  describe('dequeue', () => {
    it('should dequeue the next pending message', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: { n: 1 },
      });

      const msg = queue.dequeue({ recipient: 'builder' });
      expect(msg).toBeDefined();
      expect(msg!.status).toBe('processing');
      expect(msg!.attempt_count).toBe(1);
      expect(msg!.locked_at).toBeTruthy();
      expect(msg!.lock_expires_at).toBeTruthy();
    });

    it('should return undefined when no messages available', () => {
      const msg = queue.dequeue({ recipient: 'builder' });
      expect(msg).toBeUndefined();
    });

    it('should not deliver same message to two consumers', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
      });

      const msg1 = queue.dequeue({ recipient: 'builder' });
      const msg2 = queue.dequeue({ recipient: 'builder' });

      expect(msg1).toBeDefined();
      expect(msg2).toBeUndefined();
    });

    it('should only dequeue messages for the specified recipient', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: { for: 'builder' },
      });
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'tester',
        payload: { for: 'tester' },
      });

      const msg = queue.dequeue({ recipient: 'tester' });
      expect(msg).toBeDefined();
      expect(JSON.parse(msg!.payload_json).for).toBe('tester');
    });

    it('should not dequeue messages with future available_at', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'follow_up',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
        available_at: '2099-01-01T00:00:00.000Z',
      });

      const msg = queue.dequeue({ recipient: 'builder' });
      expect(msg).toBeUndefined();
    });
  });

  describe('ack', () => {
    it('should acknowledge a processing message', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
      });

      const msg = queue.dequeue({ recipient: 'builder' })!;
      const acked = queue.ack(msg.id);
      expect(acked).toBe(true);

      const updated = queue.getById(msg.id)!;
      expect(updated.status).toBe('acked');
      expect(updated.acked_at).toBeTruthy();
    });

    it('should not ack a non-processing message', () => {
      const msg = queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
      });

      // Message is still 'pending', not 'processing'
      const acked = queue.ack(msg.id);
      expect(acked).toBe(false);
    });
  });

  describe('nack (retry / DLQ)', () => {
    it('should return message to pending on nack when retries remain', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
        max_attempts: 3,
      });

      const msg = queue.dequeue({ recipient: 'builder' })!;
      queue.nack(msg.id, 'temporary error');

      const updated = queue.getById(msg.id)!;
      expect(updated.status).toBe('pending');
      expect(updated.error_text).toBe('temporary error');
      expect(updated.locked_at).toBeNull();
    });

    it('should move to dead_letter when max_attempts exceeded', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
        max_attempts: 1,
      });

      // First attempt
      const msg = queue.dequeue({ recipient: 'builder' })!;
      expect(msg.attempt_count).toBe(1);

      // Nack — max_attempts=1, attempt_count=1 -> DLQ
      queue.nack(msg.id, 'fatal error');

      const updated = queue.getById(msg.id)!;
      expect(updated.status).toBe('dead_letter');
      expect(updated.error_text).toBe('fatal error');
    });

    it('should allow retry then DLQ after multiple nacks', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
        max_attempts: 2,
      });

      // Attempt 1
      const msg1 = queue.dequeue({ recipient: 'builder' })!;
      queue.nack(msg1.id, 'error 1');
      let state = queue.getById(msg1.id)!;
      expect(state.status).toBe('pending');

      // Attempt 2
      const msg2 = queue.dequeue({ recipient: 'builder' })!;
      expect(msg2.attempt_count).toBe(2);
      queue.nack(msg2.id, 'error 2');

      state = queue.getById(msg1.id)!;
      expect(state.status).toBe('dead_letter');
    });
  });

  describe('countByStatus', () => {
    it('should return counts grouped by status', () => {
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_assigned',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
      });
      queue.enqueue({
        project_id: 'p1',
        message_type: 'task_progress',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: {},
      });

      queue.dequeue({ recipient: 'builder' });

      const counts = queue.countByStatus('builder');
      expect(counts['pending']).toBe(1);
      expect(counts['processing']).toBe(1);
    });
  });

  describe('getById', () => {
    it('should retrieve a message by ID', () => {
      const enqueued = queue.enqueue({
        project_id: 'p1',
        message_type: 'health_check',
        sender_agent: 'orch',
        recipient_agent: 'builder',
        payload: { ping: true },
      });

      const fetched = queue.getById(enqueued.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(enqueued.id);
    });

    it('should return undefined for non-existent ID', () => {
      expect(queue.getById(99999)).toBeUndefined();
    });
  });
});
