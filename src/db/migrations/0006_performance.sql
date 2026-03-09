-- Migration 0005: Performance optimization
-- Adds task_runtime_metrics table for coordination overhead tracking
-- and composite indices for query optimization on large histories.

-- ── Task runtime metrics (coordination overhead) ─────────────────────

CREATE TABLE IF NOT EXISTS task_runtime_metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT    NOT NULL,
  task_id       TEXT    NOT NULL,
  agent_id      TEXT    NOT NULL,
  run_id        TEXT    NOT NULL,

  -- Raw timestamps (epoch ms)
  task_queued_at      INTEGER,
  task_dispatched_at  INTEGER,
  agent_started_at    INTEGER,
  agent_done_at       INTEGER,
  merge_queued_at     INTEGER,
  merge_started_at    INTEGER,
  merge_done_at       INTEGER,
  lock_wait_ms        INTEGER DEFAULT 0,

  -- Derived (computed on insert/update)
  queue_wait_ms       INTEGER GENERATED ALWAYS AS (
    CASE WHEN agent_started_at IS NOT NULL AND task_dispatched_at IS NOT NULL
         THEN agent_started_at - task_dispatched_at ELSE NULL END
  ) STORED,
  execution_ms        INTEGER GENERATED ALWAYS AS (
    CASE WHEN agent_done_at IS NOT NULL AND agent_started_at IS NOT NULL
         THEN agent_done_at - agent_started_at ELSE NULL END
  ) STORED,
  merge_wait_ms       INTEGER GENERATED ALWAYS AS (
    CASE WHEN merge_started_at IS NOT NULL AND merge_queued_at IS NOT NULL
         THEN merge_started_at - merge_queued_at ELSE NULL END
  ) STORED,
  merge_exec_ms       INTEGER GENERATED ALWAYS AS (
    CASE WHEN merge_done_at IS NOT NULL AND merge_started_at IS NOT NULL
         THEN merge_done_at - merge_started_at ELSE NULL END
  ) STORED,
  coordination_ms     INTEGER GENERATED ALWAYS AS (
    COALESCE(
      CASE WHEN agent_started_at IS NOT NULL AND task_dispatched_at IS NOT NULL
           THEN agent_started_at - task_dispatched_at ELSE 0 END, 0
    ) +
    COALESCE(
      CASE WHEN merge_started_at IS NOT NULL AND merge_queued_at IS NOT NULL
           THEN merge_started_at - merge_queued_at ELSE 0 END, 0
    ) +
    COALESCE(lock_wait_ms, 0)
  ) STORED,

  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Indices for task_runtime_metrics ─────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_trm_session
  ON task_runtime_metrics(session_id);

CREATE INDEX IF NOT EXISTS idx_trm_task
  ON task_runtime_metrics(task_id);

CREATE INDEX IF NOT EXISTS idx_trm_session_created
  ON task_runtime_metrics(session_id, created_at);

-- ── Composite indices for existing tables (query optimization) ───────

-- messages: common filter by project + type + time
CREATE INDEX IF NOT EXISTS idx_messages_project_type_created
  ON messages(project_id, message_type, created_at);

-- messages: common filter by project + time (ordering)
CREATE INDEX IF NOT EXISTS idx_messages_project_created
  ON messages(project_id, created_at);

-- audit_log: common filter by project + time
CREATE INDEX IF NOT EXISTS idx_audit_project_created
  ON audit_log(project_id, created_at);

-- audit_log: common filter by agent + time
CREATE INDEX IF NOT EXISTS idx_audit_agent_created
  ON audit_log(agent_id, created_at);

-- observations: common filter by project + session + time
CREATE INDEX IF NOT EXISTS idx_obs_project_session
  ON observations(project_id, session_id, occurred_at);

-- observations: cost queries by project grouped by agent
CREATE INDEX IF NOT EXISTS idx_obs_project_agent
  ON observations(project_id, agent_id);

-- merge_queue: status-based lookups (active items)
CREATE INDEX IF NOT EXISTS idx_mq_status_created
  ON merge_queue(status, created_at);

-- merge_results: lookup by queue_id
CREATE INDEX IF NOT EXISTS idx_mr_queue_id
  ON merge_results(queue_id, created_at);

-- sessions: project + time ordering
CREATE INDEX IF NOT EXISTS idx_sessions_project_created
  ON sessions(project_id, created_at);

-- entities: knowledge graph lookups
CREATE INDEX IF NOT EXISTS idx_entities_project_type
  ON entities(project_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_entities_project_key
  ON entities(project_id, canonical_key);
