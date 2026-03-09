// Memory & Learning — Observation logging via tool call hooks
//
// Deterministic telemetry ingestion for every tool call lifecycle.
// Captures both intent (pre) and outcome (post) with trace IDs.
// All writes go to the `observations` table in a single DB transaction per event.

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { ObservationRepository } from '../db/repositories/observations.js';
import type { CreateObservationParams } from '../db/repositories/observations.js';
import type { Observation } from '../types/index.js';
import type { ObservationConfig } from './config.js';
import { DEFAULT_MEMORY_CONFIG } from './config.js';

// ── PII sanitization ─────────────────────────────────────────────────

/** Patterns that look like secrets/PII — strip before persistence. */
const SENSITIVE_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|credential|auth)['":\s]*[=:]\s*['"]?[A-Za-z0-9\-_.+=\/]{8,}['"]?/gi,
  /sk-[A-Za-z0-9]{20,}/g,                          // Anthropic / OpenAI keys
  /ghp_[A-Za-z0-9]{36,}/g,                          // GitHub PATs
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, // email addresses
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,                  // phone numbers
];

export function sanitize(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  // Truncate to avoid storing huge payloads
  if (result.length > 2000) {
    result = result.slice(0, 2000) + '…[truncated]';
  }
  return result;
}

// ── Event types ─────────────────────────────────────────────────────

export interface ToolPreEvent {
  projectId: string;
  sessionId: string;
  agentId: string;
  toolName: string;
  traceId: string;
  input: Record<string, unknown>;
}

export interface ToolPostEvent {
  projectId: string;
  sessionId: string;
  agentId: string;
  toolName: string;
  traceId: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
  latencyMs: number;
  tokensInput?: number;
  tokensOutput?: number;
  costUsd?: number;
}

// ── Observer class ─────────────────────────────────────────────────

export class Observer {
  private readonly repo: ObservationRepository;
  private readonly config: ObservationConfig;
  private readonly fallbackQueue: CreateObservationParams[] = [];

  constructor(db: Database.Database, config?: Partial<ObservationConfig>) {
    this.repo = new ObservationRepository(db);
    this.config = { ...DEFAULT_MEMORY_CONFIG.observation, ...config };
  }

  /** Generate a new trace ID to correlate pre/post events. */
  static newTraceId(): string {
    return crypto.randomUUID();
  }

  /** Record pre-execution observation. */
  onToolPre(event: ToolPreEvent): Observation | null {
    if (!this.config.enabled || !this.config.preToolHook) return null;

    const inputSummary = this.config.sanitizePii
      ? sanitize(JSON.stringify(event.input))
      : JSON.stringify(event.input);

    const params: CreateObservationParams = {
      project_id: event.projectId,
      session_id: event.sessionId,
      agent_id: event.agentId,
      tool_name: event.toolName,
      tool_phase: 'pre',
      success: true, // pre always "succeeds" — it records intent
      metadata_json: JSON.stringify({ trace_id: event.traceId }),
    };
    if (inputSummary !== undefined) params.input_summary = inputSummary;

    return this.persistOrQueue(params);
  }

  /** Record post-execution observation. */
  onToolPost(event: ToolPostEvent): Observation | null {
    if (!this.config.enabled || !this.config.postToolHook) return null;

    const inputSummary = this.config.sanitizePii
      ? sanitize(JSON.stringify(event.input))
      : JSON.stringify(event.input);

    const outputSummary = this.config.sanitizePii
      ? sanitize(event.output)
      : event.output?.slice(0, 2000);

    const params: CreateObservationParams = {
      project_id: event.projectId,
      session_id: event.sessionId,
      agent_id: event.agentId,
      tool_name: event.toolName,
      tool_phase: 'post',
      success: event.success,
      latency_ms: event.latencyMs,
      metadata_json: JSON.stringify({ trace_id: event.traceId }),
    };
    if (inputSummary !== undefined) params.input_summary = inputSummary;
    if (outputSummary !== undefined) params.output_summary = outputSummary;
    if (event.tokensInput !== undefined) params.tokens_input = event.tokensInput;
    if (event.tokensOutput !== undefined) params.tokens_output = event.tokensOutput;
    if (event.costUsd !== undefined) params.cost_usd = event.costUsd;

    return this.persistOrQueue(params);
  }

  /** Flush fallback queue (e.g. on startup or after DB busy). */
  flushQueue(): number {
    let flushed = 0;
    while (this.fallbackQueue.length > 0) {
      const params = this.fallbackQueue[0]!;
      try {
        this.repo.create(params);
        this.fallbackQueue.shift();
        flushed++;
      } catch {
        break; // DB still busy, stop flushing
      }
    }
    return flushed;
  }

  get pendingQueueSize(): number {
    return this.fallbackQueue.length;
  }

  // ── Private ─────────────────────────────────────────────────────

  private persistOrQueue(params: CreateObservationParams): Observation | null {
    try {
      const obs = this.repo.create(params);
      return obs;
    } catch (err) {
      // DB busy — queue for later flush
      this.fallbackQueue.push(params);
      // Surface the failure (non-silent)
      const toolInfo = `${params.agent_id}/${params.tool_name}/${params.tool_phase}`;
      console.error(`[memory/observer] Failed to persist observation (${toolInfo}):`, err);
      return null;
    }
  }
}
