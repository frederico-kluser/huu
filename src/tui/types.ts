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

export type LogLevel = 'progress' | 'info' | 'warn' | 'error' | 'escalation';

export interface LogLine {
  id: string;
  ts: string;
  level: LogLevel;
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

// ── Layout density (responsive breakpoints) ─────────────────────────

export type Density = 'compact' | 'normal' | 'wide';

export function getDensity(columns: number): Density {
  if (columns >= 200) return 'wide';
  if (columns >= 120) return 'normal';
  return 'compact';
}
