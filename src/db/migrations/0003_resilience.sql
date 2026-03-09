-- Migration 0003: Resilience tables for crash recovery, state machine, heartbeats, and task attempts
-- Supports: 5.2.1 Crash recovery, 5.2.2 Stale detection, 5.2.3 Timeout/retry, 5.2.5 State machine

-- Orchestrator run tracking with state machine
CREATE TABLE IF NOT EXISTS orchestrator_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'draining', 'recovering', 'paused_for_human', 'done', 'failed')),
  state_version INTEGER NOT NULL DEFAULT 0,
  last_applied_event_id INTEGER NOT NULL DEFAULT 0,
  shutdown_requested_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_project
  ON orchestrator_runs (project_id, status);

-- Append-only event log for deterministic replay
CREATE TABLE IF NOT EXISTS orchestrator_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  task_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(run_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_events_run
  ON orchestrator_events (run_id, id);

-- Task attempt tracking with heartbeat for stale detection
CREATE TABLE IF NOT EXISTS task_attempts (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'assigned'
    CHECK (state IN ('assigned', 'running', 'done', 'failed', 'timeout', 'aborted')),
  agent_name TEXT,
  agent_pid INTEGER,
  worktree_path TEXT,
  idempotency_key TEXT,
  heartbeat_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  error_text TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (run_id, task_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_task_attempts_state
  ON task_attempts (run_id, state);

CREATE INDEX IF NOT EXISTS idx_task_attempts_heartbeat
  ON task_attempts (state, heartbeat_at)
  WHERE state IN ('assigned', 'running');

-- Agent heartbeat tracking for stale detection
CREATE TABLE IF NOT EXISTS agent_heartbeats (
  run_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  pid INTEGER,
  worktree_path TEXT,
  last_heartbeat_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (run_id, agent_run_id)
);

-- State machine transition log for auditing
CREATE TABLE IF NOT EXISTS state_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  trigger TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_state_transitions_run
  ON state_transitions (run_id, id);
