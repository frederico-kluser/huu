import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import {
  computeKeepScore,
  classify,
  Scratchpad,
} from '../scratchpad.js';
import type { Signal, CuratedItem } from '../scratchpad.js';
import { EntityRepository } from '../../db/repositories/entities.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
});

afterEach(() => {
  db?.close();
});

// ── Signal scoring ──────────────────────────────────────────────────

describe('computeKeepScore', () => {
  it('should return 1.0 for perfect signal', () => {
    const signal: Signal = {
      relevance: 1.0,
      durability: 1.0,
      confidence: 1.0,
      actionability: 1.0,
      novelty: 1.0,
      contradiction: false,
      impact: 'high',
    };
    expect(computeKeepScore(signal)).toBeCloseTo(1.0);
  });

  it('should return 0.0 for zero signal', () => {
    const signal: Signal = {
      relevance: 0,
      durability: 0,
      confidence: 0,
      actionability: 0,
      novelty: 0,
      contradiction: false,
      impact: 'low',
    };
    expect(computeKeepScore(signal)).toBeCloseTo(0.0);
  });

  it('should weight relevance highest (0.30)', () => {
    const base: Signal = {
      relevance: 0,
      durability: 0,
      confidence: 0,
      actionability: 0,
      novelty: 0,
      contradiction: false,
      impact: 'low',
    };
    const withRelevance = { ...base, relevance: 1.0 };
    expect(computeKeepScore(withRelevance)).toBeCloseTo(0.30);
  });
});

// ── Classification ──────────────────────────────────────────────────

describe('classify', () => {
  it('should quarantine high-impact contradictions', () => {
    const signal: Signal = {
      relevance: 0.9,
      durability: 0.9,
      confidence: 0.9,
      actionability: 0.9,
      novelty: 0.9,
      contradiction: true,
      impact: 'high',
    };
    expect(classify(signal)).toBe('quarantine');
  });

  it('should not quarantine low-impact contradictions', () => {
    const signal: Signal = {
      relevance: 0.9,
      durability: 0.9,
      confidence: 0.9,
      actionability: 0.9,
      novelty: 0.9,
      contradiction: true,
      impact: 'low',
    };
    // Score is 0.9, confidence 0.9 -> keep
    expect(classify(signal)).toBe('keep');
  });

  it('should keep high-score, high-confidence signals', () => {
    const signal: Signal = {
      relevance: 0.9,
      durability: 0.8,
      confidence: 0.8,
      actionability: 0.7,
      novelty: 0.6,
      contradiction: false,
      impact: 'high',
    };
    expect(classify(signal)).toBe('keep');
  });

  it('should summarize medium-score signals', () => {
    const signal: Signal = {
      relevance: 0.5,
      durability: 0.5,
      confidence: 0.5,
      actionability: 0.5,
      novelty: 0.5,
      contradiction: false,
      impact: 'medium',
    };
    // Score = 0.5
    expect(classify(signal)).toBe('summarize');
  });

  it('should discard low-score signals', () => {
    const signal: Signal = {
      relevance: 0.2,
      durability: 0.2,
      confidence: 0.3,
      actionability: 0.1,
      novelty: 0.1,
      contradiction: false,
      impact: 'low',
    };
    // Score = 0.30*0.2 + 0.20*0.2 + 0.20*0.3 + 0.20*0.1 + 0.10*0.1 = 0.19
    expect(classify(signal)).toBe('discard');
  });

  it('should require confidence >= 0.60 for keep', () => {
    const signal: Signal = {
      relevance: 1.0,
      durability: 1.0,
      confidence: 0.5, // Below threshold
      actionability: 1.0,
      novelty: 1.0,
      contradiction: false,
      impact: 'high',
    };
    // Score is 0.9 but confidence is 0.5 -> summarize
    expect(classify(signal)).toBe('summarize');
  });
});

// ── Scratchpad operations ───────────────────────────────────────────

