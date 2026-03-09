// ── Audit system type contracts ──────────────────────────────────────

export const EVENT_TYPES = [
  'tool_call_start',
  'tool_call_end',
  'llm_call_start',
  'llm_call_end',
  'escalation',
  'cove_step',
  'curator_run',
  'merge_tier4_llm',
  'tool_billing',
] as const;

export type AuditEventType = (typeof EVENT_TYPES)[number];

export const RISK_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

// ── Audit event (matches extended audit_log schema) ─────────────────

export interface AuditEvent {
  id: number;
  ts_ms: number;
  session_id: string;
  run_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  agent_id: string;
  phase: string;
  feature_id: string | null;
  task_id: string | null;
  beat_id: string | null;
  event_type: AuditEventType;
  tool_name: string | null;
  model_name: string | null;
  success: number | null;
  error_code: string | null;
  duration_ms: number | null;
  params_sanitized: string | null;
  params_hash: string | null;
  result_summary: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  estimated_cost_usd: number | null;
  risk_score: number;
  risk_flags_json: string | null;
  prev_hash: string | null;
  entry_hash: string;
}

// ── Input for creating an audit event ───────────────────────────────

export interface CreateAuditEventParams {
  session_id: string;
  run_id: string;
  trace_id: string;
  span_id?: string;
  parent_span_id?: string;
  agent_id: string;
  phase: string;
  feature_id?: string;
  task_id?: string;
  beat_id?: string;
  event_type: AuditEventType;
  tool_name?: string;
  model_name?: string;
  success?: boolean;
  error_code?: string;
  duration_ms?: number;
  params_sanitized?: string;
  result_summary?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  estimated_cost_usd?: number;
  risk_score?: number;
  risk_flags?: RiskFlag[];
}

// ── Risk flags ──────────────────────────────────────────────────────

export const FLAG_CODES = [
  'PATH_OUTSIDE_WORKSPACE',
  'EXCESSIVE_FILE_WRITES',
  'EXCESSIVE_FILE_DELETES',
  'POSSIBLE_LOOP_DOW',
  'FAILURE_STREAK',
  'COST_SPIKE',
  'PROMPT_INJECTION_SUSPECT',
  'TOOL_OUTSIDE_PROFILE',
  'UNUSUAL_TOOL_SEQUENCE',
] as const;

export type FlagCode = (typeof FLAG_CODES)[number];

export interface RiskFlag {
  code: FlagCode;
  points: number;
  detail?: string;
}

// ── Risk rule definition ────────────────────────────────────────────

export interface RiskRuleContext {
  event: CreateAuditEventParams;
  recentEvents: AuditEvent[];
  agentProfile?: { tools: string[] };
  workspacePath?: string;
}

export interface RiskRule {
  code: FlagCode;
  evaluate: (ctx: RiskRuleContext) => RiskFlag | null;
}

// ── Model pricing ───────────────────────────────────────────────────

export interface ModelPricing {
  model_name: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_per_mtok: number;
  cache_read_per_mtok: number;
  effective_from: string;
  effective_to: string | null;
}

// ── Cost aggregation views ──────────────────────────────────────────

export interface CostBySession {
  session_id: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_write_tokens: number;
  total_cache_read_tokens: number;
  event_count: number;
}

export interface CostByAgent {
  agent_id: string;
  model_name: string | null;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  event_count: number;
}

export interface CostByFeature {
  feature_id: string;
  total_cost_usd: number;
  event_count: number;
}

export interface CostByAgentModelPhase {
  agent_id: string;
  model_name: string | null;
  phase: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  event_count: number;
}

// ── Audit report ────────────────────────────────────────────────────

export interface AuditReportKpis {
  total_events: number;
  total_tool_calls: number;
  total_llm_calls: number;
  total_failures: number;
  total_escalations: number;
  total_cost_usd: number;
  duration_ms: number;
  p95_duration_ms: number;
}

export interface AuditReportData {
  session_id: string;
  generated_at: string;
  kpis: AuditReportKpis;
  cost_by_agent: CostByAgent[];
  cost_by_feature: CostByFeature[];
  top_risk_events: AuditEvent[];
  top_cost_events: AuditEvent[];
  timeline_summary: TimelineEntry[];
  recommendations: string[];
}

export interface TimelineEntry {
  ts_ms: number;
  agent_id: string;
  event_type: AuditEventType;
  tool_name: string | null;
  success: number | null;
  duration_ms: number | null;
  estimated_cost_usd: number | null;
  risk_score: number;
}

// ── Hash chain verification ─────────────────────────────────────────

export interface HashChainVerification {
  valid: boolean;
  total_entries: number;
  verified_entries: number;
  first_broken_id: number | null;
}
