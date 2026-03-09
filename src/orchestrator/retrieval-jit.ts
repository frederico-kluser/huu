// Retrieval Just-In-Time — load relevant context per agent
//
// Builds a focused context pack for each agent based on:
// - Agent role
// - Current task and its dependencies
// - Current beat sheet checkpoint
// - Token budget per role
//
// Invariants:
// 1. Each agent receives different context based on role+task
// 2. No full scratchpad dump — only high-signal subsets
// 3. Respects per-role token budgets
// 4. Works with SQLite only (no external vector DB required)

import type Database from 'better-sqlite3';
import { Scratchpad } from './scratchpad.js';
import type { Entity, Relation } from '../types/index.js';
import type { AtomicTask, BeatSheet } from './beatsheet.js';
import { collectTasks } from './beatsheet.js';
import { getCurrentCheckpoint } from './checkpoints.js';
import { estimateTokens } from '../agents/context.js';
import { CompactSnapshotStore } from './strategic-compact.js';
import type { CompactSnapshot } from './strategic-compact.js';

// ── Types ───────────────────────────────────────────────────────────

export interface ContextPack {
  objective: string;
  currentBeat: string;
  decisions: ContextItem[];
  risks: ContextItem[];
  fileFacts: ContextItem[];
  openQuestions: ContextItem[];
  references: ContextReference[];
  tokenEstimate: number;
}

export interface ContextItem {
  key: string;
  summary: string;
  confidence: number;
  source: string;
}

export interface ContextReference {
  kind: 'file' | 'url' | 'query' | 'snapshot';
  pointer: string;
}

export interface RetrievalQuery {
  projectId: string;
  task: AtomicTask;
  agentRole: string;
  sheet: BeatSheet;
  tokenBudget?: number;
}

/** Token budgets per agent role. */
export const ROLE_TOKEN_BUDGETS: Record<string, number> = {
  implementation: 8000,
  planning: 12000,
  testing: 6000,
  review: 10000,
  research: 15000,
  refactoring: 6000,
  debugging: 10000,
  documentation: 8000,
  merging: 4000,
  curation: 4000,
};

const DEFAULT_TOKEN_BUDGET = 8000;

// ── Retrieval pipeline ──────────────────────────────────────────────

/**
 * Build a context pack for an agent about to execute a task.
 * Pipeline:
 * 1. Build query from task, dependencies, and checkpoint
 * 2. Fetch candidate entities from scratchpad
 * 3. Expand 1-hop by relations
 * 4. Rank by relevance, confidence, recency
 * 5. Cut by token budget
 * 6. Format as structured context pack
 */
export function buildContextPack(
  db: Database.Database,
  query: RetrievalQuery,
): ContextPack {
  const scratchpad = new Scratchpad(db);
  const snapshotStore = new CompactSnapshotStore(db);
  const budget = query.tokenBudget ?? ROLE_TOKEN_BUDGETS[query.agentRole] ?? DEFAULT_TOKEN_BUDGET;

  const checkpoint = getCurrentCheckpoint(query.sheet.checkpoints) ?? 'catalyst';

  // 1. Fetch all active entities
  const allEntities = scratchpad.readAll(query.projectId);

  // 2. Score candidates by relevance to this task
  const scored = scoreEntities(allEntities, query);

  // 3. Expand 1-hop for top candidates
  const topIds = scored
    .filter((s) => s.score > 0.3)
    .slice(0, 20)
    .map((s) => s.entity.id);

  const expanded = new Map<number, Entity>();
  for (const entity of allEntities) {
    expanded.set(entity.id, entity);
  }
  for (const entityId of topIds) {
    const neighbors = scratchpad.expand(query.projectId, entityId);
    for (const { entity } of neighbors) {
      if (!expanded.has(entity.id)) {
        expanded.set(entity.id, entity);
      }
    }
  }

  // 4. Re-score with expanded set
  const allCandidates = [...expanded.values()];
  const finalScored = scoreEntities(allCandidates, query);

  // 5. Cut by budget
  const { items, tokenEstimate } = cutByBudget(finalScored, budget);

  // 6. Format
  const decisions: ContextItem[] = [];
  const risks: ContextItem[] = [];
  const fileFacts: ContextItem[] = [];
  const openQuestions: ContextItem[] = [];
  const references: ContextReference[] = [];

  for (const item of items) {
    const ci: ContextItem = {
      key: item.entity.canonical_key,
      summary: item.entity.summary ?? item.entity.display_name,
      confidence: item.entity.confidence,
      source: item.entity.entity_type,
    };

    switch (item.entity.entity_type) {
      case 'task_outcome':
      case 'commit_ref':
        decisions.push(ci);
        break;
      case 'quarantine':
        risks.push(ci);
        openQuestions.push(ci);
        break;
      case 'file_change':
        fileFacts.push(ci);
        references.push({ kind: 'file', pointer: item.entity.canonical_key.replace('file:', '') });
        break;
      default:
        if (item.entity.confidence >= 0.7) {
          decisions.push(ci);
        } else {
          openQuestions.push(ci);
        }
    }
  }

  // Add latest compact snapshot as reference
  const latestSnapshot = snapshotStore.getByCheckpoint(query.projectId, checkpoint);
  if (latestSnapshot) {
    references.push({
      kind: 'snapshot',
      pointer: latestSnapshot.id,
    });

    // Include snapshot decisions and risks in context pack
    for (const decision of latestSnapshot.summary.decisions.slice(0, 5)) {
      decisions.push({
        key: `snapshot:${latestSnapshot.id}`,
        summary: decision,
        confidence: 0.8,
        source: 'compact_snapshot',
      });
    }
    for (const risk of latestSnapshot.summary.risks.slice(0, 3)) {
      risks.push({
        key: `snapshot:${latestSnapshot.id}`,
        summary: risk,
        confidence: 0.8,
        source: 'compact_snapshot',
      });
    }
  }

  return {
    objective: query.sheet.objective,
    currentBeat: checkpoint,
    decisions,
    risks,
    fileFacts,
    openQuestions,
    references,
    tokenEstimate,
  };
}

