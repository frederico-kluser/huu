import { describe, it, expect } from 'vitest';
import { resolveAgentMemSeedMb, resolveEmaAlpha, resolveRamTuning } from './ram-tuning.js';

describe('resolveAgentMemSeedMb', () => {
  it('parses and clamps to the scaler estimate bounds [128, 2048]', () => {
    expect(resolveAgentMemSeedMb({ HUU_AGENT_MEM_SEED_MB: '512' })).toBe(512);
    expect(resolveAgentMemSeedMb({ HUU_AGENT_MEM_SEED_MB: '64' })).toBe(128);
    expect(resolveAgentMemSeedMb({ HUU_AGENT_MEM_SEED_MB: '9000' })).toBe(2048);
    expect(resolveAgentMemSeedMb({ HUU_AGENT_MEM_SEED_MB: ' 1024.9 ' })).toBe(1024);
  });
  it('unset/garbage/non-positive → undefined (defaults preserved, never throws)', () => {
    expect(resolveAgentMemSeedMb({})).toBeUndefined();
    expect(resolveAgentMemSeedMb({ HUU_AGENT_MEM_SEED_MB: '' })).toBeUndefined();
    expect(resolveAgentMemSeedMb({ HUU_AGENT_MEM_SEED_MB: 'abc' })).toBeUndefined();
    expect(resolveAgentMemSeedMb({ HUU_AGENT_MEM_SEED_MB: '-5' })).toBeUndefined();
    expect(resolveAgentMemSeedMb({ HUU_AGENT_MEM_SEED_MB: '0' })).toBeUndefined();
  });
});

describe('resolveEmaAlpha', () => {
  it('parses and clamps to [0.01, 1]', () => {
    expect(resolveEmaAlpha({ HUU_AGENT_MEM_EMA_ALPHA: '0.5' })).toBe(0.5);
    expect(resolveEmaAlpha({ HUU_AGENT_MEM_EMA_ALPHA: '0.001' })).toBe(0.01);
    expect(resolveEmaAlpha({ HUU_AGENT_MEM_EMA_ALPHA: '3' })).toBe(1);
  });
  it('unset/garbage → undefined', () => {
    expect(resolveEmaAlpha({})).toBeUndefined();
    expect(resolveEmaAlpha({ HUU_AGENT_MEM_EMA_ALPHA: 'x' })).toBeUndefined();
    expect(resolveEmaAlpha({ HUU_AGENT_MEM_EMA_ALPHA: '-1' })).toBeUndefined();
  });
});

describe('resolveRamTuning', () => {
  it('OMITS unset keys so spread never clobbers the AutoScaler ?? defaults', () => {
    expect(resolveRamTuning({})).toEqual({});
    expect('agentMemoryEstimateMb' in resolveRamTuning({})).toBe(false);
    expect(resolveRamTuning({ HUU_AGENT_MEM_SEED_MB: '768' })).toEqual({
      agentMemoryEstimateMb: 768,
    });
    expect(
      resolveRamTuning({ HUU_AGENT_MEM_SEED_MB: '768', HUU_AGENT_MEM_EMA_ALPHA: '0.4' }),
    ).toEqual({ agentMemoryEstimateMb: 768, emaAlpha: 0.4 });
  });
});
