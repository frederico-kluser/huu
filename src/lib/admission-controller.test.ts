import { describe, expect, it } from 'vitest';
import { AdmissionController } from './admission-controller.js';

const ctx = (over: Partial<Parameters<AdmissionController['shouldAdmit']>[0]> = {}) => ({
  liveAdmitted: 1,
  pendingCount: 5,
  schedulerRemaining: 10,
  anyIntegrating: false,
  ...over,
});

describe('AdmissionController', () => {
  it('admits only after sustained headroom (hysteresis = 3)', () => {
    const c = new AdmissionController({ hysteresisChecks: 3 });
    expect(c.shouldAdmit(ctx())).toBe(false); // streak 1
    expect(c.shouldAdmit(ctx())).toBe(false); // streak 2
    expect(c.shouldAdmit(ctx())).toBe(true); // streak 3 → admit
    // After admitting, the streak resets — needs to rebuild.
    expect(c.shouldAdmit(ctx())).toBe(false);
  });

  it('resets the streak when headroom disappears for a tick', () => {
    const c = new AdmissionController({ hysteresisChecks: 3 });
    c.shouldAdmit(ctx()); // streak 1
    c.shouldAdmit(ctx()); // streak 2
    expect(c.shouldAdmit(ctx({ schedulerRemaining: 0 }))).toBe(false); // streak → 0
    expect(c.shouldAdmit(ctx())).toBe(false); // streak 1 again
  });

  it('admits immediately when a run is integrating (bypasses hysteresis)', () => {
    const c = new AdmissionController({ hysteresisChecks: 3 });
    expect(c.shouldAdmit(ctx({ anyIntegrating: true }))).toBe(true);
  });

  it('blocks (and resets) at the live cap', () => {
    const c = new AdmissionController({ maxAdmitted: 2, hysteresisChecks: 1 });
    expect(c.shouldAdmit(ctx({ liveAdmitted: 2 }))).toBe(false);
    // Even with integrating true, the cap wins.
    expect(c.shouldAdmit(ctx({ liveAdmitted: 2, anyIntegrating: true }))).toBe(false);
  });

  it('never admits when nothing is pending', () => {
    const c = new AdmissionController({ hysteresisChecks: 1 });
    expect(c.shouldAdmit(ctx({ pendingCount: 0, anyIntegrating: true }))).toBe(false);
  });

  it('reset() clears the streak', () => {
    const c = new AdmissionController({ hysteresisChecks: 2 });
    c.shouldAdmit(ctx()); // streak 1
    c.reset();
    expect(c.shouldAdmit(ctx())).toBe(false); // streak 1 (not 2)
    expect(c.shouldAdmit(ctx())).toBe(true); // streak 2
  });
});
