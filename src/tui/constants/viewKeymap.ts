// Unified keymap for all specialized views — ensures consistency across tabs

export interface KeyBinding {
  key: string;
  label: string;
  description: string;
}

// ── Global navigation (applies across all tabs) ─────────────────────
export const GLOBAL_KEYS: readonly KeyBinding[] = [
  { key: 'k', label: 'K', description: 'Kanban' },
  { key: 'l', label: 'L', description: 'Logs' },
  { key: 'm', label: 'M', description: 'Merge' },
  { key: 'c', label: 'C', description: 'Cost' },
  { key: 'b', label: 'B', description: 'Beat Sheet' },
  { key: 'q', label: 'q', description: 'Quit' },
];

// ── Logs view keys ──────────────────────────────────────────────────
export const LOGS_KEYS: readonly KeyBinding[] = [
  { key: '/', label: '/', description: 'Search' },
  { key: 'f', label: 'f', description: 'Filter' },
  { key: 'e', label: 'e', description: 'Errors only' },
  { key: 'g', label: 'g', description: 'Jump to end' },
];

// ── Merge Queue view keys ───────────────────────────────────────────
export const MERGE_KEYS: readonly KeyBinding[] = [
  { key: 'return', label: 'Enter', description: 'Expand detail' },
  { key: 'f', label: 'f', description: 'Filter status' },
  { key: 'r', label: 'r', description: 'Refresh' },
];

// ── Cost view keys ──────────────────────────────────────────────────
export const COST_KEYS: readonly KeyBinding[] = [
  { key: 'a', label: 'a', description: 'Group by agent' },
  { key: 'p', label: 'p', description: 'Group by phase' },
  { key: 'o', label: 'o', description: 'Group by model' },
];

// ── Beat Sheet view keys ────────────────────────────────────────────
export const BEAT_KEYS: readonly KeyBinding[] = [
  { key: 'right', label: '\u2192', description: 'Expand' },
  { key: 'left', label: '\u2190', description: 'Collapse' },
  { key: 'return', label: 'Enter', description: 'Detail' },
];
