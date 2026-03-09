import { describe, it, expect } from 'vitest';
import {
  chooseTier3Side,
  classifyFileRisk,
  generateConflictFingerprint,
  classifyConflictType,
  isTier3Supported,
} from './heuristics.js';
import type { Tier3Signals } from '../types/index.js';

// ---------------------------------------------------------------------------
// classifyFileRisk
// ---------------------------------------------------------------------------

describe('classifyFileRisk', () => {
  it('should classify security-related files as high risk', () => {
    expect(classifyFileRisk('src/auth/login.ts')).toBe('high');
    expect(classifyFileRisk('lib/security/jwt.ts')).toBe('high');
    expect(classifyFileRisk('config/deploy.yaml')).toBe('high');
    expect(classifyFileRisk('db/migrations/001_init.sql')).toBe('high');
    expect(classifyFileRisk('src/payment/stripe.ts')).toBe('high');
    expect(classifyFileRisk('infra/terraform/main.tf')).toBe('high');
    expect(classifyFileRisk('.env.production')).toBe('high');
  });

  it('should classify docs and generated files as low risk', () => {
    expect(classifyFileRisk('README.md')).toBe('low');
    expect(classifyFileRisk('CHANGELOG.md')).toBe('low');
    expect(classifyFileRisk('docs/guide.md')).toBe('low');
    expect(classifyFileRisk('LICENSE')).toBe('low');
    expect(classifyFileRisk('notes.txt')).toBe('low');
    expect(classifyFileRisk('package-lock.lock')).toBe('low');
    expect(classifyFileRisk('test/__snapshots__/app.snap')).toBe('low');
  });

  it('should classify regular code files as medium risk', () => {
    expect(classifyFileRisk('src/utils/helpers.ts')).toBe('medium');
    expect(classifyFileRisk('src/components/Button.tsx')).toBe('medium');
    expect(classifyFileRisk('lib/parser.js')).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// chooseTier3Side — determinism
// ---------------------------------------------------------------------------

describe('chooseTier3Side', () => {
  const baseSignals: Tier3Signals = {
    filePath: 'src/utils.ts',
    conflictType: 'content',
    lastTouchSide: 'ours',
    ownershipScore: { ours: 0.8, theirs: 0.2 },
    historyScore: { ours: 0.7, theirs: 0.3 },
    riskClass: 'low',
  };

  it('should produce deterministic results for same input', () => {
    const result1 = chooseTier3Side(baseSignals);
    const result2 = chooseTier3Side(baseSignals);
    expect(result1).toEqual(result2);
  });

  it('should never auto-resolve high-risk files', () => {
    const highRisk: Tier3Signals = { ...baseSignals, riskClass: 'high' };
    const result = chooseTier3Side(highRisk);
    expect(result.side).toBe('escalate');
    expect(result.confidence).toBe(0);
  });

  it('should resolve to ours when ours has strong signals', () => {
    const result = chooseTier3Side(baseSignals);
    expect(result.side).toBe('ours');
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('should resolve to theirs when theirs has strong signals', () => {
    const theirsStrong: Tier3Signals = {
      ...baseSignals,
      lastTouchSide: 'theirs',
      ownershipScore: { ours: 0.2, theirs: 0.8 },
      historyScore: { ours: 0.3, theirs: 0.7 },
    };
    const result = chooseTier3Side(theirsStrong);
    expect(result.side).toBe('theirs');
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('should escalate when scores are too close', () => {
    const { lastTouchSide: _, ...baseWithoutLastTouch } = baseSignals;
    const ambiguous: Tier3Signals = {
      ...baseWithoutLastTouch,
      ownershipScore: { ours: 0.5, theirs: 0.5 },
      historyScore: { ours: 0.5, theirs: 0.5 },
    };
    const result = chooseTier3Side(ambiguous);
    expect(result.side).toBe('escalate');
  });

  it('should escalate medium-risk files with weak signals', () => {
    const { lastTouchSide: _2, ...baseWithoutLastTouch2 } = baseSignals;
    const mediumWeak: Tier3Signals = {
      ...baseWithoutLastTouch2,
      riskClass: 'medium',
      ownershipScore: { ours: 0.55, theirs: 0.45 },
      historyScore: { ours: 0.5, theirs: 0.5 },
    };
    const result = chooseTier3Side(mediumWeak);
    expect(result.side).toBe('escalate');
  });

  it('should handle missing last-touch as neutral', () => {
    const { lastTouchSide: _3, ...baseWithoutLastTouch3 } = baseSignals;
    const noLastTouch: Tier3Signals = {
      ...baseWithoutLastTouch3,
      ownershipScore: { ours: 0.9, theirs: 0.1 },
      historyScore: { ours: 0.9, theirs: 0.1 },
    };
    const result = chooseTier3Side(noLastTouch);
    expect(result.side).toBe('ours');
  });
});

// ---------------------------------------------------------------------------
// classifyConflictType
// ---------------------------------------------------------------------------

describe('classifyConflictType', () => {
  it('should detect rename/delete conflicts', () => {
    expect(classifyConflictType('CONFLICT (rename/delete): file.ts')).toBe('rename-delete');
  });

  it('should detect binary conflicts', () => {
    expect(classifyConflictType('CONFLICT (binary): image.png')).toBe('binary');
  });

  it('should default to content for regular conflicts', () => {
    expect(classifyConflictType('CONFLICT (content): src/app.ts')).toBe('content');
    expect(classifyConflictType('src/app.ts')).toBe('content');
  });
});

// ---------------------------------------------------------------------------
// isTier3Supported
// ---------------------------------------------------------------------------

describe('isTier3Supported', () => {
  it('should support content conflicts', () => {
    expect(isTier3Supported('content')).toBe(true);
    expect(isTier3Supported('add-add')).toBe(true);
  });

  it('should not support binary or rename/delete', () => {
    expect(isTier3Supported('binary')).toBe(false);
    expect(isTier3Supported('rename-delete')).toBe(false);
    expect(isTier3Supported('rename-rename')).toBe(false);
    expect(isTier3Supported('modify-delete')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateConflictFingerprint
// ---------------------------------------------------------------------------

describe('generateConflictFingerprint', () => {
  it('should produce stable fingerprints for same input', () => {
    const fp1 = generateConflictFingerprint('file.ts', 'content', 'a', 'b');
    const fp2 = generateConflictFingerprint('file.ts', 'content', 'a', 'b');
    expect(fp1).toBe(fp2);
  });

  it('should produce different fingerprints for different inputs', () => {
    const fp1 = generateConflictFingerprint('file.ts', 'content', 'a', 'b');
    const fp2 = generateConflictFingerprint('file.ts', 'content', 'a', 'c');
    expect(fp1).not.toBe(fp2);
  });

  it('should be 16 characters', () => {
    const fp = generateConflictFingerprint('file.ts', 'content', 'a', 'b');
    expect(fp).toHaveLength(16);
  });
});
