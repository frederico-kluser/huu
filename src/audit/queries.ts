import type Database from 'better-sqlite3';
import type { AuditEvent, TimelineEntry } from './types.js';

/**
 * Session timeline — forensic chronological view of all events.
 */
export function getSessionTimeline(db: Database.Database, sessionId: string): TimelineEntry[] {
  return db.prepare(`
    SELECT ts_ms, agent_id, event_type, tool_name, success, duration_ms,
           estimated_cost_usd, risk_score
    FROM audit_events
    WHERE session_id = ?
    ORDER BY ts_ms
  `).all(sessionId) as TimelineEntry[];
}

/**
 * Top risk events for a session (for reports and TUI alerts).
 */
export function getTopRiskEvents(db: Database.Database, sessionId: string, limit: number = 10): AuditEvent[] {
  return db.prepare(`
    SELECT * FROM audit_events
    WHERE session_id = ? AND risk_score > 0
    ORDER BY risk_score DESC, ts_ms DESC
    LIMIT ?
  `).all(sessionId, limit) as AuditEvent[];
}

/**
 * Top cost events for a session.
 */
export function getTopCostEvents(db: Database.Database, sessionId: string, limit: number = 10): AuditEvent[] {
  return db.prepare(`
    SELECT * FROM audit_events
    WHERE session_id = ? AND estimated_cost_usd > 0
    ORDER BY estimated_cost_usd DESC
    LIMIT ?
  `).all(sessionId, limit) as AuditEvent[];
}

/**
 * Detect loops: same tool+params_hash repeated in a short window.
 */
export function detectLoops(db: Database.Database, sessionId: string, windowMs: number = 5000): Array<{
  agent_id: string;
  tool_name: string;
  params_hash: string;
  count: number;
  first_ts: number;
  last_ts: number;
}> {
  return db.prepare(`
    SELECT agent_id, tool_name, params_hash,
           COUNT(*) AS count,
           MIN(ts_ms) AS first_ts,
           MAX(ts_ms) AS last_ts
    FROM audit_events
    WHERE session_id = ?
      AND event_type = 'tool_call_end'
      AND params_hash IS NOT NULL
    GROUP BY agent_id, tool_name, params_hash
    HAVING COUNT(*) >= 3 AND (MAX(ts_ms) - MIN(ts_ms)) < ?
    ORDER BY count DESC
  `).all(sessionId, windowMs) as Array<{
    agent_id: string;
    tool_name: string;
    params_hash: string;
    count: number;
    first_ts: number;
    last_ts: number;
  }>;
}

/**
 * Cost anomaly detection: minute buckets with spikes.
 */
export function detectCostAnomalies(db: Database.Database, sessionId: string): Array<{
  minute_bucket: number;
  cost_min: number;
  avg_cost: number;
  is_spike: number;
}> {
  return db.prepare(`
    WITH minute_cost AS (
      SELECT session_id,
             (ts_ms / 60000) AS minute_bucket,
             SUM(estimated_cost_usd) AS cost_min
      FROM audit_events
      WHERE session_id = ?
        AND estimated_cost_usd > 0
      GROUP BY session_id, minute_bucket
    ),
    stats AS (
      SELECT session_id,
             AVG(cost_min) AS avg_cost
      FROM minute_cost
      GROUP BY session_id
    )
    SELECT m.minute_bucket, m.cost_min, s.avg_cost,
           CASE WHEN m.cost_min >= s.avg_cost * 3 THEN 1 ELSE 0 END AS is_spike
    FROM minute_cost m
    JOIN stats s ON m.session_id = s.session_id
    ORDER BY m.minute_bucket
  `).all(sessionId) as Array<{
    minute_bucket: number;
    cost_min: number;
    avg_cost: number;
    is_spike: number;
  }>;
}

/**
 * Failed tool calls summary.
 */
export function getFailedToolsSummary(db: Database.Database, sessionId: string): Array<{
  tool_name: string;
  agent_id: string;
  fail_count: number;
  last_error: string | null;
}> {
  return db.prepare(`
    SELECT tool_name, agent_id,
           COUNT(*) AS fail_count,
           MAX(error_code) AS last_error
    FROM audit_events
    WHERE session_id = ?
      AND event_type = 'tool_call_end'
      AND success = 0
    GROUP BY tool_name, agent_id
    ORDER BY fail_count DESC
  `).all(sessionId) as Array<{
    tool_name: string;
    agent_id: string;
    fail_count: number;
    last_error: string | null;
  }>;
}

/**
 * Get events by trace ID for distributed tracing.
 */
export function getEventsByTrace(db: Database.Database, traceId: string): AuditEvent[] {
  return db.prepare(`
    SELECT * FROM audit_events
    WHERE trace_id = ?
    ORDER BY ts_ms
  `).all(traceId) as AuditEvent[];
}

/**
 * Get total event counts by type for a session.
 */
export function getEventCountsByType(db: Database.Database, sessionId: string): Record<string, number> {
  const rows = db.prepare(`
    SELECT event_type, COUNT(*) AS cnt
    FROM audit_events
    WHERE session_id = ?
    GROUP BY event_type
  `).all(sessionId) as Array<{ event_type: string; cnt: number }>;

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.event_type] = row.cnt;
  }
  return result;
}

/**
 * Calculate p95 duration for tool/LLM calls in a session.
 */
export function getP95Duration(db: Database.Database, sessionId: string): number {
  const rows = db.prepare(`
    SELECT duration_ms
    FROM audit_events
    WHERE session_id = ?
      AND duration_ms IS NOT NULL
      AND event_type IN ('tool_call_end', 'llm_call_end')
    ORDER BY duration_ms
  `).all(sessionId) as Array<{ duration_ms: number }>;

  if (rows.length === 0) return 0;
  const idx = Math.ceil(rows.length * 0.95) - 1;
  return rows[Math.min(idx, rows.length - 1)]!.duration_ms;
}

/**
 * Get high-risk events (risk_score >= threshold).
 */
export function getHighRiskEvents(db: Database.Database, sessionId: string, threshold: number = 50): AuditEvent[] {
  return db.prepare(`
    SELECT * FROM audit_events
    WHERE session_id = ? AND risk_score >= ?
    ORDER BY risk_score DESC, ts_ms
  `).all(sessionId, threshold) as AuditEvent[];
}
