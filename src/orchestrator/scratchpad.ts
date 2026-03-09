// Scratchpad — stateful knowledge base operations
//
// The scratchpad is the project's memory: entities + relations in SQLite.
// This module provides structured read/write/archive operations with
// a formal curation policy (keep/summarize/discard/quarantine).
//
// Invariants:
// 1. All mutations are transactional (caller provides transaction)
// 2. No hard deletes — superseded items get archived with traceability
// 3. Contradictions of high impact are quarantined, never silently discarded
// 4. Every decision is auditable via metadata_json

import type Database from 'better-sqlite3';
import { EntityRepository } from '../db/repositories/entities.js';
import { RelationRepository } from '../db/repositories/relations.js';
import type { Entity, Relation } from '../types/index.js';

// ── Signal scoring ──────────────────────────────────────────────────

export interface Signal {
  relevance: number;    // 0..1 for current objective/beat
  durability: number;   // 0..1 (ephemeral → durable)
  confidence: number;   // 0..1 (observable evidence)
  actionability: number;// 0..1 (impacts next steps?)
  novelty: number;      // 0..1 (new vs redundant)
  contradiction: boolean;
  impact: 'low' | 'medium' | 'high';
}

export type CurationDecision = 'keep' | 'summarize' | 'discard' | 'quarantine';

/**
 * Compute a weighted keep score from signal dimensions.
 */
export function computeKeepScore(s: Signal): number {
  return (
    0.30 * s.relevance +
    0.20 * s.durability +
    0.20 * s.confidence +
    0.20 * s.actionability +
    0.10 * s.novelty
  );
}

/**
 * Deterministic classification of a signal into a curation decision.
 * Policy:
 *   quarantine: contradiction=true AND impact=high
 *   keep:       keepScore >= 0.70 AND confidence >= 0.60
 *   summarize:  0.45 <= keepScore < 0.70
 *   discard:    keepScore < 0.45 (and no open dependencies)
 */
export function classify(signal: Signal): CurationDecision {
  if (signal.contradiction && signal.impact === 'high') {
    return 'quarantine';
  }

  const score = computeKeepScore(signal);

  if (score >= 0.70 && signal.confidence >= 0.60) {
    return 'keep';
  }
  if (score >= 0.45) {
    return 'summarize';
  }
  return 'discard';
}

// ── Curated item ────────────────────────────────────────────────────

export interface CuratedItem {
  entityType: string;
  canonicalKey: string;
  displayName: string;
  summary: string;
  signal: Signal;
  decision: CurationDecision;
  sourceTaskId: string;
  sourceAgentId: string;
}

// ── Apply result ────────────────────────────────────────────────────

export interface ApplyResult {
  kept: number;
  summarized: number;
  discarded: number;
  quarantined: number;
  superseded: number;
}

// ── Scratchpad operations ───────────────────────────────────────────

export class Scratchpad {
  private readonly entities: EntityRepository;
  private readonly relations: RelationRepository;

  constructor(private readonly db: Database.Database) {
    this.entities = new EntityRepository(db);
    this.relations = new RelationRepository(db);
  }

  /**
   * Apply curation decisions to the scratchpad.
   * Must be called within a transaction (caller responsibility).
   */
  apply(
    projectId: string,
    items: CuratedItem[],
    sourceMessageId?: number,
  ): ApplyResult {
    const result: ApplyResult = {
      kept: 0,
      summarized: 0,
      discarded: 0,
      quarantined: 0,
      superseded: 0,
    };

    for (const item of items) {
      switch (item.decision) {
        case 'keep':
          this.applyKeep(projectId, item, sourceMessageId);
          result.kept++;
          break;
        case 'summarize':
          this.applySummarize(projectId, item, sourceMessageId);
          result.summarized++;
          break;
        case 'discard':
          result.discarded++;
          // Discarded items are not persisted but audited via the decision log
          break;
        case 'quarantine':
          this.applyQuarantine(projectId, item, sourceMessageId);
          result.quarantined++;
          break;
      }
    }

    return result;
  }

  /**
   * Archive (soft-supersede) an entity: marks it superseded_by a new entity.
   * Does NOT hard-delete. Returns true if relation was created.
   */
  supersede(
    projectId: string,
    oldEntityId: number,
    newEntityId: number,
    sourceMessageId?: number,
  ): boolean {
    const params: Parameters<typeof this.relations.upsert>[0] = {
      project_id: projectId,
      from_entity_id: newEntityId,
      to_entity_id: oldEntityId,
      relation_type: 'supersedes',
      confidence: 1.0,
      metadata_json: JSON.stringify({ superseded_at: new Date().toISOString() }),
    };
    if (sourceMessageId !== undefined) params.source_message_id = sourceMessageId;
    this.relations.upsert(params);
    return true;
  }

