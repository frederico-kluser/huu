// TUI type contracts — shared between components, hooks, and data providers

// ── Kanban columns ──────────────────────────────────────────────────

export type KanbanColumn = 'backlog' | 'running' | 'review' | 'done' | 'failed';

export const KANBAN_COLUMNS: readonly KanbanColumn[] = [
  'backlog',
  'running',
  'review',
  'done',
  'failed',
];

export const COLUMN_LABELS: Record<KanbanColumn, string> = {
  backlog: 'Backlog',
  running: 'Running',
  review: 'Review',
  done: 'Done',
  failed: 'Failed',
};

// ── Task data for Kanban cards ──────────────────────────────────────

export interface KanbanTask {
  id: string;
  name: string;
  agent: string;
  model: string;
  elapsedMs: number;
  costUsd: number;
  column: KanbanColumn;
}

// ── Board snapshot (what the UI renders) ─────────────────────────────

export interface BoardSnapshot {
  tasks: KanbanTask[];
  act: number;
  beat: string | null;
  totalCostUsd: number;
  watermark: string;
}

// ── Data provider interface (TUI ↔ infrastructure contract) ─────────

export interface KanbanDataProvider {
  /** Cheap check: has anything changed since last snapshot? */
  getWatermark(): string;
  /** Full data read — only called when watermark changes. */
  getSnapshot(): BoardSnapshot;
}

// ── App tabs ────────────────────────────────────────────────────────

export type AppTab = 'kanban' | 'logs' | 'merge' | 'cost' | 'beat';

export const APP_TABS: readonly AppTab[] = [
  'kanban',
  'logs',
  'merge',
  'cost',
  'beat',
];

export const TAB_BY_KEY: Record<string, AppTab> = {
  k: 'kanban',
  l: 'logs',
  m: 'merge',
  c: 'cost',
  b: 'beat',
};

export const TAB_LABELS: Record<AppTab, string> = {
  kanban: '[K]anban',
  logs: '[L]ogs',
  merge: '[M]erge Queue',
  cost: '[C]ost',
  beat: '[B]eat Sheet',
};

// ── Detail View data ─────────────────────────────────────────────────

export type DetailLogLevel = 'progress' | 'info' | 'warn' | 'error' | 'escalation';

export interface LogLine {
  id: string;
  ts: string;
  level: DetailLogLevel;
  message: string;
}

export interface DiffFile {
  path: string;
  lines: string[];
  truncated: boolean;
  totalLines: number;
}

export interface TaskMetrics {
  inputTokens: number;
  outputTokens: number;
  contextUsedTokens: number;
  contextWindowTokens: number;
  costUsd: number;
  elapsedMs: number;
  model: string;
  startedAt: string | null;
  updatedAt: string | null;
}

export type InterventionLevel = 'ok' | 'watch' | 'act-now';

export interface InterventionSignal {
  label: string;
  severity: InterventionLevel;
}

export interface DetailSnapshot {
  taskId: string;
  taskName: string;
  agent: string;
  column: KanbanColumn;
  logs: LogLine[];
  diffs: DiffFile[];
  metrics: TaskMetrics;
  interventionLevel: InterventionLevel;
  interventionSignals: InterventionSignal[];
  watermark: string;
}

export interface DetailDataProvider {
  /** Cheap change detection for a specific task. */
  getDetailWatermark(taskId: string): string;
  /** Full detail read — only called when watermark changes. */
  getDetailSnapshot(taskId: string): DetailSnapshot;
}

// ── Specialized view types ───────────────────────────────────────────

// Logs view
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AggregatedLogEntry {
  id: string;
  ts: number;
  agentId: string;
  phase?: string | undefined;
  level: LogLevel;
  taskId?: string | undefined;
  message: string;
  source: 'messages' | 'audit_log';
}

export interface LogsSnapshot {
  entries: AggregatedLogEntry[];
  watermark: string;
}

export interface LogsDataProvider {
  getWatermark(): string;
  getSnapshot(limit?: number | undefined): LogsSnapshot;
}

// Merge Queue view
export type MergeViewStatus = 'queued' | 'running' | 'blocked' | 'merged' | 'failed';
export type MergeViewTier = 1 | 2 | 3 | 4;

export interface MergeQueueItemView {
  id: string;
  position: number;
  taskId: string;
  branch: string;
  enqueuedAt: number;
  waitMs: number;
  currentTier?: MergeViewTier | undefined;
  status: MergeViewStatus;
  retries: number;
  lastError?: string | undefined;
}

export interface MergeQueueSnapshot {
  items: MergeQueueItemView[];
  queueLength: number;
  runningCount: number;
  blockedCount: number;
  avgWaitMs: number;
  watermark: string;
}

export interface MergeQueueDataProvider {
  getWatermark(): string;
  getSnapshot(): MergeQueueSnapshot;
}

// Cost view
export type CostGroupBy = 'agent' | 'model' | 'phase';

export interface CostBreakdownRow {
  key: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  pct: number;
}

export interface CostSnapshot {
  totalCostUsd: number;
  totalTokens: number;
  avgCostPerTask: number;
  rows: CostBreakdownRow[];
  trend: number[];
  watermark: string;
}

export interface CostDataProvider {
  getWatermark(): string;
  getSnapshot(groupBy: CostGroupBy): CostSnapshot;
}

// Beat Sheet view
export type BeatNodeType = 'objective' | 'act' | 'sequence' | 'task';
export type BeatViewStatus = 'pending' | 'running' | 'done' | 'blocked';
export type CheckpointName = 'catalyst' | 'midpoint' | 'all_is_lost' | 'break_into_three' | 'final_image';

export interface BeatNode {
  id: string;
  parentId?: string | undefined;
  type: BeatNodeType;
  title: string;
  status: BeatViewStatus;
  progressPct: number;
  checkpoint?: CheckpointName | undefined;
  depth: number;
}

export interface CheckpointView {
  name: CheckpointName;
  label: string;
  status: BeatViewStatus;
  nodeId?: string | undefined;
}

export interface BeatSheetSnapshot {
  nodes: BeatNode[];
  checkpoints: CheckpointView[];
  overallProgressPct: number;
  watermark: string;
}

export interface BeatSheetDataProvider {
  getWatermark(): string;
  getSnapshot(): BeatSheetSnapshot;
}

// ── Coordination metrics view ─────────────────────────────────────────

export type OverheadLevel = 'green' | 'yellow' | 'red';

export interface CoordinationMetricsSnapshot {
  coordinationMs: number;
  executionMs: number;
  ratio: number;
  level: OverheadLevel;
  taskCount: number;
  p50QueueWaitMs: number;
  p95QueueWaitMs: number;
  avgMergeWaitMs: number;
  tasksPerSecond: number;
  schedulerRunning: number;
  schedulerPending: number;
  schedulerSaturated: boolean;
  watermark: string;
}

export interface CoordinationMetricsProvider {
  getWatermark(): string;
  getSnapshot(): CoordinationMetricsSnapshot;
}

// ── Layout density (responsive breakpoints) ─────────────────────────

export type Density = 'compact' | 'normal' | 'wide';

export function getDensity(columns: number): Density {
  if (columns >= 200) return 'wide';
  if (columns >= 120) return 'normal';
  return 'compact';
}
