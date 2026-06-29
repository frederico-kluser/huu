import { describe, expect, it } from 'vitest';
import { isSettled, parseTimeoutMinutes, settleQueue, summarizeQueue } from './client/queue-util.js';

// Pure, DOM-free queue logic. The browser app.js prunes the queue with this the
// moment a queue run finishes (finishQueue) or is stopped (stopFinalize). The
// contract locked here is the bug fix: a project that REACHED A TERMINAL STATE
// is archived to History and must LEAVE the queue, so returning home never
// re-runs the same pipeline.

const ids = (items) => items.map((i) => i.id);

describe('isSettled', () => {
  it('treats only done/error as terminal', () => {
    expect(isSettled('done')).toBe(true);
    expect(isSettled('error')).toBe(true);
    expect(isSettled('running')).toBe(false);
    expect(isSettled('pending')).toBe(false);
    expect(isSettled(undefined)).toBe(false);
  });
});

describe('settleQueue', () => {
  it('drops every settled item when a queue finishes cleanly (the bug fix)', () => {
    const items = [
      { id: 'a', status: 'done' },
      { id: 'b', status: 'error' },
      { id: 'c', status: 'done' },
    ];
    const { keep, done, error } = settleQueue(items);
    // All ran → queue empties; the home view shows nothing to re-run.
    expect(keep).toEqual([]);
    expect(done).toBe(2);
    expect(error).toBe(1);
  });

  it('keeps unfinished items (stopped queue) while dropping settled ones', () => {
    const items = [
      { id: 'a', status: 'done' },    // finished before the stop → History
      { id: 'b', status: 'error' },   // aborted → archived as error
      { id: 'c', status: 'running' }, // still in flight → keep
      { id: 'd', status: 'pending' }, // never started → keep
    ];
    const { keep, done, error } = settleQueue(items);
    expect(ids(keep)).toEqual(['c', 'd']);
    expect(done).toBe(1);
    expect(error).toBe(1);
  });

  it('preserves the order of the kept items', () => {
    const items = [
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'done' },
      { id: 'c', status: 'pending' },
      { id: 'd', status: 'running' },
    ];
    expect(ids(settleQueue(items).keep)).toEqual(['a', 'c', 'd']);
  });

  it('treats a half-built (never-run) queue as fully kept', () => {
    const items = [
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'pending' },
    ];
    const { keep, done, error } = settleQueue(items);
    expect(ids(keep)).toEqual(['a', 'b']);
    expect(done).toBe(0);
    expect(error).toBe(0);
  });

  it('is idempotent — re-pruning a settled result is a no-op (double stopFinalize)', () => {
    const once = settleQueue([
      { id: 'a', status: 'done' },
      { id: 'b', status: 'pending' },
    ]).keep;
    expect(ids(once)).toEqual(['b']);
    expect(ids(settleQueue(once).keep)).toEqual(['b']);
  });

  it('tolerates missing / non-array input', () => {
    expect(settleQueue(undefined)).toEqual({ keep: [], done: 0, error: 0 });
    expect(settleQueue(null)).toEqual({ keep: [], done: 0, error: 0 });
    expect(settleQueue([null, undefined, { id: 'a', status: 'done' }]).keep).toEqual([null, undefined]);
  });
});

describe('summarizeQueue', () => {
  // Feeds the launch-view "running" indicator while the user is back on home
  // adding more projects to a LIVE queue (they dispatch automatically).
  it('tallies a mixed live queue by status', () => {
    const s = summarizeQueue([
      { status: 'done' },
      { status: 'error' },
      { status: 'running' },
      { status: 'running' },
      { status: 'pending' },
    ]);
    expect(s).toEqual({ total: 5, done: 1, error: 1, running: 2, pending: 1, settled: 2 });
  });

  it('treats undefined/unknown status as pending (a freshly added item)', () => {
    const s = summarizeQueue([{ status: undefined }, {}, { status: 'queued' }]);
    expect(s.pending).toBe(3);
    expect(s.running).toBe(0);
    expect(s.settled).toBe(0);
    expect(s.total).toBe(3);
  });

  it('reports an all-settled queue (the moment it finishes)', () => {
    const s = summarizeQueue([{ status: 'done' }, { status: 'done' }, { status: 'error' }]);
    expect(s.settled).toBe(3);
    expect(s.running).toBe(0);
    expect(s.pending).toBe(0);
  });

  it('tolerates missing / non-array input', () => {
    const zero = { total: 0, done: 0, error: 0, running: 0, pending: 0, settled: 0 };
    expect(summarizeQueue(undefined)).toEqual(zero);
    expect(summarizeQueue(null)).toEqual(zero);
    expect(summarizeQueue([])).toEqual(zero);
  });
});

describe('parseTimeoutMinutes', () => {
  // Normalizes the launch-form "max time per agent" field. Empty/invalid →
  // undefined so the run keeps the pipeline's built-in default timeout.
  it('returns a positive integer for valid input (string or number)', () => {
    expect(parseTimeoutMinutes('15')).toBe(15);
    expect(parseTimeoutMinutes('  20 ')).toBe(20);
    expect(parseTimeoutMinutes(30)).toBe(30);
    expect(parseTimeoutMinutes('1')).toBe(1);
  });

  it('floors fractional minutes', () => {
    expect(parseTimeoutMinutes('15.9')).toBe(15);
    expect(parseTimeoutMinutes(7.2)).toBe(7);
  });

  it('treats blank / null / undefined as no override (undefined)', () => {
    expect(parseTimeoutMinutes('')).toBeUndefined();
    expect(parseTimeoutMinutes('   ')).toBeUndefined();
    expect(parseTimeoutMinutes(null)).toBeUndefined();
    expect(parseTimeoutMinutes(undefined)).toBeUndefined();
  });

  it('rejects zero, negatives and non-numeric junk', () => {
    expect(parseTimeoutMinutes('0')).toBeUndefined();
    expect(parseTimeoutMinutes('-5')).toBeUndefined();
    expect(parseTimeoutMinutes('abc')).toBeUndefined();
    expect(parseTimeoutMinutes('15min')).toBeUndefined();
    expect(parseTimeoutMinutes(NaN)).toBeUndefined();
  });
});
