// Memory & Learning — Instinct promotion to project-level knowledge
//
// Controlled pipeline that promotes mature instincts into durable
// project knowledge (entities/relations). Promotion is gated,
// auditable, and reversible.

import type Database from 'better-sqlite3';
import { InstinctRepository } from '../db/repositories/instincts.js';
import { EntityRepository } from '../db/repositories/entities.js';
import { RelationRepository } from '../db/repositories/relations.js';
import type { Instinct, Entity } from '../types/index.js';
import type { PromotionConfig } from './config.js';
import { DEFAULT_MEMORY_CONFIG } from './config.js';

// ── Promotion result ────────────────────────────────────────────────

export interface PromotionResult {
  instinctId: number;
  promoted: boolean;
  reason: string;
  entityId?: number;
  relationId?: number;
}

// ── PromotionPipeline class ─────────────────────────────────────────

export class PromotionPipeline {
  private readonly db: Database.Database;
  private readonly instinctRepo: InstinctRepository;
  private readonly entityRepo: EntityRepository;
  private readonly relationRepo: RelationRepository;
  private readonly config: PromotionConfig;

  constructor(db: Database.Database, config?: Partial<PromotionConfig>) {
    this.db = db;
    this.instinctRepo = new InstinctRepository(db);
    this.entityRepo = new EntityRepository(db);
    this.relationRepo = new RelationRepository(db);
    this.config = { ...DEFAULT_MEMORY_CONFIG.promotion, ...config };
  }

  /** Check if an instinct is eligible for promotion. */
  isEligible(instinct: Instinct): { eligible: boolean; reason: string } {
    if (instinct.state === 'promoted') {
      return { eligible: false, reason: 'Already promoted' };
    }
    if (instinct.state === 'deprecated') {
      return { eligible: false, reason: 'Instinct is deprecated' };
    }
    if (instinct.confidence < this.config.minConfidence) {
      return {
        eligible: false,
        reason: `Confidence ${instinct.confidence.toFixed(2)} < ${this.config.minConfidence}`,
      };
    }

    // Parse metadata for session count
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(instinct.metadata_json);
    } catch { /* use defaults */ }

    const supportSessions = (meta.support_sessions as number) ?? 0;
    if (supportSessions < this.config.minSupportingSessions) {
      return {
        eligible: false,
        reason: `Supporting sessions ${supportSessions} < ${this.config.minSupportingSessions}`,
      };
    }
    if (instinct.evidence_count < this.config.minSupportingObservations) {
      return {
        eligible: false,
        reason: `Evidence count ${instinct.evidence_count} < ${this.config.minSupportingObservations}`,
      };
    }

    // Check for recent severe contradictions
    const contradictionRatio =
      instinct.contradiction_count / (instinct.evidence_count + instinct.contradiction_count || 1);
    if (contradictionRatio > 0.20) {
      return {
        eligible: false,
        reason: `Too many contradictions (ratio: ${contradictionRatio.toFixed(2)})`,
      };
    }

    return { eligible: true, reason: 'All gates passed' };
  }

  /** Promote a single instinct to project knowledge. */
  promote(instinct: Instinct): PromotionResult {
    const check = this.isEligible(instinct);
    if (!check.eligible) {
      return { instinctId: instinct.id, promoted: false, reason: check.reason };
    }

    if (this.config.requireHumanApproval) {
      return {
        instinctId: instinct.id,
        promoted: false,
        reason: 'Awaiting human approval',
      };
    }

    // Perform promotion in a transaction
    const result = this.db.transaction(() => {
      // Create entity from instinct
      const entity = this.entityRepo.upsert({
        project_id: instinct.project_id,
        entity_type: 'pattern',
        canonical_key: `instinct:${instinct.id}:${instinct.title.toLowerCase().replace(/\s+/g, '_')}`,
        display_name: instinct.title,
        summary: instinct.instinct_text,
        confidence: instinct.confidence,
        metadata_json: JSON.stringify({
          source: 'instinct_promotion',
          instinct_id: instinct.id,
          evidence_count: instinct.evidence_count,
          contradiction_count: instinct.contradiction_count,
          promoted_at: new Date().toISOString(),
        }),
      });

      // Create relation: entity derived_from instinct source observation
      let relationId: number | undefined;
      if (instinct.source_observation_id) {
        // Create a placeholder entity for the observation source
        const sourceEntity = this.entityRepo.upsert({
          project_id: instinct.project_id,
          entity_type: 'observation_source',
          canonical_key: `observation:${instinct.source_observation_id}`,
          display_name: `Observation #${instinct.source_observation_id}`,
          confidence: 0.9,
        });

        const relation = this.relationRepo.upsert({
          project_id: instinct.project_id,
          from_entity_id: entity.id,
          to_entity_id: sourceEntity.id,
          relation_type: 'derived_from',
          confidence: instinct.confidence,
          metadata_json: JSON.stringify({
            instinct_id: instinct.id,
            promoted_at: new Date().toISOString(),
          }),
        });
        relationId = relation.id;
      }

      // Mark instinct as promoted
      this.instinctRepo.update({
        id: instinct.id,
        state: 'promoted',
      });

      return { entityId: entity.id, relationId };
    })();

    const promotionResult: PromotionResult = {
      instinctId: instinct.id,
      promoted: true,
      reason: 'Promoted to project knowledge',
      entityId: result.entityId,
    };
    if (result.relationId !== undefined) promotionResult.relationId = result.relationId;
    return promotionResult;
  }

  /**
   * Scan and promote all eligible instincts for a project.
   * Returns list of promotion results.
   */
  promoteEligible(projectId: string): PromotionResult[] {
    const active = this.instinctRepo.listActive(projectId);
    const candidates = this.instinctRepo.listByState(projectId, 'candidate');
    const all = [...active, ...candidates];

    return all.map((inst) => this.promote(inst));
  }

  /**
   * Demote a previously promoted instinct (reversibility).
   * Removes the entity and reverts instinct state to 'active'.
   */
  demote(instinctId: number): boolean {
    const instinct = this.instinctRepo.getById(instinctId);
    if (!instinct || instinct.state !== 'promoted') return false;

    this.db.transaction(() => {
      // Find and remove the promoted entity
      const canonicalKey = `instinct:${instinct.id}:${instinct.title.toLowerCase().replace(/\s+/g, '_')}`;
      const entity = this.entityRepo.getByCanonicalKey(instinct.project_id, canonicalKey);
      if (entity) {
        this.entityRepo.delete(entity.id);
      }

      // Revert instinct state
      this.instinctRepo.update({
        id: instinctId,
        state: 'active',
      });
    })();

    return true;
  }
}
