import { describe, expect, it } from 'vitest';
import { markAllPlan } from './client/folder-select.js';

// Pure decision behind the picker's "Mark all" button: one click marks every
// sub-folder of the CURRENT listing (the "run this pipeline over ~/Projects/*"
// case); when all of them are already marked the same button unmarks them.
// Marks made while browsing OTHER directories must always survive.
describe('markAllPlan (bulk mark of the folder-picker listing)', () => {
  const entries = ['/w/a', '/w/b', '/w/c'];

  it('empty listing → none (the control hides)', () => {
    expect(markAllPlan(new Set(), [])).toEqual({ action: 'none', paths: [], total: 0 });
    expect(markAllPlan(new Set(['/w/a']), undefined)).toEqual({ action: 'none', paths: [], total: 0 });
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
    const plan = markAllPlan(['/w/a'], ['/w/a', '', null, '/w/b']);
    expect(plan.action).toBe('mark');
    expect(plan.paths).toEqual(['/w/b']);
    expect(plan.total).toBe(2);
  });
});
