/**
 * Domain type aliases derived from `@shared/ws-protocol` re-exports.
 *
 * The protocol file (which the front-end can import) re-exports a small set of
 * top-level types (Pipeline, OrchestratorState, FileNode, …). Some nested
 * types (LogEntry, AgentStatus, PromptStep, AgentLifecyclePhase) are NOT
 * directly re-exported, so we derive them via indexed access here. This keeps
 * the front-end free of any path into `src/lib/` while still being strongly
 * typed.
 */
import type {
  OrchestratorState,
  Pipeline,
  ModelCatalogEntry,
} from '@shared/ws-protocol';

export type AgentStatus = OrchestratorState['agents'][number];
export type LogEntry = OrchestratorState['logs'][number];
export type AgentLifecyclePhase = AgentStatus['phase'];
export type StageIntegration = OrchestratorState['stageIntegrations'][number];
/**
 * Narrow Pipeline.steps to the work-step shape (the one with `prompt`/`files`).
 * The webui editor only handles work steps; check steps live in TUI for now.
 */
export type PromptStep = Extract<Pipeline['steps'][number], { prompt: string }>;
export type { ModelCatalogEntry };
