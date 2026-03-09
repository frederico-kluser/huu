import { describe, it, expect } from 'vitest';
import {
  checkHardRules,
  computeRiskScore,
  isHighRisk,
  estimateRiskFactors,
  classifyCriticality,
} from '../criticality.js';
import type { AtomicTask } from '../beatsheet.js';

function makeTask(overrides: Partial<AtomicTask> = {}): AtomicTask {
  return {
    id: 'task-1',
    actId: 'act-1',
    sequenceId: 'seq-1',
    title: 'Implement feature',
    precondition: 'none',
    action: 'Build the feature',
    postcondition: 'Feature works',
    verification: 'Tests pass',
    dependencies: [],
    critical: false,
    estimatedEffort: 'medium',
    status: 'pending',
    ...overrides,
  };
}

// ── checkHardRules ──────────────────────────────────────────────────

describe('checkHardRules', () => {
  it('returns no match for benign titles', () => {
    const result = checkHardRules('Add button component', 'Create a button');
    expect(result.matched).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it('detects auth/security keywords', () => {
    const result = checkHardRules('Fix authentication flow', 'Update login endpoint');
    expect(result.matched).toBe(true);
    expect(result.reasons).toContain('TOUCHES_AUTH_SECURITY');
  });

  it('detects infra/deploy keywords', () => {
    const result = checkHardRules('Update deployment config', 'Modify production settings');
    expect(result.matched).toBe(true);
    expect(result.reasons).toContain('ALTERS_INFRA_DEPLOY');
  });

  it('detects architecture decision keywords', () => {
    const result = checkHardRules('Change public API contract', 'Modify interface');
    expect(result.matched).toBe(true);
    expect(result.reasons).toContain('ALTERS_ARCH_DECISION');
  });

  it('detects compliance keywords', () => {
    const result = checkHardRules('GDPR data retention', 'Update privacy policy');
    expect(result.matched).toBe(true);
    expect(result.reasons).toContain('COMPLIANCE_LEGAL_RISK');
  });

  it('matches multiple categories', () => {
    const result = checkHardRules(
      'Deploy authentication service with GDPR compliance',
      'Update production config',
    );
    expect(result.matched).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('checks filesChanged for keywords', () => {
    const result = checkHardRules('Update module', 'Change settings', [
      'src/auth/middleware.ts',
    ]);
    expect(result.matched).toBe(true);
    expect(result.reasons).toContain('TOUCHES_AUTH_SECURITY');
  });
});

// ── computeRiskScore ────────────────────────────────────────────────

describe('computeRiskScore', () => {
  it('sums all factors', () => {
    expect(computeRiskScore({ impact: 3, irreversibility: 2, uncertainty: 1 })).toBe(6);
  });

  it('returns 0 for minimal factors', () => {
    expect(computeRiskScore({ impact: 1, irreversibility: 0, uncertainty: 0 })).toBe(1);
  });

  it('returns max for extreme factors', () => {
    expect(computeRiskScore({ impact: 5, irreversibility: 3, uncertainty: 2 })).toBe(10);
  });
});

// ── isHighRisk ──────────────────────────────────────────────────────

describe('isHighRisk', () => {
  it('returns true when score >= 7', () => {
    expect(isHighRisk({ impact: 4, irreversibility: 2, uncertainty: 1 })).toBe(true);
  });

  it('returns false when score < 7', () => {
    expect(isHighRisk({ impact: 3, irreversibility: 2, uncertainty: 1 })).toBe(false);
  });

  it('returns true at exactly 7', () => {
    expect(isHighRisk({ impact: 5, irreversibility: 2, uncertainty: 0 })).toBe(true);
  });
});

// ── estimateRiskFactors ─────────────────────────────────────────────

describe('estimateRiskFactors', () => {
  it('assigns higher impact for large effort', () => {
    const factors = estimateRiskFactors('Task', 'Do something', 'large');
    expect(factors.impact).toBe(4);
  });

  it('assigns lower impact for small effort', () => {
    const factors = estimateRiskFactors('Task', 'Do something', 'small');
    expect(factors.impact).toBe(2);
  });

  it('increases irreversibility for delete operations', () => {
    const factors = estimateRiskFactors('Delete old data', 'Remove unused tables', 'medium');
    expect(factors.irreversibility).toBe(3);
  });

  it('increases uncertainty for experimental tasks', () => {
    const factors = estimateRiskFactors('New experimental feature', 'Build prototype', 'medium');
    expect(factors.uncertainty).toBeGreaterThanOrEqual(1);
  });

  it('increases impact for many files changed', () => {
    const manyFiles = Array.from({ length: 15 }, (_, i) => `file${i}.ts`);
    const factors = estimateRiskFactors('Task', 'Do something', 'small', manyFiles);
    expect(factors.impact).toBeGreaterThan(2);
  });
});

// ── classifyCriticality ─────────────────────────────────────────────

describe('classifyCriticality', () => {
  it('respects explicit critical flag from beat sheet', () => {
    const task = makeTask({ critical: true });
    const result = classifyCriticality(task);
    expect(result.critical).toBe(true);
  });

  it('marks non-critical task as non-critical when no rules match', () => {
    const task = makeTask({ title: 'Add button', action: 'Create UI element' });
    const result = classifyCriticality(task);
    expect(result.critical).toBe(false);
  });

  it('triggers critical via hard rules', () => {
    const task = makeTask({ title: 'Fix JWT token validation', action: 'Update auth middleware' });
    const result = classifyCriticality(task);
    expect(result.critical).toBe(true);
    expect(result.criticalReasons).toContain('TOUCHES_AUTH_SECURITY');
  });

  it('triggers critical for Tier 4 merge conflicts', () => {
    const task = makeTask();
    const result = classifyCriticality(task, undefined, true);
    expect(result.critical).toBe(true);
    expect(result.criticalReasons).toContain('MERGE_TIER4_CONFLICT');
  });

  it('computes riskScore when no hard rules match', () => {
    const task = makeTask({
      title: 'Routine update',
      action: 'Change a line',
      estimatedEffort: 'small',
    });
    const result = classifyCriticality(task);
    expect(result.riskScore).toBeDefined();
  });

  it('triggers critical via high risk score', () => {
    // Use words that trigger risk score but NOT hard-rule keywords
    // (no auth/deploy/arch/compliance keywords)
    const task = makeTask({
      title: 'Delete and remove complex unknown module',
      action: 'Drop all data and rebuild uncertain structure',
      estimatedEffort: 'large',
      critical: false,
    });
    const result = classifyCriticality(task);
    // impact(4 large) + irreversibility(3 delete) + uncertainty(2 unknown+uncertain) = 9
    expect(result.riskScore).toBeDefined();
    expect(result.riskScore).toBeGreaterThanOrEqual(7);
    expect(result.critical).toBe(true);
    expect(result.criticalReasons).toContain('HIGH_RISK_SCORE');
  });

  it('always has criticalReasons array', () => {
    const task = makeTask();
    const result = classifyCriticality(task);
    expect(Array.isArray(result.criticalReasons)).toBe(true);
  });
});
