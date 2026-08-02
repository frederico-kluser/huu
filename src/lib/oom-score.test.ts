import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OOM_SCORE_ADJ,
  MAX_OOM_SCORE_ADJ,
  MIN_OOM_SCORE_ADJ,
  computeOomScoreAdj,
} from './oom-score.js';

describe('computeOomScoreAdj', () => {
  it('defaults to the conservative value when unset/empty', () => {
    expect(computeOomScoreAdj({})).toBe(DEFAULT_OOM_SCORE_ADJ);
    expect(computeOomScoreAdj({ HUU_OOM_SCORE_ADJ: '' })).toBe(DEFAULT_OOM_SCORE_ADJ);
    expect(computeOomScoreAdj({ HUU_OOM_SCORE_ADJ: '   ' })).toBe(DEFAULT_OOM_SCORE_ADJ);
  });

  it('reads an explicit value from the env', () => {
    expect(computeOomScoreAdj({ HUU_OOM_SCORE_ADJ: '0' })).toBe(0);
    expect(computeOomScoreAdj({ HUU_OOM_SCORE_ADJ: '-500' })).toBe(-500);
    expect(computeOomScoreAdj({ HUU_OOM_SCORE_ADJ: '250' })).toBe(250);
  });

  it('clamps to the kernel range', () => {
    expect(computeOomScoreAdj({ HUU_OOM_SCORE_ADJ: '-9999' })).toBe(MIN_OOM_SCORE_ADJ);
    expect(computeOomScoreAdj({ HUU_OOM_SCORE_ADJ: '9999' })).toBe(MAX_OOM_SCORE_ADJ);
  });

  it('falls back to the default on garbage', () => {
    expect(computeOomScoreAdj({ HUU_OOM_SCORE_ADJ: 'abc' })).toBe(DEFAULT_OOM_SCORE_ADJ);
  });

  it('rounds fractional values', () => {
    expect(computeOomScoreAdj({ HUU_OOM_SCORE_ADJ: '-100.7' })).toBe(-101);
  });
});
