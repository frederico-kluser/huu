// Keyboard navigation state for the Kanban board
//
// Models selection as {columnIndex, rowIndex}.
// Clamps to valid bounds on every render so stale state
// never produces an out-of-bounds selection.

import { useState } from 'react';
import type { KanbanTask, KanbanColumn } from '../types.js';
import { KANBAN_COLUMNS } from '../types.js';

export interface Selection {
  columnIndex: number;
  rowIndex: number;
}

export interface BoardNavigation {
  selection: Selection;
  moveLeft(): void;
  moveRight(): void;
  moveUp(): void;
  moveDown(): void;
  getSelectedTaskId(): string | undefined;
}

export function useBoardNavigation(tasks: KanbanTask[]): BoardNavigation {
  const [raw, setRaw] = useState<Selection>({
    columnIndex: 0,
    rowIndex: 0,
  });

  const columnCounts = KANBAN_COLUMNS.map(
    (col) => tasks.filter((t) => t.column === col).length,
  );

  function clamp(sel: Selection): Selection {
    const colIdx = Math.max(
      0,
      Math.min(sel.columnIndex, KANBAN_COLUMNS.length - 1),
    );
    const count = columnCounts[colIdx] ?? 0;
    const rowIdx =
      count > 0 ? Math.max(0, Math.min(sel.rowIndex, count - 1)) : 0;
    return { columnIndex: colIdx, rowIndex: rowIdx };
  }

  const selection = clamp(raw);

  return {
    selection,
    moveLeft: () =>
      setRaw((prev) =>
        clamp({ ...prev, columnIndex: prev.columnIndex - 1 }),
      ),
    moveRight: () =>
      setRaw((prev) =>
        clamp({ ...prev, columnIndex: prev.columnIndex + 1 }),
      ),
    moveUp: () =>
      setRaw((prev) => clamp({ ...prev, rowIndex: prev.rowIndex - 1 })),
    moveDown: () =>
      setRaw((prev) => clamp({ ...prev, rowIndex: prev.rowIndex + 1 })),
    getSelectedTaskId: () => {
      const column: KanbanColumn | undefined =
        KANBAN_COLUMNS[selection.columnIndex];
      if (!column) return undefined;
      const colTasks = tasks.filter((t) => t.column === column);
      return colTasks[selection.rowIndex]?.id;
    },
  };
}
