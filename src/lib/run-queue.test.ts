import { describe, expect, it } from 'vitest';
import { buildRunQueue, runLabel } from './run-queue.js';
import type { Pipeline } from './types.js';

const p = (name: string): Pipeline => ({ name, steps: [{ name: 's', prompt: 'x', files: [] }] });

describe('buildRunQueue (pipeline × project fan-out)', () => {
  it('produces one item per (pipeline, project) pair', () => {
    const items = buildRunQueue([p('Tests'), p('Docs')], ['/w/api', '/w/web'], '/fallback');
    expect(items).toHaveLength(4);
    expect(items.map((i) => `${i.pipeline.name}@${i.cwd}`)).toEqual([
      'Tests@/w/api',
      'Tests@/w/web',
      'Docs@/w/api',
      'Docs@/w/web',
    ]);
  });

  it('is PIPELINE-major, because index is scheduler priority', () => {
    const items = buildRunQueue([p('First'), p('Second')], ['/w/a', '/w/b'], '/fallback');
    // Both projects of `First` outrank anything from `Second`.
    expect(items.slice(0, 2).every((i) => i.pipeline.name === 'First')).toBe(true);
    expect(items.slice(2).every((i) => i.pipeline.name === 'Second')).toBe(true);
  });

  it('falls back to the session repo root when no project was marked', () => {
    const items = buildRunQueue([p('A'), p('B')], [], '/repo');
    expect(items.map((i) => i.cwd)).toEqual(['/repo', '/repo']);
  });

  it('labels each run with pipeline → folder so N runs are distinguishable', () => {
    const items = buildRunQueue([p('huu Test Suite')], ['/home/me/Projects/api'], '/x');
    expect(items[0]!.label).toBe('huu Test Suite → api');
  });

  it('no pipelines → empty queue (never a phantom run)', () => {
    expect(buildRunQueue([], ['/w/a'], '/x')).toEqual([]);
  });

  it('runLabel degrades to the full path at a filesystem root', () => {
    expect(runLabel(p('A'), '/')).toBe('A → /');
  });
});
