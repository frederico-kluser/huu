-- 0003_conflict_history: Conflict telemetry + Tier 3/4 support
-- Tables: merge_conflicts, merge_resolution_attempts
-- Also updates merge_queue and merge_results CHECK constraints for Tier 3/4 values.

PRAGMA foreign_keys = OFF;

-- ── Update merge_queue: add 'blocked_human' status ────────────────────

CREATE TABLE merge_queue_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  source_branch TEXT NOT NULL,
  source_head_sha TEXT NOT NULL,
  target_branch TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','in_progress','merged','conflict','failed','retry_wait','blocked_human')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  lease_owner TEXT,
  lease_expires_at TEXT,
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO merge_queue_new SELECT * FROM merge_queue;
DROP TABLE merge_queue;
ALTER TABLE merge_queue_new RENAME TO merge_queue;

CREATE INDEX IF NOT EXISTS idx_merge_queue_ready
  ON merge_queue(status, available_at, created_at, id);
CREATE INDEX IF NOT EXISTS idx_merge_queue_request
  ON merge_queue(request_id);

-- ── Update merge_results: add tier3/tier4, new modes, escalated outcome ──

CREATE TABLE merge_results_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  queue_id INTEGER NOT NULL REFERENCES merge_queue(id),
  source_branch TEXT NOT NULL,
  source_head_sha TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  target_head_before TEXT,
  target_head_after TEXT,
  premerge_status TEXT NOT NULL CHECK (premerge_status IN ('clean','conflict','fatal','skipped')),
  tier_selected TEXT NOT NULL CHECK (tier_selected IN ('tier1','tier2','tier3','tier4','none')),
  merge_mode TEXT CHECK (merge_mode IN ('ff-only','no-ff-ort','noop_already_merged','ort-x-ours','ort-x-theirs','ai-patch') OR merge_mode IS NULL),
  outcome TEXT NOT NULL CHECK (outcome IN ('merged','conflict','failed','escalated')),
  conflicts_json TEXT DEFAULT '[]' CHECK (json_valid(conflicts_json)),
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  duration_ms INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO merge_results_new SELECT * FROM merge_results;
DROP TABLE merge_results;
ALTER TABLE merge_results_new RENAME TO merge_results;

CREATE INDEX IF NOT EXISTS idx_merge_results_queue
  ON merge_results(queue_id);
CREATE INDEX IF NOT EXISTS idx_merge_results_request
  ON merge_results(request_id);
CREATE INDEX IF NOT EXISTS idx_merge_results_time
  ON merge_results(created_at DESC);

PRAGMA foreign_keys = ON;

-- ── Conflict history tables ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS merge_conflicts (
  id TEXT PRIMARY KEY,
  queue_item_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  conflict_fingerprint TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  merge_base_sha TEXT NOT NULL,
  ours_sha TEXT NOT NULL,
  theirs_sha TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS merge_resolution_attempts (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES merge_conflicts(id),
  tier INTEGER NOT NULL CHECK (tier IN (3, 4)),
  strategy TEXT NOT NULL,
  selected_side TEXT,
  confidence REAL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failed','escalated')),
  model_id TEXT,
  prompt_hash TEXT,
  applied_commit_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_merge_conflicts_path
  ON merge_conflicts(file_path);
CREATE INDEX IF NOT EXISTS idx_merge_conflicts_fingerprint
  ON merge_conflicts(conflict_fingerprint);
CREATE INDEX IF NOT EXISTS idx_merge_conflicts_queue_item
  ON merge_conflicts(queue_item_id);
CREATE INDEX IF NOT EXISTS idx_merge_attempts_conflict
  ON merge_resolution_attempts(conflict_id);
