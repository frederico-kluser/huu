import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuditEvent, CreateAuditEventParams, RiskFlag } from './types.js';
import { sanitizeParams, hashParams, summarizeResult, computeEntryHash } from './sanitizer.js';
import { evaluateRiskRules } from './detector.js';
import { calculateEventCost } from './cost.js';

/**
 * AuditLogger — Append-only event logger for the audit system.
 *
 * Records tool calls, LLM calls, escalations, and other auditable events
 * with sanitization, hash chaining, risk scoring, and cost calculation.
 */
export class AuditLogger {
  private lastHash: Map<string, string> = new Map(); // per-session hash chain

  constructor(private readonly db: Database.Database) {}

  /**
   * Record an audit event. This is the primary entry point for all audit logging.
   * Automatically handles:
   * - Span ID generation (if not provided)
   * - Parameter sanitization + hashing
   * - Risk evaluation
   * - Cost calculation
   * - Hash chain maintenance
   */
  record(params: CreateAuditEventParams): AuditEvent {
    const tsMs = Date.now();
    const spanId = params.span_id ?? crypto.randomUUID();

    // Sanitize and hash params
    let parsedParams: unknown = params.params_sanitized ?? null;
    if (typeof parsedParams === 'string') {
      try { parsedParams = JSON.parse(parsedParams); } catch { /* keep as string */ }
    }
    const paramsSanitized = parsedParams != null
      ? sanitizeParams(parsedParams)
      : null;
    const paramsHash = params.params_sanitized
      ? hashParams(params.params_sanitized)
      : null;
    const resultSummary = params.result_summary
      ? summarizeResult(params.result_summary)
      : null;

    // Evaluate risk
    const recentEvents = this.getRecentEvents(params.session_id, 50);
    const riskFlags = params.risk_flags ?? evaluateRiskRules({
      event: params,
      recentEvents,
    });
    const riskScore = params.risk_score ?? riskFlags.reduce((sum, f) => sum + f.points, 0);

    // Calculate cost if tokens present
    const estimatedCost = params.estimated_cost_usd ?? (
      params.input_tokens != null || params.output_tokens != null
        ? calculateEventCost(this.db, {
            model_name: params.model_name ?? null,
            input_tokens: params.input_tokens ?? 0,
            output_tokens: params.output_tokens ?? 0,
            cache_creation_input_tokens: params.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: params.cache_read_input_tokens ?? 0,
          })
        : null
    );

    // Hash chain
    const prevHash = this.lastHash.get(params.session_id) ?? null;
    const entryHash = computeEntryHash(prevHash, {
      ts_ms: tsMs,
      session_id: params.session_id,
      run_id: params.run_id,
      trace_id: params.trace_id,
      span_id: spanId,
      agent_id: params.agent_id,
      event_type: params.event_type,
      tool_name: params.tool_name ?? null,
      success: params.success != null ? (params.success ? 1 : 0) : null,
    });

    const row = this.db.prepare(`
      INSERT INTO audit_events (
        ts_ms, session_id, run_id, trace_id, span_id, parent_span_id,
        agent_id, phase, feature_id, task_id, beat_id,
        event_type, tool_name, model_name,
        success, error_code, duration_ms,
        params_sanitized, params_hash, result_summary,
        input_tokens, output_tokens,
        cache_creation_input_tokens, cache_read_input_tokens,
        estimated_cost_usd, risk_score, risk_flags_json,
        prev_hash, entry_hash
      ) VALUES (
        @ts_ms, @session_id, @run_id, @trace_id, @span_id, @parent_span_id,
        @agent_id, @phase, @feature_id, @task_id, @beat_id,
        @event_type, @tool_name, @model_name,
        @success, @error_code, @duration_ms,
        @params_sanitized, @params_hash, @result_summary,
        @input_tokens, @output_tokens,
        @cache_creation_input_tokens, @cache_read_input_tokens,
        @estimated_cost_usd, @risk_score, @risk_flags_json,
        @prev_hash, @entry_hash
      ) RETURNING *
    `).get({
      ts_ms: tsMs,
      session_id: params.session_id,
      run_id: params.run_id,
      trace_id: params.trace_id,
      span_id: spanId,
      parent_span_id: params.parent_span_id ?? null,
      agent_id: params.agent_id,
      phase: params.phase,
      feature_id: params.feature_id ?? null,
      task_id: params.task_id ?? null,
      beat_id: params.beat_id ?? null,
      event_type: params.event_type,
      tool_name: params.tool_name ?? null,
      model_name: params.model_name ?? null,
      success: params.success != null ? (params.success ? 1 : 0) : null,
      error_code: params.error_code ?? null,
      duration_ms: params.duration_ms ?? null,
      params_sanitized: paramsSanitized,
      params_hash: paramsHash,
      result_summary: resultSummary,
      input_tokens: params.input_tokens ?? null,
      output_tokens: params.output_tokens ?? null,
      cache_creation_input_tokens: params.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: params.cache_read_input_tokens ?? null,
      estimated_cost_usd: estimatedCost,
      risk_score: riskScore,
      risk_flags_json: riskFlags.length > 0 ? JSON.stringify(riskFlags) : null,
      prev_hash: prevHash,
      entry_hash: entryHash,
    }) as AuditEvent;

