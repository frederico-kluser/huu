import type Database from 'better-sqlite3';
import type { ModelPricing, CostBySession, CostByAgent, CostByFeature, CostByAgentModelPhase } from './types.js';

// ── Fallback pricing (used when no DB pricing row matches) ──────────

const FALLBACK_PRICING: Record<string, Omit<ModelPricing, 'model_name' | 'effective_from' | 'effective_to'>> = {
  'claude-opus-4-20250514': { input_per_mtok: 15.0, output_per_mtok: 75.0, cache_write_per_mtok: 18.75, cache_read_per_mtok: 1.5 },
  'claude-sonnet-4-5-20250929': { input_per_mtok: 3.0, output_per_mtok: 15.0, cache_write_per_mtok: 3.75, cache_read_per_mtok: 0.3 },
  'claude-haiku-4-5-20251001': { input_per_mtok: 0.8, output_per_mtok: 4.0, cache_write_per_mtok: 1.0, cache_read_per_mtok: 0.08 },
};

// Default to Sonnet pricing when model is unknown
const DEFAULT_PRICING = FALLBACK_PRICING['claude-sonnet-4-5-20250929']!;

/**
 * Calculate cost for a single event based on token usage and model pricing.
 */
export function calculateEventCost(
  db: Database.Database,
  usage: {
    model_name?: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
): number {
  const pricing = lookupPricing(db, usage.model_name ?? null);

  const cost =
    (usage.input_tokens / 1_000_000) * pricing.input_per_mtok +
    (usage.output_tokens / 1_000_000) * pricing.output_per_mtok +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * pricing.cache_write_per_mtok +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * pricing.cache_read_per_mtok;

  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal precision
}

/**
 * Lookup pricing from the model_pricing table, falling back to hardcoded defaults.
 */
export function lookupPricing(
  db: Database.Database,
  modelName: string | null,
): { input_per_mtok: number; output_per_mtok: number; cache_write_per_mtok: number; cache_read_per_mtok: number } {
  if (modelName) {
    try {
      const row = db.prepare(`
        SELECT input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok
        FROM model_pricing
        WHERE model_name = ?
          AND effective_from <= datetime('now')
          AND (effective_to IS NULL OR effective_to > datetime('now'))
        ORDER BY effective_from DESC
        LIMIT 1
      `).get(modelName) as { input_per_mtok: number; output_per_mtok: number; cache_write_per_mtok: number; cache_read_per_mtok: number } | undefined;

      if (row) return row;
    } catch {
      // Table might not exist yet (pre-migration)
    }

    // Try fallback map
    const fallback = FALLBACK_PRICING[modelName];
    if (fallback) return fallback;
  }

  return DEFAULT_PRICING;
}

// ── Aggregation queries ─────────────────────────────────────────────

export function getCostBySession(db: Database.Database, sessionId: string): CostBySession | null {
  return db.prepare(`
    SELECT
      session_id,
      COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(cache_creation_input_tokens), 0) AS total_cache_write_tokens,
      COALESCE(SUM(cache_read_input_tokens), 0) AS total_cache_read_tokens,
      COUNT(*) AS event_count
    FROM audit_events
    WHERE session_id = ?
      AND event_type IN ('llm_call_end', 'tool_billing', 'cove_step', 'curator_run', 'merge_tier4_llm')
  `).get(sessionId) as CostBySession | null;
}

export function getCostByAgent(db: Database.Database, sessionId: string): CostByAgent[] {
  return db.prepare(`
    SELECT
      agent_id,
      model_name,
      COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COUNT(*) AS event_count
    FROM audit_events
    WHERE session_id = ?
      AND event_type IN ('llm_call_end', 'tool_billing', 'cove_step', 'curator_run', 'merge_tier4_llm')
    GROUP BY agent_id, model_name
    ORDER BY total_cost_usd DESC
  `).all(sessionId) as CostByAgent[];
}

export function getCostByFeature(db: Database.Database, sessionId: string): CostByFeature[] {
  return db.prepare(`
    SELECT
      COALESCE(feature_id, '[unassigned]') AS feature_id,
      COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
      COUNT(*) AS event_count
    FROM audit_events
    WHERE session_id = ?
      AND event_type IN ('llm_call_end', 'tool_billing', 'cove_step', 'curator_run', 'merge_tier4_llm')
    GROUP BY feature_id
    ORDER BY total_cost_usd DESC
  `).all(sessionId) as CostByFeature[];
}

export function getCostByAgentModelPhase(db: Database.Database, sessionId: string): CostByAgentModelPhase[] {
  return db.prepare(`
    SELECT
      agent_id,
      model_name,
      phase,
      COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COUNT(*) AS event_count
    FROM audit_events
    WHERE session_id = ?
      AND event_type IN ('llm_call_end', 'tool_billing', 'cove_step', 'curator_run', 'merge_tier4_llm')
    GROUP BY agent_id, model_name, phase
    ORDER BY total_cost_usd DESC
  `).all(sessionId) as CostByAgentModelPhase[];
}
