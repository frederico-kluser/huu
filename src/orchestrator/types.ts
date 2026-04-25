import type { AgentTask, AppConfig } from '../lib/types.js';

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

export type AgentFactory = (
  task: AgentTask,
  config: AppConfig,
  systemPromptHint: string,
  cwd: string,
  onEvent: (event: AgentEvent) => void,
) => Promise<SpawnedAgent>;
