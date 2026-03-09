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
export { plannerAgent, PLANNER_SYSTEM_PROMPT } from './definitions/planner.js';
export { testerAgent, TESTER_SYSTEM_PROMPT } from './definitions/tester.js';
export { reviewerAgent, REVIEWER_SYSTEM_PROMPT } from './definitions/reviewer.js';
export { researcherAgent, RESEARCHER_SYSTEM_PROMPT } from './definitions/researcher.js';
export { mergerAgent, MERGER_SYSTEM_PROMPT } from './definitions/merger.js';
export { refactorerAgent, REFACTORER_SYSTEM_PROMPT } from './definitions/refactorer.js';
export { docWriterAgent, DOC_WRITER_SYSTEM_PROMPT } from './definitions/doc-writer.js';
export { debuggerAgent, DEBUGGER_SYSTEM_PROMPT } from './definitions/debugger.js';
export { contextCuratorAgent, CONTEXT_CURATOR_SYSTEM_PROMPT } from './definitions/context-curator.js';

// ── Runtime ──────────────────────────────────────────────────────────
export type { RuntimeDeps } from './runtime.js';

export { spawnAgent } from './runtime.js';