describe('Scratchpad', () => {
  function makeItem(overrides?: Partial<CuratedItem>): CuratedItem {
    return {
      entityType: 'task_outcome',
      canonicalKey: 'task_outcome:task-1',
      displayName: 'Task 1 completed',
      summary: 'Implemented feature X',
      signal: {
        relevance: 0.9,
        durability: 0.8,
        confidence: 0.9,
        actionability: 0.7,
        novelty: 0.9,
        contradiction: false,
        impact: 'high',
      },
      decision: 'keep',
      sourceTaskId: 'task-1',
      sourceAgentId: 'builder',
      ...overrides,
    };
  }

  it('should apply keep decisions as entities', () => {
    const scratchpad = new Scratchpad(db);
    const item = makeItem();

    const result = scratchpad.apply('p1', [item]);
    expect(result.kept).toBe(1);

    const entityRepo = new EntityRepository(db);
    const entity = entityRepo.getByCanonicalKey('p1', 'task_outcome:task-1');
    expect(entity).toBeDefined();
    expect(entity!.summary).toBe('Implemented feature X');
  });

  it('should apply summarize decisions with prefix', () => {
    const scratchpad = new Scratchpad(db);
    const item = makeItem({ decision: 'summarize' });

    const result = scratchpad.apply('p1', [item]);
    expect(result.summarized).toBe(1);

    const entityRepo = new EntityRepository(db);
    const entity = entityRepo.getByCanonicalKey('p1', 'task_outcome:task-1');
    expect(entity).toBeDefined();
    expect(entity!.summary).toContain('[summarized]');
  });

  it('should apply discard decisions without persisting', () => {
    const scratchpad = new Scratchpad(db);
    const item = makeItem({ decision: 'discard', canonicalKey: 'discard-me' });

    const result = scratchpad.apply('p1', [item]);
    expect(result.discarded).toBe(1);

    const entityRepo = new EntityRepository(db);
    const entity = entityRepo.getByCanonicalKey('p1', 'discard-me');
    expect(entity).toBeUndefined();
  });

  it('should quarantine high-impact contradictions', () => {
    const scratchpad = new Scratchpad(db);
    const item = makeItem({
      decision: 'quarantine',
      signal: {
        relevance: 0.9,
        durability: 0.8,
        confidence: 0.9,
        actionability: 0.7,
        novelty: 0.9,
        contradiction: true,
        impact: 'high',
      },
    });

    const result = scratchpad.apply('p1', [item]);
    expect(result.quarantined).toBe(1);

    const quarantined = scratchpad.readQuarantined('p1');
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]!.display_name).toContain('[QUARANTINE]');
  });

  it('should supersede old entities with traceability', () => {
    const scratchpad = new Scratchpad(db);
    const entityRepo = new EntityRepository(db);

    // Create original entity
    const original = entityRepo.upsert({
      project_id: 'p1',
      entity_type: 'decision',
      canonical_key: 'decision:arch-1',
      display_name: 'Architecture v1',
      summary: 'Old approach',
    });

    // Create replacement
    const replacement = entityRepo.upsert({
      project_id: 'p1',
      entity_type: 'decision',
      canonical_key: 'decision:arch-2',
      display_name: 'Architecture v2',
      summary: 'New approach',
    });

    scratchpad.supersede('p1', original.id, replacement.id);

    // Original should be filtered from active reads
    const activeDecisions = scratchpad.readActive('p1', 'decision');
    const activeIds = activeDecisions.map((e) => e.id);
    expect(activeIds).toContain(replacement.id);
    expect(activeIds).not.toContain(original.id);
  });

  it('should expand 1-hop neighbors', () => {
    const scratchpad = new Scratchpad(db);
    const entityRepo = new EntityRepository(db);

    const e1 = entityRepo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'file:a.ts',
      display_name: 'a.ts',
    });
    const e2 = entityRepo.upsert({
      project_id: 'p1',
      entity_type: 'file',
      canonical_key: 'file:b.ts',
      display_name: 'b.ts',
    });

    scratchpad.supersede('p1', e1.id, e2.id); // Creates a 'supersedes' relation

    const neighbors = scratchpad.expand('p1', e2.id);
    expect(neighbors.length).toBeGreaterThan(0);
  });

  it('should handle mixed decisions in batch apply', () => {
    const scratchpad = new Scratchpad(db);
    const items: CuratedItem[] = [
      makeItem({ canonicalKey: 'keep-me', decision: 'keep' }),
      makeItem({ canonicalKey: 'summarize-me', decision: 'summarize' }),
      makeItem({ canonicalKey: 'discard-me', decision: 'discard' }),
      makeItem({
        canonicalKey: 'quarantine-me',
        decision: 'quarantine',
        signal: {
          relevance: 0.9, durability: 0.8, confidence: 0.9,
          actionability: 0.7, novelty: 0.9,
          contradiction: true, impact: 'high',
        },
      }),
    ];

    const result = scratchpad.apply('p1', items);
    expect(result.kept).toBe(1);
    expect(result.summarized).toBe(1);
    expect(result.discarded).toBe(1);
    expect(result.quarantined).toBe(1);
  });
});
