// Memory & Learning — Instinct lifecycle management
//
// Handles instinct generation, confidence scoring, reinforcement,
// contradiction penalties, time decay, and state transitions.
// All confidence values are bounded to [confidenceMin, confidenceMax].

import type Database from 'better-sqlite3';
import { InstinctRepository } from '../db/repositories/instincts.js';
import type { Instinct } from '../types/index.js';
import type { InstinctConfig } from './config.js';
import { DEFAULT_MEMORY_CONFIG } from './config.js';
import type { InstinctCandidate } from './analyzer.js';

// ── Confidence math ──────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute initial confidence for a new instinct candidate.
 * Bounded formula: base + log-scaled support + consistency + session diversity.
 */
export function computeInitialConfidence(
  candidate: InstinctCandidate,
  config: InstinctConfig,
): number {
  const base = config.confidenceMin; // 0.30
  const supportBoost = Math.min(0.25, Math.log2(candidate.supportCount + 1) * 0.06);
  const consistencyBoost = candidate.consistencyRatio * 0.20;
  const sessionBoost = Math.min(0.10, candidate.supportSessions * 0.02);
  return clamp(
    base + supportBoost + consistencyBoost + sessionBoost,
    config.confidenceMin,
    config.confidenceMax,
  );
}

/**
 * Apply time decay to raw confidence.
 * Half-life exponential: effective = raw * 0.5^(ageDays / halfLife).
 */
export function applyDecay(
  rawConfidence: number,
  ageDays: number,
  halfLifeDays: number,
): number {
  if (ageDays <= 0) return rawConfidence;
  const decayFactor = Math.pow(0.5, ageDays / halfLifeDays);
  return rawConfidence * decayFactor;
}

// ── Instinct event types ────────────────────────────────────────────

export interface InstinctEvent {
  instinctId: number;
  eventType: 'created' | 'reinforced' | 'contradicted' | 'decayed' | 'deactivated' | 'reactivated';
  confidenceBefore: number;
  confidenceAfter: number;
  reason: string;
  timestamp: string;
}

// ── InstinctManager class ──────────────────────────────────────────

export class InstinctManager {
  private readonly repo: InstinctRepository;
  private readonly db: Database.Database;
  private readonly config: InstinctConfig;
  private readonly events: InstinctEvent[] = [];

  constructor(db: Database.Database, config?: Partial<InstinctConfig>) {
    this.db = db;
    this.repo = new InstinctRepository(db);
    this.config = { ...DEFAULT_MEMORY_CONFIG.instinct, ...config };
  }

  /**
   * Upsert instinct from candidate. Merges with existing if duplicate title.
   * Returns the created or updated instinct.
   */
  upsertFromCandidate(
    projectId: string,
    candidate: InstinctCandidate,
  ): Instinct {
    const confidence = computeInitialConfidence(candidate, this.config);

    // Check for existing instinct with same title (dedup)
    const existing = this.db
      .prepare(
        `SELECT * FROM instincts WHERE project_id = ? AND title = ?`,
      )
      .get(projectId, candidate.title) as Instinct | undefined;

    if (existing) {
      // Merge: reinforce existing instinct
      const newConfidence = clamp(
        existing.confidence + this.config.reinforceDelta,
        this.config.confidenceMin,
        this.config.confidenceMax,
      );

      this.repo.update({
        id: existing.id,
        confidence: newConfidence,
        evidence_count: existing.evidence_count + candidate.supportCount,
        instinct_text: candidate.instinctText,
      });

      this.recordEvent({
        instinctId: existing.id,
        eventType: 'reinforced',
        confidenceBefore: existing.confidence,
        confidenceAfter: newConfidence,
        reason: `Merged with new candidate (support: ${candidate.supportCount})`,
        timestamp: new Date().toISOString(),
      });

      return this.repo.getById(existing.id)!;
    }

    // Create new instinct
    const instinct = this.repo.create({
      project_id: projectId,
      title: candidate.title,
      instinct_text: candidate.instinctText,
      confidence,
      state: 'candidate',
      metadata_json: JSON.stringify({
        domain: candidate.domain,
        support_sessions: candidate.supportSessions,
        consistency_ratio: candidate.consistencyRatio,
      }),
    });

    this.recordEvent({
      instinctId: instinct.id,
      eventType: 'created',
      confidenceBefore: 0,
      confidenceAfter: confidence,
      reason: `New candidate from analysis (support: ${candidate.supportCount})`,
      timestamp: new Date().toISOString(),
    });

    return instinct;
  }

