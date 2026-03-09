// Context Curator — post-activity hook for memory curation
//
// Runs after every task_done event to transform raw agent output
// into curated knowledge. Maintains scratchpad coherence via
// deterministic classification and idempotent processing.
//
// Invariants:
// 1. Idempotent: same (taskId, agentId, runId) never processed twice
// 2. Transactional: scratchpad updates are atomic
// 3. Auditable: every decision is logged with justification
// 4. Delta-based: only processes new output, not full history

import type Database from 'better-sqlite3';
import { Scratchpad, classify } from './scratchpad.js';
import type { Signal, CuratedItem, ApplyResult } from './scratchpad.js';
import type { Message } from '../types/index.js';

// ── Types ───────────────────────────────────────────────────────────

export interface TaskDoneEvent {
  taskId: string;
  agentId: string;
  runId: string;
  projectId: string;
  summary?: string;
  commitSha?: string;
  filesChanged?: string[];
  fileChangeSummary?: {
    added?: string[];
    modified?: string[];
    deleted?: string[];
    renamed?: string[];
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalCost?: number;
    turns?: number;
  };
  durationMs?: number;
}

export interface CurationResult {
  key: string;
  applied: ApplyResult;
  items: CuratedItem[];
  skipped: boolean;
  error?: string;
}

// ── Idempotency store ───────────────────────────────────────────────

export class CuratorStore {
  constructor(private readonly db: Database.Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS curator_processed (
        idempotency_key TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        result_json TEXT NOT NULL DEFAULT '{}'
      )
    `);
  }

  alreadyProcessed(key: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM curator_processed WHERE idempotency_key = ?')
      .get(key);
    return row !== undefined;
  }

  markProcessed(key: string, result: ApplyResult): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO curator_processed (idempotency_key, result_json)
         VALUES (?, ?)`,
      )
      .run(key, JSON.stringify(result));
  }
}

// ── Delta builder ───────────────────────────────────────────────────

export interface TaskDelta {
  decisions: DeltaItem[];
  risks: DeltaItem[];
  fileChanges: DeltaItem[];
  learnings: DeltaItem[];
  metrics: DeltaItem[];
}

export interface DeltaItem {
  type: string;
  key: string;
  name: string;
  description: string;
  signal: Signal;
}

/**
 * Build a delta of curated items from a task_done event.
 * Extracts structured knowledge from raw agent output.
 */
