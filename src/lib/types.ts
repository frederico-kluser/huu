// Trimmed from pi-orq/src/lib/types.ts — guided-execution-only.
// Removed: parallel/dag/autonomous modes, retries, scaling, safety model, per-step modelId.

export interface AppConfig {
  apiKey: string;
  modelId: string;
  budgetUsd?: number;
}

/**
 * How a step decomposes into agent tasks.
 *
 * - `project`  — exactly one whole-project task. The Files selection is locked
 *                to "whole project" and the editor cannot change it.
 * - `per-file` — one task per selected file. Files MUST be picked; the editor
 *                disallows the whole-project shortcut.
 * - `flexible` — user picks at edit time (whole-project or N files). This is
 *                the legacy behavior. `undefined` is treated as `flexible`.
 */
export type StepScope = 'project' | 'per-file' | 'flexible';

export interface PromptStep {
  name: string;
  prompt: string;
  /** Files targeted by this step (relative to repo root). Empty = whole-project (single free run). */
  files: string[];
  /** Optional per-step model override. Falls back to AppConfig.modelId when undefined. */
  modelId?: string;
  /** See StepScope. Undefined = `flexible` (back-compat with v0.3.x pipelines). */
  scope?: StepScope;
}

export interface Pipeline {
  name: string;
  steps: PromptStep[];
  /**
   * Per-card timeout (ms) for whole-project cards (files.length === 0) and
   * multi-file cards. Default 600_000 = 10min.
   * NOTE: this is applied PER CARD, not to the pipeline as a whole. There is
   * no timeout for the entire pipeline run.
   */
  cardTimeoutMs?: number;
  /**
   * Per-card timeout (ms) for single-file cards (files.length === 1).
   * Default 300_000 = 5min. Same per-card semantics as `cardTimeoutMs`.
   */
  singleFileCardTimeoutMs?: number;
  /** Number of retries on timeout/failure before final fail. Default 1. */
  maxRetries?: number;
  /**
   * Per-agent port allocation. Each agent worktree gets a contiguous window of
   * TCP ports so parallel runs of `npm run dev`, dev servers, ad-hoc DBs, etc.
   * never collide on bind(). Disabled-by-default would be silent action at a
   * distance — leaving it on by default and letting users opt out.
   */
  portAllocation?: PortAllocationConfig;
}

export interface PortAllocationConfig {
  /** First port in the allocation range. Default 55100. */
  basePort?: number;
  /** Ports per agent. Min/default 10 (http, db, ws + 7 extras). */
  windowSize?: number;
  /** Set false to skip env-file generation entirely. Default true. */
  enabled?: boolean;
}

export const DEFAULT_CARD_TIMEOUT_MS = 600_000;
export const DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_RETRIES = 1;

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  selected?: boolean;
  expanded?: boolean;
}

// --- Run & Git ---

export interface RunManifest {
  runId: string;
  baseBranch: string;
  baseCommit: string;
  integrationBranch: string;
  integrationWorktreePath: string;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  agentEntries: AgentManifestEntry[];
  stageBaseCommits?: string[];
  totalStages?: number;
}

export type RunStatus = 'preflight' | 'running' | 'integrating' | 'done' | 'error';

export interface AgentManifestEntry {
  agentId: number;
  branchName: string;
  worktreePath: string;
  files: string[];
  status: AgentLifecyclePhase;
  commitSha?: string;
  pushStatus: PushStatus;
  cleanupDone: boolean;
  noChanges: boolean;
  error?: string;
  errorKind?: 'timeout' | 'failed';
  attempt?: number;
  stageIndex?: number;
  stageName?: string;
}

export type AgentLifecyclePhase =
  | 'pending'
  | 'worktree_creating'
  | 'worktree_ready'
  | 'session_starting'
  | 'streaming'
  | 'tool_running'
  | 'finalizing'
  | 'validating'
  | 'committing'
  | 'pushing'
  | 'cleaning_up'
  | 'done'
  | 'no_changes'
  | 'error';

export type PushStatus = 'pending' | 'pushing' | 'pushed' | 'skipped' | 'failed';

// --- Agent Task & Status ---

export interface AgentTask {
  agentId: number;
  files: string[];
  branchName: string;
  worktreePath: string;
  stageIndex: number;
  stageName: string;
}

export interface AgentStatus {
  agentId: number;
  state: 'idle' | 'streaming' | 'tool_running' | 'done' | 'error';
  phase: AgentLifecyclePhase;
  currentFile: string | null;
  logs: string[];
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  filesModified: string[];
  branchName?: string;
  worktreePath?: string;
  commitSha?: string;
  pushStatus: PushStatus;
  error?: string;
  errorKind?: 'timeout' | 'failed';
  attempt?: number;
  stageIndex: number;
  stageName: string;
  startedAt?: number;
  finishedAt?: number;
}

// --- Orchestrator state ---

export interface OrchestratorState {
  status: 'idle' | 'starting' | 'running' | 'integrating' | 'done' | 'error';
  runId: string;
  agents: AgentStatus[];
  logs: LogEntry[];
  totalCost: number;
  completedTasks: number;
  totalTasks: number;
  integrationStatus: IntegrationStatus;
  startedAt: number;
  elapsedMs: number;
  concurrency: number;
  currentStage: number;
  totalStages: number;
}

export interface IntegrationStatus {
  phase: 'pending' | 'merging' | 'conflict_resolving' | 'done' | 'error';
  branchesMerged: string[];
  branchesPending: string[];
  conflicts: IntegrationConflict[];
  finalCommitSha?: string;
}

export interface IntegrationConflict {
  file: string;
  branches: string[];
  resolved: boolean;
}

export interface LogEntry {
  timestamp: number;
  agentId: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  phase?: AgentLifecyclePhase;
  message: string;
  modelId?: string;
  context?: Record<string, unknown>;
}

export interface OrchestratorResult {
  runId: string;
  agents: AgentStatus[];
  logs: LogEntry[];
  totalCost: number;
  filesModified: string[];
  conflicts: ConflictInfo[];
  duration: number;
  manifest: RunManifest;
  integration: IntegrationStatus;
}

export interface ConflictInfo {
  file: string;
  agents: number[];
}

// --- Preflight ---

export interface PreflightResult {
  valid: boolean;
  repoRoot: string;
  baseBranch: string;
  baseCommit: string;
  isDirty: boolean;
  hasRemote: boolean;
  canPush: boolean;
  errors: string[];
  warnings: string[];
}
