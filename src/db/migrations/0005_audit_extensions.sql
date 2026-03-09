-- 4.3 Audit System: Extended audit_log schema + model_pricing + audit_reports
-- This migration creates a new table (audit_events) rather than altering the
-- existing append-only audit_log (which has UPDATE/DELETE triggers that would
-- interfere with ALTER TABLE on some SQLite versions).

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  agent_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  feature_id TEXT,
  task_id TEXT,
  beat_id TEXT,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  model_name TEXT,
  success INTEGER,
  error_code TEXT,
  duration_ms INTEGER,
  params_sanitized TEXT,
  params_hash TEXT,
  result_summary TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  estimated_cost_usd REAL,
  risk_score INTEGER DEFAULT 0,
  risk_flags_json TEXT,
  prev_hash TEXT,
  entry_hash TEXT NOT NULL
);

-- Indices for operational queries
CREATE INDEX IF NOT EXISTS idx_aevt_session_ts ON audit_events(session_id, ts_ms);
CREATE INDEX IF NOT EXISTS idx_aevt_agent_ts ON audit_events(agent_id, ts_ms);
CREATE INDEX IF NOT EXISTS idx_aevt_event_ts ON audit_events(event_type, ts_ms);
CREATE INDEX IF NOT EXISTS idx_aevt_failed_tools ON audit_events(tool_name, ts_ms) WHERE success = 0;
CREATE INDEX IF NOT EXISTS idx_aevt_high_risk ON audit_events(session_id, ts_ms) WHERE risk_score >= 70;
CREATE INDEX IF NOT EXISTS idx_aevt_trace ON audit_events(trace_id, span_id);
CREATE INDEX IF NOT EXISTS idx_aevt_feature ON audit_events(feature_id, ts_ms) WHERE feature_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aevt_task ON audit_events(task_id, ts_ms) WHERE task_id IS NOT NULL;

-- Append-only triggers
CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;

-- Model pricing catalog (versioned with effective dates)
CREATE TABLE IF NOT EXISTS model_pricing (
  id INTEGER PRIMARY KEY,
  model_name TEXT NOT NULL,
  input_per_mtok REAL NOT NULL,
  output_per_mtok REAL NOT NULL,
  cache_write_per_mtok REAL NOT NULL DEFAULT 0,
  cache_read_per_mtok REAL NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to TEXT
);

CREATE INDEX IF NOT EXISTS idx_pricing_model_date ON model_pricing(model_name, effective_from);

-- Seed current Anthropic pricing (as of 2025-05)
INSERT INTO model_pricing (model_name, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, effective_from) VALUES
  ('claude-opus-4-20250514', 15.0, 75.0, 18.75, 1.5, '2025-05-01'),
  ('claude-sonnet-4-5-20250929', 3.0, 15.0, 3.75, 0.3, '2025-09-01'),
  ('claude-haiku-4-5-20251001', 0.8, 4.0, 1.0, 0.08, '2025-10-01');

-- Audit reports table
CREATE TABLE IF NOT EXISTS audit_reports (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  report_json TEXT NOT NULL,
  report_markdown TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_session ON audit_reports(session_id);
