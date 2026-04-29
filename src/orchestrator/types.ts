import type { AgentTask, AppConfig } from '../lib/types.js';
import type { AgentPortBundle } from './port-allocator.js';

export type AgentEvent =
  | { type: 'log'; level?: 'info' | 'warn' | 'error'; message: string }
  | { type: 'state_change'; state: 'streaming' | 'tool_running' }
  | { type: 'file_write'; file: string }
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
