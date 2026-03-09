// Strategic Compact — compaction at beat sheet checkpoints
//
// Performs deliberate memory compaction at narrative checkpoints
// (Catalyst, Midpoint, All Is Lost, Break Into Three, Final Image).
// Each checkpoint has a specific focus and mandatory output.
//
// Invariants:
// 1. Only triggers at checkpoint transitions (not every turn)
// 2. Never hard-deletes — archives with traceability
// 3. Preserves architectural decisions, open risks, and next actions
// 4. Emergency fallback for window pressure (flagged separately)

import type Database from 'better-sqlite3';
import type { CheckpointName } from './checkpoints.js';
import type { BeatSheet } from './beatsheet.js';
import { collectTasks } from './beatsheet.js';
import { Scratchpad } from './scratchpad.js';
import type { Entity } from '../types/index.js';

// ── Types ───────────────────────────────────────────────────────────

export type CompactTrigger = 'checkpoint' | 'window_pressure';

export interface CompactSnapshot {
  id: string;
  projectId: string;
  checkpoint: CheckpointName;
  trigger: CompactTrigger;
  timestamp: string;
  summary: CompactSummary;
  archivedEntityIds: number[];
  retainedEntityIds: number[];
}

export interface CompactSummary {
  objective: string;
  currentBeat: string;
  decisions: string[];
  blockers: string[];
  openTasks: string[];
  evidence: string[];
  nextActions: string[];
  risks: string[];
  lessonsLearned: string[];
}

/** Focus matrix: what each checkpoint prioritizes during compaction. */
export const CHECKPOINT_FOCUS: Record<CheckpointName, {
  focus: string;
  mandatoryOutputs: string[];
}> = {
  catalyst: {
    focus: 'Clarify objective and constraints',
    mandatoryOutputs: ['objective', 'risks'],
  },
  midpoint: {
    focus: 'Replan based on progress',
    mandatoryOutputs: ['decisions', 'openTasks'],
  },
  allIsLost: {
    focus: 'Surface the biggest risk',
    mandatoryOutputs: ['risks', 'blockers'],
  },
  breakIntoThree: {
    focus: 'Consolidate new strategy',
    mandatoryOutputs: ['decisions', 'nextActions'],
  },
  finalImage: {
    focus: 'Prepare handoff',
    mandatoryOutputs: ['decisions', 'lessonsLearned', 'openTasks'],
  },
};

// ── Snapshot store ──────────────────────────────────────────────────

