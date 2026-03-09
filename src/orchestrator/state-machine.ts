// State machine recovery patterns for the orchestrator (5.2.5)
//
// Formalizes run lifecycle states with explicit transitions, guards,
// and persistence. Recovery reuses the same state machine — no ad hoc paths.

import type Database from 'better-sqlite3';

// ── Run states ───────────────────────────────────────────────────────

export const RUN_STATUSES = [
  'running',
  'draining',
  'recovering',
  'paused_for_human',
  'done',
  'failed',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

// ── Allowed transitions ──────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<RunStatus, ReadonlySet<RunStatus>> = {
  running: new Set<RunStatus>(['draining', 'recovering', 'paused_for_human', 'done', 'failed']),
  recovering: new Set<RunStatus>(['running', 'paused_for_human', 'failed']),
  draining: new Set<RunStatus>(['done', 'failed']),
  paused_for_human: new Set<RunStatus>(['running', 'failed']),
  done: new Set<RunStatus>([]),
  failed: new Set<RunStatus>([]),
};

// ── Errors ───────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  public readonly from: RunStatus;
  public readonly to: RunStatus;

  constructor(from: RunStatus, to: RunStatus) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

// ── Transition record ────────────────────────────────────────────────

export interface TransitionRecord {
  id: number;
  run_id: string;
  from_state: string;
  to_state: string;
  trigger: string | null;
  metadata_json: string;
  created_at: string;
}

// ── Run record ───────────────────────────────────────────────────────

export interface RunRecord {
  run_id: string;
  project_id: string;
  status: RunStatus;
  state_version: number;
  last_applied_event_id: number;
  shutdown_requested_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Pure validation ──────────────────────────────────────────────────

export function isValidTransition(from: RunStatus, to: RunStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed.has(to);
}

export function isTerminal(status: RunStatus): boolean {
  return status === 'done' || status === 'failed';
}

export function getAllowedTransitions(from: RunStatus): readonly RunStatus[] {
  return [...ALLOWED_TRANSITIONS[from]];
}

// ── Persisted state machine ──────────────────────────────────────────

export class RunStateMachine {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a new run in 'running' state.
   */
  createRun(runId: string, projectId: string): RunRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO orchestrator_runs (run_id, project_id, status, state_version, last_applied_event_id, created_at, updated_at)
      VALUES (?, ?, 'running', 0, 0, ?, ?)
    `).run(runId, projectId, now, now);

    this.db.prepare(`
      INSERT INTO state_transitions (run_id, from_state, to_state, trigger, metadata_json)
      VALUES (?, 'init', 'running', 'create', '{}')
    `).run(runId);

    return this.getRun(runId)!;
  }

  /**
   * Get the current run record.
   */
  getRun(runId: string): RunRecord | undefined {
    return this.db.prepare(`
      SELECT run_id, project_id, status, state_version, last_applied_event_id,
             shutdown_requested_at, created_at, updated_at
      FROM orchestrator_runs WHERE run_id = ?
    `).get(runId) as RunRecord | undefined;
  }

  /**
   * Transition the run to a new state, atomically persisting both
   * the state change and a transition log entry.
   */
  transition(runId: string, to: RunStatus, trigger?: string, metadata?: Record<string, unknown>): RunRecord {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const from = run.status as RunStatus;
    if (from === to) return run; // no-op

    if (!isValidTransition(from, to)) {
      throw new InvalidTransitionError(from, to);
    }

    const now = new Date().toISOString();
    const metadataJson = JSON.stringify(metadata ?? {});

    const doTransition = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE orchestrator_runs
        SET status = ?, state_version = state_version + 1, updated_at = ?
        WHERE run_id = ? AND status = ?
      `).run(to, now, runId, from);

      this.db.prepare(`
        INSERT INTO state_transitions (run_id, from_state, to_state, trigger, metadata_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(runId, from, to, trigger ?? null, metadataJson);
    });

    doTransition();
    return this.getRun(runId)!;
  }

  /**
   * Mark shutdown requested timestamp.
   */
  requestShutdown(runId: string): RunRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE orchestrator_runs SET shutdown_requested_at = ?, updated_at = ? WHERE run_id = ?
    `).run(now, now, runId);
    return this.transition(runId, 'draining', 'shutdown_signal');
  }

  /**
   * Update last_applied_event_id (high-watermark for replay).
   */
  updateHighWatermark(runId: string, eventId: number): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE orchestrator_runs
      SET last_applied_event_id = ?, state_version = state_version + 1, updated_at = ?
      WHERE run_id = ? AND last_applied_event_id < ?
    `).run(eventId, now, runId, eventId);
  }

  /**
   * Get transition history for a run.
   */
  getTransitions(runId: string): TransitionRecord[] {
    return this.db.prepare(`
      SELECT id, run_id, from_state, to_state, trigger, metadata_json, created_at
      FROM state_transitions WHERE run_id = ? ORDER BY id
    `).all(runId) as TransitionRecord[];
  }

  /**
   * Find runs that were interrupted (not terminal) for recovery.
   */
  findInterruptedRuns(projectId: string): RunRecord[] {
    return this.db.prepare(`
      SELECT run_id, project_id, status, state_version, last_applied_event_id,
             shutdown_requested_at, created_at, updated_at
      FROM orchestrator_runs
      WHERE project_id = ? AND status NOT IN ('done', 'failed')
      ORDER BY created_at DESC
    `).all(projectId) as RunRecord[];
  }
}
