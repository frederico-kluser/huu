// Trimmed from pi-orq/src/lib/types.ts — guided-execution-only.
// Removed: parallel/dag/autonomous modes, retries, scaling, safety model, per-step modelId.

export interface AppConfig {
  apiKey: string;
  modelId: string;
  budgetUsd?: number;
}

export interface PromptStep {
  name: string;
  prompt: string;
  /** Files targeted by this step (relative to repo root). Empty = whole-project (single free run). */
  files: string[];
}

export interface Pipeline {
  name: string;
  steps: PromptStep[];
}

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
  stageIndex: number;
  stageName: string;
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
