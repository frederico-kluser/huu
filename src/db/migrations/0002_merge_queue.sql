-- 0002_merge_queue: FIFO merge queue + merge results for Tier 1/2 workflow
-- Tables: merge_queue, merge_results

PRAGMA foreign_keys = ON;

-- ── Merge Queue (FIFO, serialized merge into shared refs) ────────────

CREATE TABLE IF NOT EXISTS merge_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  source_branch TEXT NOT NULL,
  source_head_sha TEXT NOT NULL,
  target_branch TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','in_progress','merged','conflict','failed','retry_wait')),
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

CREATE INDEX IF NOT EXISTS idx_merge_queue_ready
  ON merge_queue(status, available_at, created_at, id);

CREATE INDEX IF NOT EXISTS idx_merge_queue_request
  ON merge_queue(request_id);

-- ── Merge Results (audit trail for every merge attempt) ──────────────

CREATE TABLE IF NOT EXISTS merge_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  queue_id INTEGER NOT NULL REFERENCES merge_queue(id),
  source_branch TEXT NOT NULL,
  source_head_sha TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  target_head_before TEXT,
  target_head_after TEXT,
  premerge_status TEXT NOT NULL CHECK (premerge_status IN ('clean','conflict','fatal','skipped')),
  tier_selected TEXT NOT NULL CHECK (tier_selected IN ('tier1','tier2','none')),
  merge_mode TEXT CHECK (merge_mode IN ('ff-only','no-ff-ort','noop_already_merged') OR merge_mode IS NULL),
  outcome TEXT NOT NULL CHECK (outcome IN ('merged','conflict','failed')),
  conflicts_json TEXT DEFAULT '[]' CHECK (json_valid(conflicts_json)),
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  duration_ms INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_merge_results_queue
  ON merge_results(queue_id);

CREATE INDEX IF NOT EXISTS idx_merge_results_request
  ON merge_results(request_id);

CREATE INDEX IF NOT EXISTS idx_merge_results_time
  ON merge_results(created_at DESC);
