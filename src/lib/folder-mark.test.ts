import { describe, expect, it } from 'vitest';
import { applyMarkAll, markAllPlan, toggleMark } from './folder-mark.js';

/**
 * TWIN of `src/web/folder-select.test.js` — the SAME cases, in the same order,
 * asserted against the TS implementation the Ink picker uses. Cross-importing the
 * browser mirror is not an option (`tsconfig` has no `allowJs`, so an untyped
 * client `.js` fails typecheck), which is exactly why `card-state.ts` ↔
 * `card-state.js` are pinned by paired tests rather than a shared import. Keep
 * the two case tables identical when either side changes.
 */
describe('markAllPlan (bulk mark of the folder-picker listing)', () => {
  const entries = ['/w/a', '/w/b', '/w/c'];

  it('empty listing → none (the control hides)', () => {
    expect(markAllPlan(new Set(), [])).toEqual({ action: 'none', paths: [], total: 0 });
  });

  it('marks ONLY the entries still missing', () => {
    const plan = markAllPlan(new Set(['/w/b']), entries);
    expect(plan.action).toBe('mark');
    expect(plan.paths).toEqual(['/w/a', '/w/c']);
    expect(plan.total).toBe(3);
  });

  it('flips to unmark once every listed entry is marked', () => {
    const plan = markAllPlan(new Set(entries), entries);
    expect(plan.action).toBe('unmark');
    expect(plan.paths).toEqual(entries);
  });

  it('never touches folders marked in OTHER directories', () => {
    const marked = new Set(['/elsewhere/x', ...entries]);
    const plan = markAllPlan(marked, entries);
    expect(plan.action).toBe('unmark');
    expect(plan.paths).toEqual(entries); // '/elsewhere/x' stays marked
  });

  it('accepts any iterable of marked paths and ignores falsy entries', () => {
    const plan = markAllPlan(['/w/a'], ['/w/a', '', '/w/b']);
    expect(plan.action).toBe('mark');
    expect(plan.paths).toEqual(['/w/b']);
    expect(plan.total).toBe(2);
  });

  // The table the web mirror asserts too — if either side changes, both fail.
  it('matches the web mirror table case for case', () => {
    expect(markAllPlan(new Set(), [])).toEqual({ action: 'none', paths: [], total: 0 });
    expect(markAllPlan(new Set(), entries)).toEqual({
      action: 'mark',
      paths: entries,
      total: 3,
    });
    expect(markAllPlan(new Set(['/w/b']), entries)).toEqual({
      action: 'mark',
      paths: ['/w/a', '/w/c'],
      total: 3,
    });
    expect(markAllPlan(new Set(entries), entries)).toEqual({
      action: 'unmark',
      paths: entries,
      total: 3,
    });
    expect(markAllPlan(new Set(['/elsewhere/x', ...entries]), entries)).toEqual({
      action: 'unmark',
      paths: entries,
      total: 3,
    });
    expect(markAllPlan(new Set(['/w/a']), ['/w/a', '/w/b'])).toEqual({
      action: 'mark',
      paths: ['/w/b'],
      total: 2,
    });
  });
});

describe('applyMarkAll / toggleMark (set transitions the picker performs)', () => {
  const entries = ['/w/a', '/w/b'];

  it('applying a mark plan adds exactly the planned paths, leaving others alone', () => {
    const next = applyMarkAll(['/elsewhere/x'], markAllPlan([], entries));
    expect([...next].sort()).toEqual(['/elsewhere/x', '/w/a', '/w/b']);
  });

  it('applying an unmark plan removes only this listing, keeping foreign marks', () => {
    const next = applyMarkAll(
      ['/elsewhere/x', ...entries],
      markAllPlan(['/elsewhere/x', ...entries], entries),
    );
    expect([...next]).toEqual(['/elsewhere/x']);
  });

  it("a 'none' plan is a no-op", () => {
    const next = applyMarkAll(entries, markAllPlan(entries, []));
    expect([...next].sort()).toEqual(entries);
  });

  it('returns a NEW set so React sees a fresh identity', () => {
    const before = new Set(entries);
    expect(toggleMark(before, '/w/c')).not.toBe(before);
    expect([...before]).toEqual(entries); // input untouched
  });

  it('toggleMark adds then removes', () => {
    const added = toggleMark([], '/w/a');
    expect([...added]).toEqual(['/w/a']);
    expect([...toggleMark(added, '/w/a')]).toEqual([]);
  });
});
