import { describe, it, expect } from 'vitest';
import { TerminationTracker } from './termination-tracker.js';

describe('TerminationTracker', () => {
  it('finalize without any mark returns complete', () => {
    const t = new TerminationTracker();
    expect(t.finalize()).toEqual({ reason: 'complete' });
  });

  it('finalize uses shutdown=error when no local mark', () => {
    const t = new TerminationTracker();
    expect(t.finalize('error')).toEqual({ reason: 'error', message: undefined });
  });

  it('first markAbort wins over later markTimeout', () => {
    const t = new TerminationTracker();
    t.markAbort();
    t.markTimeout();
    expect(t.finalize('routine')).toEqual({ reason: 'abort' });
  });

  it('first markTimeout wins over later markAbort', () => {
    const t = new TerminationTracker();
    t.markTimeout();
    t.markAbort();
    expect(t.finalize('routine')).toEqual({ reason: 'timeout' });
  });

  it('markError captures message', () => {
    const t = new TerminationTracker();
    t.markError(new Error('boom'));
    expect(t.finalize()).toEqual({ reason: 'error', message: 'boom' });
  });

  it('markError on a non-Error stringifies', () => {
    const t = new TerminationTracker();
    t.markError('plain');
    expect(t.finalize()).toEqual({ reason: 'error', message: 'plain' });
  });

  it('local mark wins over shutdown reason', () => {
    const t = new TerminationTracker();
    t.markAbort();
    expect(t.finalize('error')).toEqual({ reason: 'abort' });
  });
});
