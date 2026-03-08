// ── Types ────────────────────────────────────────────────────────────
export type {
  AgentModel,
  AgentDefinition,
  RunState,
  AgentRunInput,
  AgentRunResult,
  RunUsage,
} from './types.js';

export {
  RUN_STATES,
  AgentDefinitionError,
  validateAgentDefinition,
  effectiveTools,
  resolveModelId,
} from './types.js';

// ── Abort ────────────────────────────────────────────────────────────
export {
  createRunAbortController,
  composeRunSignal,
  abortRun,
  cleanupRunController,
  getActiveRunIds,
} from './abort.js';

// ── Context ──────────────────────────────────────────────────────────
export type {
  PreparedContext,
  ContextLayer,
  PrepareContextInput,
} from './context.js';

export { prepareContext, estimateTokens } from './context.js';

// ── Tools ────────────────────────────────────────────────────────────
export type {
  ToolResult,
  ToolExecutionContext,
  ToolHandler,
  ToolDefinition,
} from './tools.js';

export { ToolRegistry, createDefaultRegistry } from './tools.js';

// ── Runtime ──────────────────────────────────────────────────────────
export type { RuntimeDeps } from './runtime.js';

export { spawnAgent } from './runtime.js';