    this.lastHash.set(params.session_id, entryHash);

    return row;
  }

  /**
   * Convenience: record a tool call start event.
   */
  recordToolStart(params: {
    session_id: string;
    run_id: string;
    trace_id: string;
    span_id: string;
    agent_id: string;
    phase: string;
    tool_name: string;
    params_raw?: unknown;
    feature_id?: string;
    task_id?: string;
    beat_id?: string;
  }): AuditEvent {
    const createParams: CreateAuditEventParams = {
      ...params,
      event_type: 'tool_call_start',
    };
    if (params.params_raw != null) {
      createParams.params_sanitized = JSON.stringify(params.params_raw);
    }
    return this.record(createParams);
  }

  /**
   * Convenience: record a tool call end event.
   */
  recordToolEnd(params: {
    session_id: string;
    run_id: string;
    trace_id: string;
    span_id: string;
    parent_span_id?: string;
    agent_id: string;
    phase: string;
    tool_name: string;
    success: boolean;
    duration_ms: number;
    result_raw?: unknown;
    error_code?: string;
    feature_id?: string;
    task_id?: string;
    beat_id?: string;
  }): AuditEvent {
    const createParams: CreateAuditEventParams = {
      ...params,
      event_type: 'tool_call_end',
    };
    if (params.result_raw != null) {
      createParams.result_summary = JSON.stringify(params.result_raw);
    }
    return this.record(createParams);
  }

  /**
   * Convenience: record an LLM call start event.
   */
  recordLlmStart(params: {
    session_id: string;
    run_id: string;
    trace_id: string;
    span_id: string;
    agent_id: string;
    phase: string;
    model_name: string;
    feature_id?: string;
    task_id?: string;
    beat_id?: string;
  }): AuditEvent {
    return this.record({
      ...params,
      event_type: 'llm_call_start',
    });
  }

  /**
   * Convenience: record an LLM call end event.
   */
  recordLlmEnd(params: {
    session_id: string;
    run_id: string;
    trace_id: string;
    span_id: string;
    parent_span_id?: string;
    agent_id: string;
    phase: string;
    model_name: string;
    success: boolean;
    duration_ms: number;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    error_code?: string;
    feature_id?: string;
    task_id?: string;
    beat_id?: string;
  }): AuditEvent {
    return this.record({
      ...params,
      event_type: 'llm_call_end',
    });
  }

  /**
   * Get recent events for a session (used by risk evaluator).
   */
  getRecentEvents(sessionId: string, limit: number = 50): AuditEvent[] {
    return this.db.prepare(`
      SELECT * FROM audit_events
      WHERE session_id = ?
      ORDER BY ts_ms DESC
      LIMIT ?
    `).all(sessionId, limit) as AuditEvent[];
  }

  /**
   * Get event by ID.
   */
  getById(id: number): AuditEvent | undefined {
    return this.db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id) as AuditEvent | undefined;
  }

  /**
   * Verify hash chain integrity for a session.
   */
  verifyHashChain(sessionId: string): { valid: boolean; total: number; verified: number; firstBrokenId: number | null } {
    const events = this.db.prepare(`
      SELECT id, ts_ms, session_id, run_id, trace_id, span_id,
             agent_id, event_type, tool_name, success,
             prev_hash, entry_hash
      FROM audit_events
      WHERE session_id = ?
      ORDER BY id
    `).all(sessionId) as AuditEvent[];

    let lastHash: string | null = null;
    let verified = 0;

    for (const event of events) {
      if (event.prev_hash !== lastHash) {
        return { valid: false, total: events.length, verified, firstBrokenId: event.id };
      }

      const expectedHash = computeEntryHash(lastHash, {
        ts_ms: event.ts_ms,
        session_id: event.session_id,
        run_id: event.run_id,
        trace_id: event.trace_id,
        span_id: event.span_id,
        agent_id: event.agent_id,
        event_type: event.event_type,
        tool_name: event.tool_name ?? null,
        success: event.success,
      });

      if (event.entry_hash !== expectedHash) {
        return { valid: false, total: events.length, verified, firstBrokenId: event.id };
      }

      lastHash = event.entry_hash;
      verified++;
    }

    return { valid: true, total: events.length, verified, firstBrokenId: null };
  }
}
