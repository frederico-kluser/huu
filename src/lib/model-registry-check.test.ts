import { describe, expect, it } from 'vitest';
import {
  PI_EXECUTED_DEV_MODEL_ROLES,
  checkPiModelIds,
  formatDevModelPreflightError,
  preflightDevModelPolicy,
  suggestNearbyModelIds,
} from './model-registry-check.js';
import { DEV_MODEL_PRESETS } from './types.js';

describe('checkPiModelIds — what the pi AGENT can actually run', () => {
  it('knows the ids the presets route to pi agents', () => {
    expect(
      checkPiModelIds([
        'deepseek/deepseek-v4-pro',
        'moonshotai/kimi-k2.6',
        'deepseek/deepseek-v4-flash',
      ]),
    ).toEqual([
      { id: 'deepseek/deepseek-v4-pro', known: true },
      { id: 'moonshotai/kimi-k2.6', known: true },
      { id: 'deepseek/deepseek-v4-flash', known: true },
    ]);
  });

  it('does NOT know z-ai/glm-5.2 — the registry family stops at glm-5.1', () => {
    expect(checkPiModelIds(['z-ai/glm-5.2', 'z-ai/glm-5.1'])).toEqual([
      { id: 'z-ai/glm-5.2', known: false },
      { id: 'z-ai/glm-5.1', known: true },
    ]);
  });

  it('answers 1:1 and in order, so results zip back onto their roles', () => {
    const ids = ['moonshotai/kimi-k2.6', 'nope/not-a-model', 'deepseek/deepseek-v4-pro'];
    const checks = checkPiModelIds(ids);
    expect(checks.map((c) => c.id)).toEqual(ids);
    expect(checks.map((c) => c.known)).toEqual([true, false, true]);
  });

  it('reports garbage instead of throwing', () => {
    expect(checkPiModelIds([])).toEqual([]);
    expect(checkPiModelIds(['', '   ', 'no-slash', '../../etc/passwd']).every((c) => !c.known)).toBe(
      true,
    );
  });
});

describe('suggestNearbyModelIds', () => {
  it('offers the closest same-vendor ids for an unknown one', () => {
    const nearby = suggestNearbyModelIds('z-ai/glm-5.2');
    expect(nearby).toContain('z-ai/glm-5.1');
    expect(nearby.length).toBeLessThanOrEqual(3);
    expect(nearby.every((id) => id.startsWith('z-ai/'))).toBe(true);
    expect(nearby).not.toContain('z-ai/glm-5.2');
    // Best first: the longest shared model-name prefix leads.
    expect(nearby[0]).toBe('z-ai/glm-5.1');
  });

  it('recovers from a vendor typo by matching the model-name family', () => {
    expect(suggestNearbyModelIds('zai/glm-5.2')).toContain('z-ai/glm-5.1');
  });

  it('is deterministic and honest when nothing is close', () => {
    expect(suggestNearbyModelIds('z-ai/glm-5.2')).toEqual(suggestNearbyModelIds('z-ai/glm-5.2'));
    expect(suggestNearbyModelIds('zz-unknown-vendor/xq')).toEqual([]);
  });
});

describe('preflightDevModelPolicy', () => {
  // THE regression: the default preset routes `planner` to z-ai/glm-5.2, which
  // the pi registry does not have. The planner is not a pi agent — it is a
  // structured-output call — so checking it would refuse to start dev mode in
  // its own default configuration.
  it('never checks `planner`', () => {
    expect(PI_EXECUTED_DEV_MODEL_ROLES).not.toContain('planner');
    expect([...PI_EXECUTED_DEV_MODEL_ROLES].sort()).toEqual([
      'critic',
      'integration',
      'judge',
      'recon',
      'reporter',
      'worker',
    ]);
    // Not even an id that is obvious nonsense.
    expect(preflightDevModelPolicy({ planner: 'z-ai/glm-5.2' })).toEqual([]);
    expect(preflightDevModelPolicy({ planner: 'totally/made-up-id' })).toEqual([]);
  });

  it('passes every shipped preset — the defaults must be able to start', () => {
    for (const [name, preset] of Object.entries(DEV_MODEL_PRESETS)) {
      expect(preflightDevModelPolicy(preset), `preset ${name}`).toEqual([]);
    }
  });

  it('catches an unknown id in a pi-executed slot and names role, id and neighbors', () => {
    const issues = preflightDevModelPolicy({ worker: 'z-ai/glm-5.2' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.role).toBe('worker');
    expect(issues[0]!.id).toBe('z-ai/glm-5.2');
    expect(issues[0]!.suggestions).toContain('z-ai/glm-5.1');

    const message = formatDevModelPreflightError(issues);
    expect(message).toContain('worker');
    expect(message).toContain('z-ai/glm-5.2');
    expect(message).toContain('z-ai/glm-5.1');
    expect(message).toContain('planner');
  });

  it('reports every offending role, in role order, and trims', () => {
    const issues = preflightDevModelPolicy({
      planner: 'z-ai/glm-5.2',
      worker: ' z-ai/glm-5.2 ',
      critic: 'moonshotai/kimi-k2.6',
      judge: 'nope/not-a-model',
    });
    expect(issues.map((i) => i.role)).toEqual(['worker', 'judge']);
    expect(issues[0]!.id).toBe('z-ai/glm-5.2');
  });

  it('has nothing to say about roles the policy leaves unset', () => {
    expect(preflightDevModelPolicy(undefined)).toEqual([]);
    expect(preflightDevModelPolicy({})).toEqual([]);
    expect(preflightDevModelPolicy({ worker: '   ' })).toEqual([]);
  });

  it('is gated on the pi backend — azure and stub have other catalogs', () => {
    const policy = { worker: 'z-ai/glm-5.2' };
    expect(preflightDevModelPolicy(policy, 'azure')).toEqual([]);
    expect(preflightDevModelPolicy(policy, 'stub')).toEqual([]);
    // Default argument = the check runs, so a forgetful caller is still safe.
    expect(preflightDevModelPolicy(policy, 'pi')).toHaveLength(1);
    expect(preflightDevModelPolicy(policy)).toHaveLength(1);
  });
});
