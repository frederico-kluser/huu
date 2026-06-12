import { describe, it, expect } from 'vitest';
import { hasDagEdges, effectiveDeps, computeWave, descendantsOf } from './wave-scheduler.js';
import type { PipelineStep } from '../lib/types.js';

function work(name: string, extra: Partial<Extract<PipelineStep, { prompt: string }>> = {}): PipelineStep {
  return { type: 'work', name, prompt: 'p', files: [], scope: 'project', ...extra } as PipelineStep;
}

function check(name: string, dependsOn?: string[]): PipelineStep {
  return {
    type: 'check',
    name,
    condition: 'c',
    outcomes: [{ label: 'ok', nextStepName: name, default: true }],
    dependsOn,
  } as PipelineStep;
}

const diamond: PipelineStep[] = [
  work('setup', { dependsOn: [] }),
  work('lint', { dependsOn: ['setup'] }),
  work('security', { dependsOn: ['setup'] }),
  work('join', { dependsOn: ['lint', 'security'] }),
];

describe('hasDagEdges', () => {
  it('is false for plain v2 chains and true once any step declares dependsOn', () => {
    expect(hasDagEdges([work('a'), work('b')])).toBe(false);
    expect(hasDagEdges(diamond)).toBe(true);
  });
});

describe('effectiveDeps', () => {
  it('defaults to the previous step (v2 chain) and [] for the first', () => {
    const steps = [work('a'), work('b'), work('c')];
    expect(effectiveDeps(steps, 0)).toEqual([]);
    expect(effectiveDeps(steps, 1)).toEqual(['a']);
    expect(effectiveDeps(steps, 2)).toEqual(['b']);
  });

  it('adds the implicit memory edge produces→filesFrom', () => {
    const steps = [
      work('scan', { produces: '.huu/t.json' }),
      work('other', { dependsOn: [] }),
      work('fix', { dependsOn: ['other'], scope: 'memory', filesFrom: '.huu/t.json' }),
    ];
    expect(effectiveDeps(steps, 2).sort()).toEqual(['other', 'scan']);
  });
});

describe('computeWave', () => {
  it('turns a plain chain into singleton waves in order', () => {
    const steps = [work('a'), work('b')];
    const done = new Set<string>();
    const pending = new Set(['a', 'b']);
    expect(computeWave(steps, done, pending).map((s) => s.name)).toEqual(['a']);
    done.add('a');
    pending.delete('a');
    expect(computeWave(steps, done, pending).map((s) => s.name)).toEqual(['b']);
  });

  it('runs the diamond in 3 waves with the middle pair together', () => {
    const done = new Set<string>();
    const pending = new Set(diamond.map((s) => s.name));
    expect(computeWave(diamond, done, pending).map((s) => s.name)).toEqual(['setup']);
    done.add('setup'); pending.delete('setup');
    expect(computeWave(diamond, done, pending).map((s) => s.name)).toEqual(['lint', 'security']);
    done.add('lint'); done.add('security');
    pending.delete('lint'); pending.delete('security');
    expect(computeWave(diamond, done, pending).map((s) => s.name)).toEqual(['join']);
  });

  it('a ready check preempts the wave as a singleton', () => {
    const steps = [
      work('a', { dependsOn: [] }),
      work('b', { dependsOn: [] }),
      check('gate', []),
    ];
    const wave = computeWave(steps, new Set(), new Set(['a', 'b', 'gate']));
    expect(wave.map((s) => s.name)).toEqual(['gate']);
  });

  it('returns [] when nothing is runnable (unreachable remainder)', () => {
    const steps = [work('a', { dependsOn: [] }), work('b', { dependsOn: ['a'] })];
    expect(computeWave(steps, new Set(), new Set(['b']))).toEqual([]);
  });
});

describe('descendantsOf', () => {
  it('returns the transitive downstream cone in array order', () => {
    expect(descendantsOf(diamond, 'setup')).toEqual(['lint', 'security', 'join']);
    expect(descendantsOf(diamond, 'lint')).toEqual(['join']);
    expect(descendantsOf(diamond, 'join')).toEqual([]);
  });

  it('follows implicit memory edges too', () => {
    const steps = [
      work('scan', { produces: '.huu/t.json', dependsOn: [] }),
      work('fix', { dependsOn: [], scope: 'memory', filesFrom: '.huu/t.json' }),
    ];
    expect(descendantsOf(steps, 'scan')).toEqual(['fix']);
  });
});