export class CompactSnapshotStore {
  constructor(private readonly db: Database.Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compact_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        checkpoint TEXT NOT NULL,
        trigger_type TEXT NOT NULL DEFAULT 'checkpoint',
        summary_json TEXT NOT NULL,
        archived_entity_ids TEXT NOT NULL DEFAULT '[]',
        retained_entity_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `);
  }

  save(snapshot: CompactSnapshot): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO compact_snapshots
         (id, project_id, checkpoint, trigger_type, summary_json, archived_entity_ids, retained_entity_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.projectId,
        snapshot.checkpoint,
        snapshot.trigger,
        JSON.stringify(snapshot.summary),
        JSON.stringify(snapshot.archivedEntityIds),
        JSON.stringify(snapshot.retainedEntityIds),
      );
  }

  getByCheckpoint(projectId: string, checkpoint: CheckpointName): CompactSnapshot | null {
    const row = this.db
      .prepare(
        'SELECT * FROM compact_snapshots WHERE project_id = ? AND checkpoint = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(projectId, checkpoint) as {
        id: string;
        project_id: string;
        checkpoint: string;
        trigger_type: string;
        summary_json: string;
        archived_entity_ids: string;
        retained_entity_ids: string;
        created_at: string;
      } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      projectId: row.project_id,
      checkpoint: row.checkpoint as CheckpointName,
      trigger: row.trigger_type as CompactTrigger,
      timestamp: row.created_at,
      summary: JSON.parse(row.summary_json) as CompactSummary,
      archivedEntityIds: JSON.parse(row.archived_entity_ids) as number[],
      retainedEntityIds: JSON.parse(row.retained_entity_ids) as number[],
    };
  }

  listByProject(projectId: string): CompactSnapshot[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM compact_snapshots WHERE project_id = ? ORDER BY created_at ASC',
      )
      .all(projectId) as Array<{
        id: string;
        project_id: string;
        checkpoint: string;
        trigger_type: string;
        summary_json: string;
        archived_entity_ids: string;
        retained_entity_ids: string;
        created_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      checkpoint: row.checkpoint as CheckpointName,
      trigger: row.trigger_type as CompactTrigger,
      timestamp: row.created_at,
      summary: JSON.parse(row.summary_json) as CompactSummary,
      archivedEntityIds: JSON.parse(row.archived_entity_ids) as number[],
      retainedEntityIds: JSON.parse(row.retained_entity_ids) as number[],
    }));
  }
}

// ── Compaction logic ────────────────────────────────────────────────

/**
 * Build a compact summary from the current scratchpad state and beat sheet.
 */
export function buildCompactSummary(
  entities: Entity[],
  sheet: BeatSheet,
  checkpoint: CheckpointName,
): CompactSummary {
  const tasks = collectTasks(sheet);
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'ready');
  const failedTasks = tasks.filter((t) => t.status === 'failed');
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');

  // Categorize entities
  const decisions: string[] = [];
  const risks: string[] = [];
  const evidence: string[] = [];
  const lessons: string[] = [];

  for (const entity of entities) {
    const summary = entity.summary ?? entity.display_name;
    switch (entity.entity_type) {
      case 'task_outcome':
      case 'commit_ref':
        decisions.push(summary);
        break;
      case 'quarantine':
        risks.push(`[QUARANTINE] ${summary}`);
        break;
      case 'file_change':
        evidence.push(summary);
        break;
      case 'execution_metric':
        lessons.push(summary);
        break;
      default:
        if (entity.confidence >= 0.7) {
          decisions.push(summary);
        } else {
          evidence.push(summary);
        }
    }
  }

  return {
    objective: sheet.objective,
    currentBeat: checkpoint,
    decisions: decisions.slice(0, 20), // Cap for compaction
    blockers: [
      ...blockedTasks.map((t) => `Task ${t.id}: ${t.title}`),
      ...failedTasks.map((t) => `[FAILED] Task ${t.id}: ${t.title}`),
    ],
    openTasks: pendingTasks.map((t) => `${t.id}: ${t.title}`).slice(0, 15),
    evidence: evidence.slice(0, 15),
    nextActions: pendingTasks
      .filter((t) => t.dependencies.every((d) => doneTasks.some((dt) => dt.id === d)))
      .map((t) => `${t.id}: ${t.action}`)
      .slice(0, 10),
    risks,
    lessonsLearned: lessons.slice(0, 10),
  };
}

/**
 * Determine which entities should be archived during compaction.
 * Retains high-signal items; archives low-signal ephemeral ones.
 */
export function partitionEntities(
  entities: Entity[],
  checkpoint: CheckpointName,
): { retain: Entity[]; archive: Entity[] } {
  const retain: Entity[] = [];
  const archive: Entity[] = [];

  for (const entity of entities) {
    // Always retain quarantined items
    if (entity.entity_type === 'quarantine') {
      retain.push(entity);
      continue;
    }

    // Retain high-confidence items
    if (entity.confidence >= 0.7) {
      retain.push(entity);
      continue;
    }

    // Retain task outcomes and decisions
    if (entity.entity_type === 'task_outcome' || entity.entity_type === 'commit_ref') {
      retain.push(entity);
      continue;
    }

    // At final image, be more aggressive with archival
    if (checkpoint === 'finalImage' && entity.confidence < 0.5) {
      archive.push(entity);
      continue;
    }

    // Archive execution metrics (ephemeral)
    if (entity.entity_type === 'execution_metric') {
      archive.push(entity);
      continue;
    }

    // Archive low-confidence file changes
    if (entity.entity_type === 'file_change' && entity.confidence < 0.5) {
      archive.push(entity);
      continue;
    }

    // Default: retain
    retain.push(entity);
  }

  return { retain, archive };
}

/**
 * Execute strategic compaction at a beat sheet checkpoint.
 * Creates a versioned snapshot and archives low-signal entities.
 */
export function strategicCompact(
  db: Database.Database,
  projectId: string,
  checkpoint: CheckpointName,
  sheet: BeatSheet,
  trigger: CompactTrigger = 'checkpoint',
): CompactSnapshot {
  const scratchpad = new Scratchpad(db);
  const store = new CompactSnapshotStore(db);

  return db.transaction(() => {
    // 1. Load all active entities
    const allEntities = scratchpad.readAll(projectId);

    // 2. Build compact summary
    const summary = buildCompactSummary(allEntities, sheet, checkpoint);

    // 3. Partition entities
    const { retain, archive } = partitionEntities(allEntities, checkpoint);

    // 4. Create snapshot
    const snapshotId = `compact-${projectId}-${checkpoint}-${Date.now()}`;
    const snapshot: CompactSnapshot = {
      id: snapshotId,
      projectId,
      checkpoint,
      trigger,
      timestamp: new Date().toISOString(),
      summary,
      archivedEntityIds: archive.map((e) => e.id),
      retainedEntityIds: retain.map((e) => e.id),
    };

    // 5. Archive entities (mark as superseded by the snapshot)
    for (const entity of archive) {
      // Create a "compacted" marker entity
      const compactedEntity = db
        .prepare(
          `INSERT INTO entities (
             project_id, entity_type, canonical_key, display_name,
             summary, metadata_json, confidence
           ) VALUES (?, 'compact_archive', ?, ?, ?, ?, 0.3)
           ON CONFLICT(project_id, canonical_key) DO UPDATE SET
             last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           RETURNING *`,
        )
        .get(
          projectId,
          `archive:${snapshotId}:${entity.canonical_key}`,
          `[archived@${checkpoint}] ${entity.display_name}`,
          entity.summary,
          JSON.stringify({ archivedAt: checkpoint, snapshotId, originalType: entity.entity_type }),
          ) as Entity;

      // Mark original as superseded
      if (compactedEntity) {
        scratchpad.supersede(projectId, entity.id, compactedEntity.id);
      }
    }

    // 6. Save snapshot
    store.save(snapshot);

    return snapshot;
  })();
}
