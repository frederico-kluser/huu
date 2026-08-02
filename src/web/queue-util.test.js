import { describe, expect, it } from 'vitest';
import { isSettled, parseTimeoutMinutes, relinkQueue, settleQueue, summarizeQueue } from './client/queue-util.js';

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

// Regression spec for the mid-queue-refresh amnesia: the runner's tracking
// (running/live/processed/settled) was memory-only and persistQueue stripped
// statuses, so after F5 every chip reset to 'pending' — no more archiving, no
// queue completion, and "Run queue" re-armed against projects still running
// server-side. relinkQueue reconstructs the linkage from persisted v2 items ×
// the bootstrap run snapshots.
describe('relinkQueue (mid-queue refresh re-link)', () => {
  let seq = 0;
  const item = (over = {}) => ({
    id: 'i' + seq++, pipelineName: 'pipe', runDirectory: '/a',
    status: 'pending', runId: null, ...over,
  });
  const run = (runId, phase, over = {}) =>
    ({ runId, phase, pipelineName: 'pipe', runDirectory: '/a', ...over });

  it('re-links items to tracked runs by runId and derives running from the live set', () => {
    const link = relinkQueue(
      [item({ runId: 'r1', status: 'running' }), item({ runId: 'r2', status: 'queued' })],
      [run('r1', 'running'), run('r2', 'queued')],
    );
    expect(link.items.map((i) => i.status)).toEqual(['running', 'queued']);
    expect(link.live).toEqual([['r1', 0], ['r2', 1]]);
    expect(link.running).toBe(true);
    expect(link.settledCount).toBe(0);
    expect(link.resume).toEqual([]);
    expect(link.orphaned).toEqual([]);
    expect(link.rearchive).toEqual([]);
  });

  it('marks runs that settled while away for re-archive and counts them settled', () => {
    const link = relinkQueue(
      [item({ runId: 'r1', status: 'running' }), item({ runId: 'r2', status: 'running' })],
      [run('r1', 'done'), run('r2', 'error')],
    );
    expect(link.items.map((i) => i.status)).toEqual(['done', 'error']);
    expect(link.processed).toEqual(['r1', 'r2']);
    expect(link.rearchive).toEqual([0, 1]);
    expect(link.settledCount).toBe(2);
    expect(link.running).toBe(false);
    expect(link.live).toEqual([]);
  });

  it('orphans a runId the server no longer tracks (huu restarted)', () => {
    const link = relinkQueue([item({ runId: 'gone', status: 'running' })], []);
    expect(link.items[0].status).toBe('error');
    expect(link.orphaned).toEqual([0]);
    expect(link.settledCount).toBe(1);
    expect(link.running).toBe(false);
  });

  it('adopts an unclaimed non-terminal run by (dir, pipeline) when the POST response was lost', () => {
    const link = relinkQueue([item({ status: 'queued' })], [run('r9', 'running')]);
    expect(link.items[0].runId).toBe('r9');
    expect(link.items[0].status).toBe('running');
    expect(link.live).toEqual([['r9', 0]]);
    expect(link.resume).toEqual([]);
  });

  it('never adopts a TERMINAL run heuristically — stale done-runs for the same project are common', () => {
    const link = relinkQueue([item({ status: 'queued' })], [run('old', 'done')]);
    expect(link.items[0].runId).toBeNull();
    expect(link.items[0].status).toBe('queued');
    expect(link.resume).toEqual([0]);
    expect(link.running).toBe(true); // resume implies the queue keeps running
  });

  it('claims each run at most once — the twin item resumes instead of double-linking', () => {
    const link = relinkQueue(
      [item({ status: 'queued' }), item({ status: 'queued' })],
      [run('r1', 'running')],
    );
    expect(link.live).toEqual([['r1', 0]]);
    expect(link.resume).toEqual([1]);
  });

  it('mixed queue: settled + live keeps running with the right settled count', () => {
    const link = relinkQueue(
      [
        item({ runId: 'r1', status: 'running' }),
        item({ runId: 'r2', status: 'running' }),
        item({ runId: 'r3', status: 'queued' }),
      ],
      [run('r1', 'done'), run('r2', 'error'), run('r3', 'running')],
    );
    expect(link.settledCount).toBe(2);
    expect(link.live).toEqual([['r3', 2]]);
    expect(link.running).toBe(true);
  });

  it('leaves never-dispatched pending items alone (foreign runs are irrelevant)', () => {
    const link = relinkQueue([item({})], [run('r1', 'running', { runDirectory: '/other' })]);
    expect(link.items[0].status).toBe('pending');
    expect(link.items[0].runId).toBeNull();
    expect(link.running).toBe(false);
    expect(link.resume).toEqual([]);
  });

  it('does not mutate the input items', () => {
    const original = [item({ runId: 'r1', status: 'running' })];
    relinkQueue(original, [run('r1', 'done')]);
    expect(original[0].status).toBe('running');
  });
});