  /** Reinforce an instinct when evidence supports it. */
  reinforce(instinctId: number, reason: string): Instinct | null {
    const instinct = this.repo.getById(instinctId);
    if (!instinct) return null;

    const newConfidence = clamp(
      instinct.confidence + this.config.reinforceDelta,
      this.config.confidenceMin,
      this.config.confidenceMax,
    );

    this.repo.update({
      id: instinctId,
      confidence: newConfidence,
      evidence_count: instinct.evidence_count + 1,
    });

    this.recordEvent({
      instinctId,
      eventType: 'reinforced',
      confidenceBefore: instinct.confidence,
      confidenceAfter: newConfidence,
      reason,
      timestamp: new Date().toISOString(),
    });

    // Activate candidate if confidence reaches threshold
    if (instinct.state === 'candidate' && newConfidence >= 0.50) {
      this.repo.update({ id: instinctId, state: 'active' });
    }

    return this.repo.getById(instinctId)!;
  }

  /** Contradict an instinct when evidence opposes it. */
  contradict(instinctId: number, reason: string): Instinct | null {
    const instinct = this.repo.getById(instinctId);
    if (!instinct) return null;

    const newConfidence = clamp(
      instinct.confidence - this.config.contradictionDelta,
      0, // allow going below min for deactivation check
      this.config.confidenceMax,
    );

    this.repo.update({
      id: instinctId,
      confidence: Math.max(newConfidence, this.config.confidenceMin),
      contradiction_count: instinct.contradiction_count + 1,
    });

    this.recordEvent({
      instinctId,
      eventType: 'contradicted',
      confidenceBefore: instinct.confidence,
      confidenceAfter: newConfidence,
      reason,
      timestamp: new Date().toISOString(),
    });

    // Deactivate if below threshold
    if (newConfidence < this.config.deleteBelow) {
      this.repo.update({ id: instinctId, state: 'deprecated' });
      this.recordEvent({
        instinctId,
        eventType: 'deactivated',
        confidenceBefore: instinct.confidence,
        confidenceAfter: newConfidence,
        reason: `Confidence below deleteBelow threshold (${this.config.deleteBelow})`,
        timestamp: new Date().toISOString(),
      });
    }

    return this.repo.getById(instinctId)!;
  }

  /**
   * Apply time decay to all active/candidate instincts in a project.
   * Returns the list of instincts that were deactivated.
   */
  applyDecayAll(projectId: string): Instinct[] {
    const instincts = this.db
      .prepare(
        `SELECT * FROM instincts
         WHERE project_id = ? AND state IN ('active', 'candidate')`,
      )
      .all(projectId) as Instinct[];

    const deactivated: Instinct[] = [];
    const now = Date.now();

    for (const inst of instincts) {
      const lastValidated = inst.last_validated_at
        ? new Date(inst.last_validated_at).getTime()
        : new Date(inst.created_at).getTime();
      const ageDays = (now - lastValidated) / (1000 * 60 * 60 * 24);

      const effectiveConfidence = applyDecay(
        inst.confidence,
        ageDays,
        this.config.decayHalfLifeDays,
      );

      if (effectiveConfidence < this.config.deleteBelow) {
        this.repo.update({ id: inst.id, state: 'deprecated' });
        deactivated.push(inst);
        this.recordEvent({
          instinctId: inst.id,
          eventType: 'deactivated',
          confidenceBefore: inst.confidence,
          confidenceAfter: effectiveConfidence,
          reason: `Time decay below threshold (age: ${Math.round(ageDays)}d)`,
          timestamp: new Date().toISOString(),
        });
      } else if (effectiveConfidence < inst.confidence) {
        // Record decay event but keep active
        this.repo.update({
          id: inst.id,
          confidence: clamp(effectiveConfidence, this.config.confidenceMin, this.config.confidenceMax),
        });
        this.recordEvent({
          instinctId: inst.id,
          eventType: 'decayed',
          confidenceBefore: inst.confidence,
          confidenceAfter: effectiveConfidence,
          reason: `Time decay (age: ${Math.round(ageDays)}d)`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return deactivated;
  }

  /** Get active instincts for runtime injection. */
  getActiveInstincts(projectId: string): Instinct[] {
    return this.repo.listActive(projectId);
  }

  /** Get all recorded events (audit trail). */
  getEvents(): InstinctEvent[] {
    return [...this.events];
  }

  /** Clear events (e.g. after persisting to audit log). */
  clearEvents(): void {
    this.events.length = 0;
  }

  private recordEvent(event: InstinctEvent): void {
    this.events.push(event);
  }
}
