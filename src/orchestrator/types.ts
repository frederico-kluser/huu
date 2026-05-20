import type { AgentTask, AppConfig } from '../lib/types.js';
import type { AgentPortBundle } from './port-allocator.js';

export type AgentEvent =
  | { type: 'log'; level?: 'info' | 'warn' | 'error'; message: string }
  | { type: 'state_change'; state: 'streaming' | 'tool_running' }
  | { type: 'file_write'; file: string }
  | {
      type: 'usage';
      /**
       * Token / cost telemetry. Emitted by backends whenever the underlying
       * SDK exposes usage info (Pi `message_end`, Copilot `assistant.usage`).
       * The orchestrator accumulates these into AgentStatus so the dashboard
       * and run-logger have real numbers instead of zeros. All fields are
       * optional because backends differ in what they report.
       */
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      cost?: number;
      model?: string;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * A spawned worker — abstracts both stub and real LLM agents so the
 * orchestrator stays agnostic of the SDK.
 */
export interface SpawnedAgent {
  agentId: number;
  task: AgentTask;
  /** Sends the user prompt; resolves once the agent reaches a terminal state. */
  prompt(message: string): Promise<void>;
  /**
   * Best-effort cancel of an in-flight prompt. Idempotent. Distinct from
   * dispose(): abort tells the SDK to stop the current request (so the
   * provider stops billing tokens) but leaves listeners and resources
   * alive so dispose() can still publish final teardown events. Used by
   * the orchestrator when a card timeout fires and we want to stop the
   * HTTP request immediately, instead of waiting for it to settle on its
   * own while we tear the agent down.
   */
  abort(): Promise<void>;
  /** Releases resources (LLM session, listeners). */
  dispose(): Promise<void>;
}

/**
 * Per-spawn context the orchestrator threads to the factory: things derived
 * from the agent's worktree that the agent itself needs to know about (port
 * bundle, future: dedicated socket dirs, scratch caches, etc.).
 *
 * Optional so existing callers and stub agents stay source-compatible.
 */
export interface AgentRuntimeContext {
  ports?: AgentPortBundle;
  /**
   * Whether the native bind() interceptor is loaded for this agent's process.
   * Used by the system-prompt generator to tell the LLM whether hardcoded
   * ports in the customer code will be silently remapped or will collide.
   */
  shimAvailable?: boolean;
}

export type AgentFactory = (
  task: AgentTask,
  config: AppConfig,
  systemPromptHint: string,
  cwd: string,
  onEvent: (event: AgentEvent) => void,
  runtimeContext?: AgentRuntimeContext,
) => Promise<SpawnedAgent>;
