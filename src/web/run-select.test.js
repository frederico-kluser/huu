import { describe, expect, it } from 'vitest';
import { pickActiveRun } from './client/run-select.js';

// Regression spec for the "terminal narrates, web shows nothing" bug: the
// active-run pointer parked on an early finished/failed run and never moved
// (the old rule only re-adopted when the pointed run VANISHED), so the board
// auto-switch — gated on the POINTED run being `running` — never fired while
// nine live projects streamed in the serve terminal.
describe('pickActiveRun (which run the board shows)', () => {
  const r = (runId, phase) => ({ runId, phase });

  it('advances OFF a terminal run to the first running one (the bug)', () => {
    const runs = [r('old-done', 'done'), r('live-1', 'running'), r('live-2', 'running')];
    expect(pickActiveRun('old-done', null, runs)).toBe('live-1');
    expect(pickActiveRun('old-err', null, [r('old-err', 'error'), r('live', 'running')])).toBe('live');
  });

  it('keeps a RUNNING current pointer (no view churn between frames)', () => {
    const runs = [r('a', 'running'), r('b', 'running')];
    expect(pickActiveRun('b', null, runs)).toBe('b');
  });

  it('honors the user pick while its run is tracked, even if terminal', () => {
    const runs = [r('done-1', 'done'), r('live-1', 'running')];
    expect(pickActiveRun('live-1', 'done-1', runs)).toBe('done-1');
    // pin gone from tracking → auto-follow resumes
    expect(pickActiveRun('live-1', 'pruned', runs)).toBe('live-1');
  });

  it('falls back queued → current → most recent → null', () => {
    // nothing running: a queued current holds, else the first queued
    expect(pickActiveRun('q2', null, [r('q1', 'queued'), r('q2', 'queued')])).toBe('q2');
    expect(pickActiveRun('done', null, [r('done', 'done'), r('q1', 'queued')])).toBe('q1');
    // nothing live at all: keep the existing pointer (its board stays readable)
    expect(pickActiveRun('done', null, [r('done', 'done'), r('err', 'error')])).toBe('done');
    // no pointer: most recent terminal run
    expect(pickActiveRun(null, null, [r('old', 'done'), r('new', 'error')])).toBe('new');
    expect(pickActiveRun(null, null, [])).toBe(null);
  });

  it('bootstrap replay converges on the running run regardless of frame order', () => {
    // Frames arrive one by one (Map insertion order = oldest first) — fold the
    // decision like ingestRun does and the pointer must land on the live run.
    const timeline = [r('done-a', 'done'), r('done-b', 'error'), r('live', 'running')];
    let active = null;
    const seen = [];
    for (const run of timeline) {
      seen.push(run);
      active = pickActiveRun(active, null, seen);
    }
    expect(active).toBe('live');
  });
});
