// Shared type contracts

// ── Message types ──────────────────────────────────────────────────────

export const MESSAGE_TYPES = [
  'task_assigned',
  'task_progress',
  'task_done',
  'merge_ready',
  'merge_result',
  'escalation',
  'health_check',
  'broadcast',
  'steer',
  'follow_up',
  'abort_requested',
  'abort_ack',
  'promote_instinct',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = [
  'pending',
  'processing',
  'acked',
  'dead_letter',
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface Message {
  id: number;
  project_id: string;
  run_id: string | null;
  correlation_id: string | null;
  causation_id: number | null;
  message_type: MessageType;
  sender_agent: string;
  recipient_agent: string;
  priority: number;
  payload_json: string;
  status: MessageStatus;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  locked_at: string | null;
  lock_expires_at: string | null;
  acked_at: string | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
}

// ── Session types ──────────────────────────────────────────────────────

export const SESSION_STATUSES = [
  'running',
  'completed',
  'failed',
  'aborted',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface Session {
  id: string;
  project_id: string;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  summary_markdown: string | null;
  summary_json: string;
  total_messages: number;
  total_tool_calls: number;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
}

// ── Entity types (knowledge graph nodes) ───────────────────────────────

export interface Entity {
  id: number;
  project_id: string;
  entity_type: string;
  canonical_key: string;
  display_name: string;
  summary: string | null;
  metadata_json: string;
  confidence: number;
  source_message_id: number | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

// ── Relation types (knowledge graph edges) ─────────────────────────────

export interface Relation {
  id: number;
  project_id: string;
  from_entity_id: number;
  to_entity_id: number;
  relation_type: string;
  confidence: number;
  metadata_json: string;
  source_message_id: number | null;
  created_at: string;
  last_seen_at: string;
}

// ── Observation types ──────────────────────────────────────────────────

export const TOOL_PHASES = ['pre', 'post'] as const;
export type ToolPhase = (typeof TOOL_PHASES)[number];

export interface Observation {
  id: number;
  project_id: string;
  session_id: string;
  agent_id: string;
  tool_name: string;
  tool_phase: ToolPhase;
  input_summary: string | null;
  output_summary: string | null;
  success: number; // 0 | 1 (SQLite boolean)
  latency_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
  metadata_json: string;
  occurred_at: string;
  expires_at: string;
}

// ── Instinct types ─────────────────────────────────────────────────────

export const INSTINCT_STATES = [
  'candidate',
  'active',
  'deprecated',
  'promoted',
] as const;

export type InstinctState = (typeof INSTINCT_STATES)[number];

export interface Instinct {
  id: number;
  project_id: string;
  title: string;
  instinct_text: string;
  confidence: number;
  state: InstinctState;
  evidence_count: number;
  contradiction_count: number;
  source_observation_id: number | null;
  metadata_json: string;
  last_validated_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Beat state types ───────────────────────────────────────────────────

export const BEAT_STATUSES = ['running', 'blocked', 'completed'] as const;
export type BeatStatus = (typeof BEAT_STATUSES)[number];

export interface BeatState {
  project_id: string;
  run_id: string;
  current_act: number;
  current_sequence: string | null;
  current_beat: string | null;
  checkpoint_name: string | null;
  progress_pct: number;
  status: BeatStatus;
  blocked_reason: string | null;
  snapshot_json: string;
  updated_at: string;
}

// ── Audit log types ────────────────────────────────────────────────────

export const RESULT_STATUSES = ['success', 'error'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export interface AuditLogEntry {
  id: number;
  project_id: string;
  session_id: string | null;
  agent_id: string;
  tool_name: string;
  params_json: string;
  result_json: string;
  result_status: ResultStatus;
  duration_ms: number | null;
  message_id: number | null;
  error_text: string | null;
  prev_hash: string | null;
  entry_hash: string | null;
  created_at: string;
}

// ── Merge queue types ─────────────────────────────────────────────────

export const MERGE_QUEUE_STATUSES = [
  'queued',
  'in_progress',
  'merged',
  'conflict',
  'failed',
  'retry_wait',
] as const;

export type MergeQueueStatus = (typeof MERGE_QUEUE_STATUSES)[number];

export interface MergeQueueItem {
  id: number;
  request_id: string;
  source_branch: string;
  source_head_sha: string;
  target_branch: string;
  status: MergeQueueStatus;
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  available_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export const PREMERGE_STATUSES = ['clean', 'conflict', 'fatal', 'skipped'] as const;
export type PremergeStatus = (typeof PREMERGE_STATUSES)[number];

export const MERGE_TIERS = ['tier1', 'tier2', 'none'] as const;
export type MergeTier = (typeof MERGE_TIERS)[number];

export const MERGE_MODES = ['ff-only', 'no-ff-ort', 'noop_already_merged'] as const;
export type MergeMode = (typeof MERGE_MODES)[number];

export const MERGE_OUTCOMES = ['merged', 'conflict', 'failed'] as const;
export type MergeOutcome = (typeof MERGE_OUTCOMES)[number];

export interface MergeResult {
  id: number;
  request_id: string;
  queue_id: number;
  source_branch: string;
  source_head_sha: string;
  target_branch: string;
  target_head_before: string | null;
  target_head_after: string | null;
  premerge_status: PremergeStatus;
  tier_selected: MergeTier;
  merge_mode: MergeMode | null;
  outcome: MergeOutcome;
  conflicts_json: string;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  attempt: number;
  created_at: string;
}

// ── Schema migration types ─────────────────────────────────────────────

export interface SchemaMigration {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}
