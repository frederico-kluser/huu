import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import {
  FollowUpQueue,
  SteerRegistry,
  AgentControlBridge,
  MAX_FOLLOW_UP_QUEUE,
} from '../agent-control.js';
import type { InterventionPayload } from '../interventions.js';

// ── FollowUpQueue ─────────────────────────────────────────────────────

describe('FollowUpQueue', () => {
  let fq: FollowUpQueue;

  beforeEach(() => {
    fq = new FollowUpQueue();
  });

  it('enqueues and dequeues in FIFO order', () => {
    fq.enqueue('run-1', { commandId: 'a', text: 'first', createdAt: '2024-01-01' });
    fq.enqueue('run-1', { commandId: 'b', text: 'second', createdAt: '2024-01-02' });
    fq.enqueue('run-1', { commandId: 'c', text: 'third', createdAt: '2024-01-03' });

    expect(fq.dequeue('run-1')?.text).toBe('first');
    expect(fq.dequeue('run-1')?.text).toBe('second');
    expect(fq.dequeue('run-1')?.text).toBe('third');
    expect(fq.dequeue('run-1')).toBeUndefined();
  });

  it('respects per-run isolation', () => {
    fq.enqueue('run-1', { commandId: 'a', text: 'for-run-1', createdAt: '' });
    fq.enqueue('run-2', { commandId: 'b', text: 'for-run-2', createdAt: '' });

    expect(fq.dequeue('run-1')?.text).toBe('for-run-1');
    expect(fq.dequeue('run-2')?.text).toBe('for-run-2');
    expect(fq.dequeue('run-1')).toBeUndefined();
  });

  it('rejects when queue limit reached', () => {
    for (let i = 0; i < MAX_FOLLOW_UP_QUEUE; i++) {
      expect(fq.enqueue('run-1', { commandId: `c${i}`, text: `msg-${i}`, createdAt: '' })).not.toBeNull();
    }
    expect(fq.enqueue('run-1', { commandId: 'overflow', text: 'too-many', createdAt: '' })).toBeNull();
  });

  it('reports correct pending count', () => {
    expect(fq.pendingCount('run-1')).toBe(0);
    fq.enqueue('run-1', { commandId: 'a', text: 'msg', createdAt: '' });
    expect(fq.pendingCount('run-1')).toBe(1);
    fq.enqueue('run-1', { commandId: 'b', text: 'msg2', createdAt: '' });
    expect(fq.pendingCount('run-1')).toBe(2);
    fq.dequeue('run-1');
    expect(fq.pendingCount('run-1')).toBe(1);
  });

  it('cancelAll clears the queue and returns canceled entries', () => {
    fq.enqueue('run-1', { commandId: 'a', text: 'first', createdAt: '' });
    fq.enqueue('run-1', { commandId: 'b', text: 'second', createdAt: '' });

    const canceled = fq.cancelAll('run-1');
    expect(canceled).toHaveLength(2);
    expect(canceled[0]?.commandId).toBe('a');
    expect(fq.pendingCount('run-1')).toBe(0);
    expect(fq.dequeue('run-1')).toBeUndefined();
  });

  it('hasPending returns correct value', () => {
    expect(fq.hasPending('run-1')).toBe(false);
    fq.enqueue('run-1', { commandId: 'a', text: 'msg', createdAt: '' });
    expect(fq.hasPending('run-1')).toBe(true);
  });
});

// ── SteerRegistry ─────────────────────────────────────────────────────

describe('SteerRegistry', () => {
  let registry: SteerRegistry;

  beforeEach(() => {
    registry = new SteerRegistry();
  });

  it('stores and consumes a steer', () => {
    registry.set('run-1', { commandId: 'a', text: 'redirect', requestedAt: '' });

    const steer = registry.consume('run-1');
    expect(steer?.text).toBe('redirect');
    expect(registry.consume('run-1')).toBeUndefined();
  });

  it('last-write-wins: returns superseded commandId', () => {
    registry.set('run-1', { commandId: 'a', text: 'first', requestedAt: '' });
    const superseded = registry.set('run-1', { commandId: 'b', text: 'second', requestedAt: '' });

    expect(superseded).toBe('a');
    const steer = registry.consume('run-1');
    expect(steer?.commandId).toBe('b');
    expect(steer?.text).toBe('second');
  });

  it('hasPending and clear work correctly', () => {
    expect(registry.hasPending('run-1')).toBe(false);
    registry.set('run-1', { commandId: 'a', text: 'msg', requestedAt: '' });
    expect(registry.hasPending('run-1')).toBe(true);
    registry.clear('run-1');
    expect(registry.hasPending('run-1')).toBe(false);
  });
});