  /**
   * Read all active (non-superseded) entities of a given type.
   */
  readActive(projectId: string, entityType: string): Entity[] {
    const all = this.entities.listByType(projectId, entityType);

    // Filter out superseded entities
    const supersededIds = new Set<number>();
    for (const entity of all) {
      const rels = this.relations.getToEntity(projectId, entity.id, 'supersedes');
      if (rels.length > 0) {
        supersededIds.add(entity.id);
      }
    }

    return all.filter((e) => !supersededIds.has(e.id));
  }

  /**
   * Read all entities for a project, including superseded ones.
   */
  readAll(projectId: string): Entity[] {
    return this.db
      .prepare('SELECT * FROM entities WHERE project_id = ? ORDER BY last_seen_at DESC')
      .all(projectId) as Entity[];
  }

  /**
   * Read all quarantined entities (contradictions pending review).
   */
  readQuarantined(projectId: string): Entity[] {
    return this.entities.listByType(projectId, 'quarantine');
  }

  /**
   * Get entities related to a specific entity (1-hop expansion).
   */
  expand(projectId: string, entityId: number): { entity: Entity; relation: Relation }[] {
    const outRels = this.relations.getFromEntity(projectId, entityId);
    const inRels = this.relations.getToEntity(projectId, entityId);
    const results: { entity: Entity; relation: Relation }[] = [];

    for (const rel of outRels) {
      const entity = this.entities.getById(rel.to_entity_id);
      if (entity) results.push({ entity, relation: rel });
    }
    for (const rel of inRels) {
      const entity = this.entities.getById(rel.from_entity_id);
      if (entity) results.push({ entity, relation: rel });
    }

    return results;
  }

  // ── Internal application helpers ─────────────────────────────────

  private applyKeep(
    projectId: string,
    item: CuratedItem,
    sourceMessageId?: number,
  ): Entity {
    const metadata = {
      signal: item.signal,
      decision: item.decision,
      sourceTaskId: item.sourceTaskId,
      sourceAgentId: item.sourceAgentId,
      curatedAt: new Date().toISOString(),
    };

    // Check for existing entity to potentially supersede
    const existing = this.entities.getByCanonicalKey(projectId, item.canonicalKey);

    const params: Parameters<typeof this.entities.upsert>[0] = {
      project_id: projectId,
      entity_type: item.entityType,
      canonical_key: item.canonicalKey,
      display_name: item.displayName,
      summary: item.summary,
      metadata_json: JSON.stringify(metadata),
      confidence: item.signal.confidence,
    };
    if (sourceMessageId !== undefined) params.source_message_id = sourceMessageId;

    const entity = this.entities.upsert(params);

    // If there was an existing entity with different summary, create supersedes relation
    if (existing && existing.summary !== item.summary && existing.id !== entity.id) {
      this.supersede(projectId, existing.id, entity.id, sourceMessageId);
    }

    return entity;
  }

  private applySummarize(
    projectId: string,
    item: CuratedItem,
    sourceMessageId?: number,
  ): Entity {
    const metadata = {
      signal: item.signal,
      decision: item.decision,
      sourceTaskId: item.sourceTaskId,
      sourceAgentId: item.sourceAgentId,
      curatedAt: new Date().toISOString(),
      summarized: true,
    };

    const params: Parameters<typeof this.entities.upsert>[0] = {
      project_id: projectId,
      entity_type: item.entityType,
      canonical_key: item.canonicalKey,
      display_name: item.displayName,
      summary: `[summarized] ${item.summary}`,
      metadata_json: JSON.stringify(metadata),
      confidence: item.signal.confidence * 0.9, // Slight confidence reduction for summaries
    };
    if (sourceMessageId !== undefined) params.source_message_id = sourceMessageId;

    return this.entities.upsert(params);
  }

  private applyQuarantine(
    projectId: string,
    item: CuratedItem,
    sourceMessageId?: number,
  ): Entity {
    const metadata = {
      signal: item.signal,
      decision: item.decision,
      sourceTaskId: item.sourceTaskId,
      sourceAgentId: item.sourceAgentId,
      curatedAt: new Date().toISOString(),
      quarantineReason: 'high-impact contradiction',
      originalEntityType: item.entityType,
    };

    // Quarantined items get a special entity_type for easy filtering
    const params: Parameters<typeof this.entities.upsert>[0] = {
      project_id: projectId,
      entity_type: 'quarantine',
      canonical_key: `quarantine:${item.canonicalKey}`,
      display_name: `[QUARANTINE] ${item.displayName}`,
      summary: item.summary,
      metadata_json: JSON.stringify(metadata),
      confidence: item.signal.confidence,
    };
    if (sourceMessageId !== undefined) params.source_message_id = sourceMessageId;

    return this.entities.upsert(params);
  }
}
