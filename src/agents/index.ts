// ── Types ────────────────────────────────────────────────────────────
export type {
  AgentModel,
  AgentDefinition,
  FileChangeSummary,
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

// ── File changes ────────────────────────────────────────────────────
export type { FileChangeSummary as FileChangeSummaryUtil } from './file-changes.js';

export {
  getFileChangesFromCommit,
  getFileChangesFromWorkingTree,
  parseDiffTreeOutput,
  parsePorcelainV2Output,
  emptyFileChangeSummary,
  hasChanges,
  flattenChangedFiles,
} from './file-changes.js';

// ── Agent definitions ───────────────────────────────────────────────
export { builderAgent, BUILDER_SYSTEM_PROMPT } from './definitions/builder.js';

// ── Runtime ──────────────────────────────────────────────────────────
export type { RuntimeDeps } from './runtime.js';

export { spawnAgent } from './runtime.js';