// ── AgentControlBridge ────────────────────────────────────────────────

describe('AgentControlBridge', () => {
  let db: Database.Database;
  let queue: MessageQueue;
  let bridge: AgentControlBridge;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
    queue = new MessageQueue(db);
    bridge = new AgentControlBridge({ queue, projectId: 'proj-1' });
  });

  afterEach(() => {
    db?.close();
  });

  function makePayload(overrides: Partial<InterventionPayload> = {}): InterventionPayload {
    return {
      commandId: 'cmd-1',
      kind: 'steer',
      taskId: 'task-1',
      agentId: 'builder',
      agentRunId: 'run-1',
      requestedBy: 'human',
      text: 'redirect here',
      requestedAt: new Date().toISOString(),
      state: 'queued',
      ...overrides,
    };
  }

  it('handleSteer stores steer and publishes ACK', () => {
    bridge.handleSteer(makePayload());

    const steer = bridge.consumeSteer('run-1');
    expect(steer?.text).toBe('redirect here');
  });

  it('handleSteer supersedes previous steer', () => {
    bridge.handleSteer(makePayload({ commandId: 'cmd-1', text: 'first' }));
    bridge.handleSteer(makePayload({ commandId: 'cmd-2', text: 'second' }));

    const steer = bridge.consumeSteer('run-1');
    expect(steer?.commandId).toBe('cmd-2');
    expect(steer?.text).toBe('second');
  });

  it('handleFollowUp enqueues and drains in FIFO order', () => {
    bridge.handleFollowUp(makePayload({ commandId: 'c1', kind: 'follow_up', text: 'first' }));
    bridge.handleFollowUp(makePayload({ commandId: 'c2', kind: 'follow_up', text: 'second' }));
    bridge.handleFollowUp(makePayload({ commandId: 'c3', kind: 'follow_up', text: 'third' }));

    expect(bridge.getPendingFollowUpCount('run-1')).toBe(3);

    expect(bridge.drainFollowUp('run-1')?.text).toBe('first');
    expect(bridge.drainFollowUp('run-1')?.text).toBe('second');
    expect(bridge.drainFollowUp('run-1')?.text).toBe('third');
    expect(bridge.drainFollowUp('run-1')).toBeUndefined();
  });

  it('handleFollowUp rejects when queue limit reached', () => {
    for (let i = 0; i < MAX_FOLLOW_UP_QUEUE; i++) {
      bridge.handleFollowUp(makePayload({ commandId: `c${i}`, kind: 'follow_up', text: `msg-${i}` }));
    }

    // This one should be rejected
    bridge.handleFollowUp(makePayload({ commandId: 'overflow', kind: 'follow_up', text: 'too-many' }));
    expect(bridge.getPendingFollowUpCount('run-1')).toBe(MAX_FOLLOW_UP_QUEUE);
  });

  it('cancelAllPending clears steers and follow-ups', () => {
    bridge.handleSteer(makePayload());
    bridge.handleFollowUp(makePayload({ commandId: 'c1', kind: 'follow_up', text: 'fu1' }));
    bridge.handleFollowUp(makePayload({ commandId: 'c2', kind: 'follow_up', text: 'fu2' }));

    bridge.cancelAllPending('run-1');

    expect(bridge.consumeSteer('run-1')).toBeUndefined();
    expect(bridge.drainFollowUp('run-1')).toBeUndefined();
    expect(bridge.getPendingFollowUpCount('run-1')).toBe(0);
  });
});
