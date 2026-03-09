import { describe, it, expect } from 'vitest';
import { getDensity, KANBAN_COLUMNS, COLUMN_LABELS, TAB_BY_KEY } from '../types.js';

describe('getDensity', () => {
  it('returns compact for narrow terminals', () => {
    expect(getDensity(80)).toBe('compact');
    expect(getDensity(100)).toBe('compact');
    expect(getDensity(119)).toBe('compact');
  });

  it('returns normal for medium terminals', () => {
    expect(getDensity(120)).toBe('normal');
    expect(getDensity(150)).toBe('normal');
    expect(getDensity(199)).toBe('normal');
  });

  it('returns wide for large terminals', () => {
    expect(getDensity(200)).toBe('wide');
    expect(getDensity(300)).toBe('wide');
  });
});

describe('KANBAN_COLUMNS', () => {
  it('has 5 columns in correct order', () => {
    expect(KANBAN_COLUMNS).toEqual([
      'backlog',
      'running',
      'review',
      'done',
      'failed',
    ]);
  });

  it('has labels for all columns', () => {
    for (const col of KANBAN_COLUMNS) {
      expect(COLUMN_LABELS[col]).toBeDefined();
      expect(typeof COLUMN_LABELS[col]).toBe('string');
    }
  });
});

describe('TAB_BY_KEY', () => {
  it('maps k/l/m/c/b to tabs', () => {
    expect(TAB_BY_KEY['k']).toBe('kanban');
    expect(TAB_BY_KEY['l']).toBe('logs');
    expect(TAB_BY_KEY['m']).toBe('merge');
    expect(TAB_BY_KEY['c']).toBe('cost');
    expect(TAB_BY_KEY['b']).toBe('beat');
  });

  it('returns undefined for unmapped keys', () => {
    expect(TAB_BY_KEY['x']).toBeUndefined();
    expect(TAB_BY_KEY['q']).toBeUndefined();
  });
});
