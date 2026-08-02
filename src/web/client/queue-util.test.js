import { describe, it, expect } from 'vitest';
import {
  isSettled, settleQueue, summarizeQueue, parseTimeoutMinutes,
  queueGroupKey, fanOutBatch, groupQueueItems,
} from './queue-util.js';

describe('parseTimeoutMinutes', () => {
  it('accepts positive integers, rejects the rest', () => {
    expect(parseTimeoutMinutes('30')).toBe(30);
    expect(parseTimeoutMinutes(12.9)).toBe(12);
    expect(parseTimeoutMinutes('')).toBeUndefined();
    expect(parseTimeoutMinutes('0')).toBeUndefined();
    expect(parseTimeoutMinutes('-5')).toBeUndefined();
    expect(parseTimeoutMinutes(null)).toBeUndefined();
    expect(parseTimeoutMinutes('abc')).toBeUndefined();
  });
});

describe('settleQueue / summarizeQueue', () => {
  it('drops settled items and keeps the rest, in order', () => {
    const items = [
      { status: 'done' }, { status: 'pending' }, { status: 'error' }, { status: 'running' },
    ];
    const { keep, done, error } = settleQueue(items);
    expect(done).toBe(1);
    expect(error).toBe(1);
    expect(keep).toEqual([{ status: 'pending' }, { status: 'running' }]);
  });

  it('tallies by status', () => {
    const s = summarizeQueue([{ status: 'done' }, { status: 'running' }, { status: 'pending' }, { status: 'error' }]);
    expect(s).toEqual({ total: 4, done: 1, error: 1, running: 1, pending: 1, settled: 2 });
    expect(isSettled('done')).toBe(true);
    expect(isSettled('running')).toBe(false);
  });
});

describe('queueGroupKey', () => {
  it('prefers groupId, falls back to a per-item key for legacy items', () => {
    expect(queueGroupKey({ groupId: 'g1', id: 'a' })).toBe('g1');
    expect(queueGroupKey({ id: 'a' })).toBe('item:a');
    expect(queueGroupKey({})).toBe('item:');
    expect(queueGroupKey(null)).toBe('');
  });
});

describe('fanOutBatch', () => {
  const base = { pipelineName: 'huu Test Suite', modelId: 'm', provider: 'openrouter', runDirectory: '/seed', id: 'seed', status: 'seed' };

  it('produces one item per dir with shared groupId and per-dir runDirectory', () => {
    let n = 0;
    const items = fanOutBatch(base, ['/a', '/b', '/c'], 'grp', () => 'id' + (++n));
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.runDirectory)).toEqual(['/a', '/b', '/c']);
    expect(items.every((i) => i.groupId === 'grp')).toBe(true);
    expect(items.every((i) => i.status === 'pending')).toBe(true);
    expect(items.every((i) => i.pipelineName === 'huu Test Suite')).toBe(true);
    // fresh ids override the base id; each is unique
    expect(items.map((i) => i.id)).toEqual(['id1', 'id2', 'id3']);
    // the base object is not mutated
    expect(base.runDirectory).toBe('/seed');
  });

  it('returns [] for empty/invalid dirs', () => {
    expect(fanOutBatch(base, [], 'g', () => 'x')).toEqual([]);
    expect(fanOutBatch(base, null, 'g', () => 'x')).toEqual([]);
  });
});

describe('groupQueueItems', () => {
  it('groups by groupId, preserving first-seen group order and intra-group order', () => {
    const items = [
      { id: '1', groupId: 'A', pipelineName: 'Suite', runDirectory: '/a1' },
      { id: '2', groupId: 'A', pipelineName: 'Suite', runDirectory: '/a2' },
      { id: '3', groupId: 'B', pipelineName: 'Security', runDirectory: '/b1' },
      { id: '4', groupId: 'A', pipelineName: 'Suite', runDirectory: '/a3' },
    ];
    const groups = groupQueueItems(items);
    // A appears first, then B — even though an A item trails after B
    expect(groups.map((g) => g.groupId)).toEqual(['A', 'B']);
    expect(groups[0].pipelineName).toBe('Suite');
    expect(groups[0].items.map((i) => i.runDirectory)).toEqual(['/a1', '/a2', '/a3']);
    expect(groups[1].items).toHaveLength(1);
  });

  it('gives legacy (groupId-less) items their own singleton groups', () => {
    const groups = groupQueueItems([{ id: 'x', pipelineName: 'Old' }, { id: 'y', pipelineName: 'Old' }]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.groupId)).toEqual(['item:x', 'item:y']);
  });

  it('handles empty / non-array input', () => {
    expect(groupQueueItems([])).toEqual([]);
    expect(groupQueueItems(null)).toEqual([]);
  });
});
