-- 0001_init: Core schema for HUU orchestrator
-- Tables: messages, sessions, entities, relations, observations, instincts, beat_state, audit_log

PRAGMA foreign_keys = ON;

-- ── Messages (typed mail system + queue semantics) ─────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  run_id TEXT,
  correlation_id TEXT,
  causation_id INTEGER REFERENCES messages(id),
  message_type TEXT NOT NULL CHECK (message_type IN (
    'task_assigned','task_progress','task_done',
    'merge_ready','merge_result','escalation',
    'health_check','broadcast',
    'steer','follow_up','abort_requested','abort_ack','promote_instinct'
  )),
  sender_agent TEXT NOT NULL,
  recipient_agent TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','acked','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  locked_at TEXT,
  lock_expires_at TEXT,
  acked_at TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_dequeue
  ON messages (recipient_agent, status, available_at, priority, id);
CREATE INDEX IF NOT EXISTS idx_messages_timeout
  ON messages (status, lock_expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_type_created
  ON messages (message_type, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_correlation
  ON messages (correlation_id);

-- ── Sessions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','aborted')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at TEXT,
  summary_markdown TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(summary_json)),
  total_messages INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_recent
  ON sessions (project_id, ended_at DESC);

-- ── Entities (knowledge graph nodes) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(project_id, canonical_key)
);

CREATE INDEX IF NOT EXISTS idx_entities_type
  ON entities (project_id, entity_type, last_seen_at DESC);

-- ── Relations (knowledge graph edges) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  from_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (from_entity_id <> to_entity_id),
  UNIQUE(project_id, from_entity_id, relation_type, to_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_relations_from
  ON relations (project_id, from_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_relations_to
  ON relations (project_id, to_entity_id, relation_type);

-- ── Observations (tool usage events, 30-day decay) ─────────────────────

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_phase TEXT NOT NULL CHECK (tool_phase IN ('pre','post')),
  input_summary TEXT,
  output_summary TEXT,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  latency_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_usd REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'))
);

CREATE INDEX IF NOT EXISTS idx_observations_recent
  ON observations (project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_expiry
  ON observations (expires_at);
CREATE INDEX IF NOT EXISTS idx_observations_agent_tool
  ON observations (project_id, agent_id, tool_name, occurred_at DESC);

-- ── Instincts (learned patterns, confidence 0.30–0.85) ─────────────────

CREATE TABLE IF NOT EXISTS instincts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  instinct_text TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0.30 AND confidence <= 0.85),
  state TEXT NOT NULL CHECK (state IN ('candidate','active','deprecated','promoted')),
  evidence_count INTEGER NOT NULL DEFAULT 0,
  contradiction_count INTEGER NOT NULL DEFAULT 0,
  source_observation_id INTEGER REFERENCES observations(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  last_validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(project_id, title)
);

CREATE INDEX IF NOT EXISTS idx_instincts_state_conf
  ON instincts (project_id, state, confidence DESC);

-- ── Beat state (current beat sheet progress) ───────────────────────────

CREATE TABLE IF NOT EXISTS beat_state (
  project_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  current_act INTEGER NOT NULL CHECK (current_act BETWEEN 1 AND 3),
  current_sequence TEXT,
  current_beat TEXT,
  checkpoint_name TEXT,
  progress_pct REAL NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  status TEXT NOT NULL CHECK (status IN ('running','blocked','completed')),
  blocked_reason TEXT,
  snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(snapshot_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Audit log (append-only) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  params_json TEXT NOT NULL CHECK (json_valid(params_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  result_status TEXT NOT NULL CHECK (result_status IN ('success','error')),
  duration_ms INTEGER,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  error_text TEXT,
  prev_hash TEXT,
  entry_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_time
  ON audit_log (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_agent_tool
  ON audit_log (project_id, agent_id, tool_name, created_at DESC);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
