// Trimmed from pi-orq/src/lib/types.ts — guided-execution-only.
// Removed: parallel/dag/autonomous modes, retries, scaling, safety model, per-step modelId.

/**
 * Which agent SDK is driving execution. The list is duplicated in
 * `src/orchestrator/backends/registry.ts` (as `AgentBackendKind`) — the
 * canonical declaration lives there because it's tightly coupled to the
 * factory dispatch. This local alias avoids a `lib/` → `orchestrator/`
 * import cycle (lib imports must stay backend-agnostic).
 */
export type AgentBackendKind = 'pi' | 'copilot' | 'azure' | 'stub';

export interface AppConfig {
  apiKey: string;
  modelId: string;
  budgetUsd?: number;
  /**
   * Optional backend-specific endpoint URL. Currently used by the `azure`
   * backend to pass the Azure AI Foundry endpoint (e.g.
   * `https://my.openai.azure.com/openai/v1/`) to the agent factory.
   * Pi and Copilot backends ignore this field.
   */
  endpoint?: string;
  /**
   * Optional. Default `'pi'`. Set by the CLI flag `--backend=` or the
   * TUI BackendSelector. Used by the api-key resolver to know which
   * spec is "the required one" and by the model selector to filter
   * the catalog.
   */
  backend?: AgentBackendKind;
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

/**
 * Work step — agents that actually modify the worktree.
 *
 * `type` is optional only for back-compat with pipelines saved before v0.4
 * (huu-pipeline-v1). The schema layer injects `type='work'` on parse for
 * any step missing it, but new code should always set it explicitly.
 *
 * `next` overrides the default "next index in the array" advancement.
 * It must reference another step's `name`. When omitted, the orchestrator
 * falls through to `steps[currentIndex + 1]` (or terminates if at the end).
 */
export interface WorkStep {
  type?: 'work';
  name: string;
  prompt: string;
  /** Files targeted by this step (relative to repo root). Empty = whole-project (single free run). */
  files: string[];
  /** Optional per-step model override. Falls back to AppConfig.modelId when undefined. */
  modelId?: string;
  /** See StepScope. Undefined = `flexible` (back-compat with v0.3.x pipelines). */
  scope?: StepScope;
  /** Override the next step. Must match another step's `name`. Undefined = next in array. */
  next?: string;
}

/**
 * Check step — pure LLM-evaluated decision node. Does NOT modify the worktree
 * (no commits, no agent branches). Spawns a judge agent in the integration
 * worktree, gives it shell access, and expects it to produce a JSON verdict
 * matching one of the declared `outcomes`.
 *
 * `condition` is natural language; the judge LLM may run any commands needed
 * to evaluate it. The token `$runs` is substituted with the current iteration
 * counter (1-based) before sending — lets the user write conditions like
 * "if coverage < 60% AND $runs < 3".
 *
 * Exactly one outcome must have `default: true`; that outcome is used when
 * the judge returns an unknown label or fails to parse.
 */
export interface CheckStep {
  type: 'check';
  name: string;
  condition: string;
  /** Generated at setup-time by `assistant-check-feasibility`; advisory. */
  instructionDraft?: string;
  outcomes: CheckOutcome[];
  /** Hard cap on visits per run. Defaults to {@link DEFAULT_CHECK_MAX_RUNS}. */
  maxRuns?: number;
  /** Optional per-step model override for the judge. */
  modelId?: string;
}

export interface CheckOutcome {
  label: string;
  nextStepName: string;
  default?: boolean;
}

/**
 * Discriminated union of pipeline node types. Any code that iterates
 * `Pipeline.steps` must narrow on `step.type` (treating an absent `type`
 * as `'work'` for back-compat).
 */
export type PipelineStep = WorkStep | CheckStep;

/**
 * Legacy alias retained so external callers (and the >100 internal call
 * sites that pre-date the union) keep type-checking. New code should use
 * `WorkStep` or `PipelineStep`.
 */
export type PromptStep = WorkStep;

export function isCheckStep(step: PipelineStep): step is CheckStep {
  return step.type === 'check';
}

export function isWorkStep(step: PipelineStep): step is WorkStep {
  return step.type === undefined || step.type === 'work';
}

export const DEFAULT_CHECK_MAX_RUNS = 5;
/**
 * Hard cap on total node executions per run. Even if the user forgets
 * `$runs` in conditions and `maxRuns` per check step, this prevents a
 * runaway loop from melting the worktree base.
 */
export const DEFAULT_MAX_NODE_EXECUTIONS = 50;

export interface Pipeline {
  name: string;
  steps: PipelineStep[];
  /**
   * Marker for the bundled default test pipeline (see
   * `src/lib/default-pipelines/huu-test-suite.ts`). When true, the Welcome
   * screen surfaces this pipeline as the prominent "▶ default" entry.
   * Purely advisory — the orchestrator ignores it.
   */
  _default?: boolean;
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
   * Hard cap on total node executions in one run (work + check). Default
   * {@link DEFAULT_MAX_NODE_EXECUTIONS}. Last-resort safety net for
   * pathological loop graphs; per-check `maxRuns` is the primary control.
   */
  maxNodeExecutions?: number;
  /**
   * Per-agent port allocation. Each agent worktree gets a contiguous window of
   * TCP ports so parallel runs of `npm run dev`, dev servers, ad-hoc DBs, etc.
   * never collide on bind(). Disabled-by-default would be silent action at a
   * distance — leaving it on by default and letting users opt out.
   */
  portAllocation?: PortAllocationConfig;
  /**
   * Optional model override for the merge/integration agent (the conflict
   * resolver that runs in the integration worktree between stages). Same
   * spirit as `WorkStep.modelId`: falls back to `AppConfig.modelId` when
   * undefined.
   */
  integrationModelId?: string;
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
  /**
   * Ordered trace of nodes visited during execution. Replaces the
   * implicit "stage N of totalStages" model when the pipeline contains
   * loops or skips. Always populated (even for linear pipelines) so the
   * dashboard / run-log have a single source of truth.
   */
  executionTrace?: ExecutionTraceEntry[];
  /** Per-stage-visit merge history (mirrors `OrchestratorState.stageIntegrations`). */
  stageIntegrations?: StageIntegration[];
}

export interface ExecutionTraceEntry {
  /** 1-based visit order. */
  visitIndex: number;
  stepName: string;
  stepType: 'work' | 'check';
  /** 1-based per-step iteration counter at the time of visit (= `$runs`). */
  runs: number;
  startedAt: number;
  finishedAt?: number;
  /** For check steps: the chosen outcome label. */
  outcomeLabel?: string;
  /** For check steps: the resolved next step name. */
  nextStepName?: string;
  /** Integration HEAD after this node finished (work steps only). */
  commitAfter?: string;
  /** For check steps: the natural-language condition with $runs substituted. */
  resolvedCondition?: string;
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
  | 'error'
  | 'killed_by_autoscaler';

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
  createdAt?: number;
  killedByAutoScaler?: boolean;
}

// --- Orchestrator state ---

export interface AutoScaleStatus {
  enabled: boolean;
  state: 'NORMAL' | 'SCALING_UP' | 'BACKING_OFF' | 'COOLDOWN' | 'DESTROYING';
  cooldownRemainingMs: number;
  cpuPercent: number;
  ramPercent: number;
}

export interface OrchestratorState {
  status: 'idle' | 'starting' | 'running' | 'integrating' | 'done' | 'error';
  runId: string;
  agents: AgentStatus[];
  logs: LogEntry[];
  totalCost: number;
  completedTasks: number;
  totalTasks: number;
  integrationStatus: IntegrationStatus;
  /** Per-stage-visit merge history — drives the kanban merge cards. */
  stageIntegrations: StageIntegration[];
  startedAt: number;
  elapsedMs: number;
  concurrency: number;
  currentStage: number;
  totalStages: number;
  pendingTaskCount: number;
  activeAgentCount: number;
  autoScale?: AutoScaleStatus;
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

export type StageIntegrationPhase =
  | 'pending'
  | 'merging'
  | 'conflict_resolving'
  | 'done'
  | 'error'
  | 'skipped';

/**
 * Per-stage-visit merge record. One entry is created for every WorkStep
 * visit (loops create fresh entries) so the dashboards can render the merge
 * as a kanban card flowing TODO → DOING → DONE instead of the UI appearing
 * frozen while `OrchestratorState.status === 'integrating'`. Unlike
 * `IntegrationStatus` (which is cumulative across the whole run), entries
 * here are scoped to a single stage merge.
 */
export interface StageIntegration {
  /** visitIndex of the WorkStep visit this merge follows — unique even with loops. */
  visitIndex: number;
  /** Index of the work step in `pipeline.steps` (for editor/model lookups). */
  stepIndex: number;
  stageName: string;
  /** 1-based per-step iteration counter at this visit (= `$runs`). */
  runs: number;
  phase: StageIntegrationPhase;
  /** Effective integration model: `pipeline.integrationModelId ?? config.modelId`. */
  modelId: string;
  /** True once the LLM conflict resolver was actually spawned. */
  resolverUsed: boolean;
  branchesMerged: string[];
  branchesPending: string[];
  conflicts: IntegrationConflict[];
  lastLog?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface LogEntry {
  timestamp: number;
  agentId: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  phase?: AgentLifecyclePhase;
  message: string;
  modelId?: string;
  context?: Record<string, unknown>;
  /** Run id (manifest.runId). Lets log aggregation pivot across runs. */
  runId?: string;
  /** 1-based stage number when known, undefined for orchestrator-level events. */
  stageIndex?: number;
  /** Stage name from the pipeline definition. */
  stageName?: string;
  /** Logical source of the entry — which subsystem produced it. */
  kind?: 'orchestrator' | 'integrator' | 'worker' | 'system';
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