export function buildTaskDelta(evt: TaskDoneEvent): TaskDelta {
  const delta: TaskDelta = {
    decisions: [],
    risks: [],
    fileChanges: [],
    learnings: [],
    metrics: [],
  };

  // Extract file changes as knowledge items
  if (evt.fileChangeSummary) {
    const { added, modified, deleted, renamed } = evt.fileChangeSummary;

    for (const file of added ?? []) {
      delta.fileChanges.push({
        type: 'file_change',
        key: `file:${file}`,
        name: file,
        description: `File created by ${evt.agentId} in task ${evt.taskId}`,
        signal: {
          relevance: 0.8,
          durability: 0.9,
          confidence: 1.0,
          actionability: 0.5,
          novelty: 1.0,
          contradiction: false,
          impact: 'medium',
        },
      });
    }

    for (const file of modified ?? []) {
      delta.fileChanges.push({
        type: 'file_change',
        key: `file:${file}`,
        name: file,
        description: `File modified by ${evt.agentId} in task ${evt.taskId}`,
        signal: {
          relevance: 0.7,
          durability: 0.8,
          confidence: 1.0,
          actionability: 0.4,
          novelty: 0.5,
          contradiction: false,
          impact: 'medium',
        },
      });
    }

    for (const file of deleted ?? []) {
      delta.fileChanges.push({
        type: 'file_change',
        key: `file:${file}`,
        name: file,
        description: `File deleted by ${evt.agentId} in task ${evt.taskId}`,
        signal: {
          relevance: 0.7,
          durability: 0.9,
          confidence: 1.0,
          actionability: 0.3,
          novelty: 0.8,
          contradiction: false,
          impact: 'medium',
        },
      });
    }

    for (const file of renamed ?? []) {
      delta.fileChanges.push({
        type: 'file_change',
        key: `file:${file}`,
        name: file,
        description: `File renamed by ${evt.agentId} in task ${evt.taskId}`,
        signal: {
          relevance: 0.6,
          durability: 0.8,
          confidence: 1.0,
          actionability: 0.3,
          novelty: 0.6,
          contradiction: false,
          impact: 'low',
        },
      });
    }
  }

  // Extract task completion as a decision/learning
  if (evt.summary) {
    delta.decisions.push({
      type: 'task_outcome',
      key: `task_outcome:${evt.taskId}`,
      name: `Task ${evt.taskId} completed`,
      description: evt.summary,
      signal: {
        relevance: 0.9,
        durability: 0.8,
        confidence: 0.9,
        actionability: 0.7,
        novelty: 0.9,
        contradiction: false,
        impact: 'high',
      },
    });
  }

  // Extract commit reference
  if (evt.commitSha) {
    delta.decisions.push({
      type: 'commit_ref',
      key: `commit:${evt.commitSha}`,
      name: `Commit ${evt.commitSha.slice(0, 8)}`,
      description: `Commit by ${evt.agentId} for task ${evt.taskId}: ${evt.summary ?? 'no summary'}`,
      signal: {
        relevance: 0.6,
        durability: 1.0,
        confidence: 1.0,
        actionability: 0.3,
        novelty: 0.8,
        contradiction: false,
        impact: 'medium',
      },
    });
  }

  // Extract execution metrics
  if (evt.usage) {
    delta.metrics.push({
      type: 'execution_metric',
      key: `metric:${evt.taskId}:${evt.agentId}`,
      name: `Metrics for task ${evt.taskId}`,
      description: `Agent ${evt.agentId}: ${evt.usage.turns ?? 0} turns, ${evt.usage.totalCost?.toFixed(4) ?? '0'} USD, ${evt.durationMs ?? 0}ms`,
      signal: {
        relevance: 0.3,
        durability: 0.4,
        confidence: 1.0,
        actionability: 0.2,
        novelty: 0.3,
        contradiction: false,
        impact: 'low',
      },
    });
  }

  return delta;
}

/**
 * Convert a TaskDelta into CuratedItems with classification decisions.
 */
export function classifyDelta(
  delta: TaskDelta,
  taskId: string,
  agentId: string,
): CuratedItem[] {
  const items: CuratedItem[] = [];
  const allDeltaItems = [
    ...delta.decisions,
    ...delta.risks,
    ...delta.fileChanges,
    ...delta.learnings,
    ...delta.metrics,
  ];

  for (const di of allDeltaItems) {
    const decision = classify(di.signal);
    items.push({
      entityType: di.type,
      canonicalKey: di.key,
      displayName: di.name,
      summary: di.description,
      signal: di.signal,
      decision,
      sourceTaskId: taskId,
      sourceAgentId: agentId,
    });
  }

  return items;
}

// ── Main hook ───────────────────────────────────────────────────────

/**
 * Post-activity hook: runs after every agent completes a task.
 * Idempotent — safe to call multiple times for the same event.
 */
export async function onTaskDone(
  db: Database.Database,
  evt: TaskDoneEvent,
): Promise<CurationResult> {
  const key = `${evt.taskId}:${evt.agentId}:${evt.runId}`;
  const store = new CuratorStore(db);

  // Idempotency check
  if (store.alreadyProcessed(key)) {
    return {
      key,
      applied: { kept: 0, summarized: 0, discarded: 0, quarantined: 0, superseded: 0 },
      items: [],
      skipped: true,
    };
  }

  const scratchpad = new Scratchpad(db);

  // Build delta from task output
  const delta = buildTaskDelta(evt);

  // Classify all items
  const items = classifyDelta(delta, evt.taskId, evt.agentId);

  // Apply in transaction
  const applied = db.transaction(() => {
    const result = scratchpad.apply(evt.projectId, items);
    store.markProcessed(key, result);
    return result;
  })();

  return {
    key,
    applied,
    items,
    skipped: false,
  };
}