/**
 * Serialize a context pack into a string for injection into agent prompts.
 */
export function renderContextPack(pack: ContextPack): string {
  const sections: string[] = [];

  sections.push(`## Objective\n${pack.objective}`);
  sections.push(`## Current Beat\n${pack.currentBeat}`);

  if (pack.decisions.length > 0) {
    sections.push(
      `## Decisions & Facts\n${pack.decisions.map((d) => `- [${d.confidence.toFixed(1)}] ${d.summary}`).join('\n')}`,
    );
  }

  if (pack.risks.length > 0) {
    sections.push(
      `## Risks & Blockers\n${pack.risks.map((r) => `- ${r.summary}`).join('\n')}`,
    );
  }

  if (pack.fileFacts.length > 0) {
    sections.push(
      `## File Changes\n${pack.fileFacts.map((f) => `- ${f.summary}`).join('\n')}`,
    );
  }

  if (pack.openQuestions.length > 0) {
    sections.push(
      `## Open Questions\n${pack.openQuestions.map((q) => `- ${q.summary}`).join('\n')}`,
    );
  }

  if (pack.references.length > 0) {
    sections.push(
      `## References\n${pack.references.map((r) => `- [${r.kind}] ${r.pointer}`).join('\n')}`,
    );
  }

  return sections.join('\n\n');
}

// ── Scoring & ranking ──────────────────────────────────────────────

interface ScoredEntity {
  entity: Entity;
  score: number;
}

/**
 * Score entities by relevance to the current task and agent role.
 */
function scoreEntities(
  entities: Entity[],
  query: RetrievalQuery,
): ScoredEntity[] {
  const taskKeywords = extractKeywords(query.task);
  const now = Date.now();

  const scored = entities.map((entity) => {
    let score = 0;

    // Confidence (0-0.3)
    score += entity.confidence * 0.3;

    // Keyword overlap (0-0.3)
    const entityText = `${entity.display_name} ${entity.summary ?? ''} ${entity.canonical_key}`.toLowerCase();
    const overlap = taskKeywords.filter((kw) => entityText.includes(kw)).length;
    const maxOverlap = Math.max(taskKeywords.length, 1);
    score += (overlap / maxOverlap) * 0.3;

    // Recency (0-0.2): more recent = higher score
    const lastSeen = new Date(entity.last_seen_at).getTime();
    const ageHours = (now - lastSeen) / (1000 * 60 * 60);
    const recencyScore = Math.max(0, 1 - ageHours / 168); // Decay over 7 days
    score += recencyScore * 0.2;

    // Type relevance (0-0.2): certain types more valuable per role
    const typeBonus = getTypeBonus(entity.entity_type, query.agentRole);
    score += typeBonus * 0.2;

    return { entity, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Extract relevant keywords from a task for matching against entities.
 */
function extractKeywords(task: AtomicTask): string[] {
  const text = `${task.title} ${task.action} ${task.precondition} ${task.postcondition}`.toLowerCase();
  // Split on non-alphanumeric, filter short words
  return text
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3)
    .filter((w, i, arr) => arr.indexOf(w) === i); // Deduplicate
}

/**
 * Type-role affinity bonuses.
 */
function getTypeBonus(entityType: string, agentRole: string): number {
  const affinities: Record<string, string[]> = {
    implementation: ['file_change', 'task_outcome', 'commit_ref'],
    testing: ['file_change', 'task_outcome'],
    review: ['task_outcome', 'commit_ref', 'quarantine'],
    debugging: ['file_change', 'quarantine', 'task_outcome'],
    planning: ['task_outcome', 'execution_metric'],
    research: ['task_outcome', 'quarantine'],
    documentation: ['task_outcome', 'commit_ref'],
    refactoring: ['file_change', 'task_outcome'],
    merging: ['file_change', 'commit_ref'],
    curation: ['task_outcome', 'quarantine'],
  };

  const roleAffinities = affinities[agentRole] ?? [];
  return roleAffinities.includes(entityType) ? 1.0 : 0.3;
}

/**
 * Cut scored entities to fit within token budget.
 */
function cutByBudget(
  scored: ScoredEntity[],
  budget: number,
): { items: ScoredEntity[]; tokenEstimate: number } {
  const items: ScoredEntity[] = [];
  let totalTokens = 0;

  for (const entry of scored) {
    const text = `${entry.entity.display_name}: ${entry.entity.summary ?? ''}`;
    const tokens = estimateTokens(text);

    if (totalTokens + tokens > budget) break;

    items.push(entry);
    totalTokens += tokens;
  }

  return { items, tokenEstimate: totalTokens };
}
