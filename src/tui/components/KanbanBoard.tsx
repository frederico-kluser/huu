// 5-column Kanban board: Backlog → Running → Review → Done → Failed
//
// In compact mode (< 120 cols) shows 2 columns at a time,
// paging horizontally based on the selected column.

import React from 'react';
import { Box, Text } from 'ink';
import { Card } from './Card.js';
import type { KanbanTask, KanbanColumn, Density } from '../types.js';
import { KANBAN_COLUMNS, COLUMN_LABELS } from '../types.js';
import type { Selection } from '../hooks/useBoardNavigation.js';

interface KanbanBoardProps {
  tasks: KanbanTask[];
  selection: Selection;
  density: Density;
}

function groupByColumn(
  tasks: KanbanTask[],
): Record<KanbanColumn, KanbanTask[]> {
  const groups: Record<KanbanColumn, KanbanTask[]> = {
    backlog: [],
    running: [],
    review: [],
    done: [],
    failed: [],
  };
  for (const task of tasks) {
    groups[task.column].push(task);
  }
  return groups;
}

function getVisibleColumnsCompact(
  selectedColumnIndex: number,
): readonly KanbanColumn[] {
  // Show 2 columns at a time, anchored so the selected column is visible
  const start = Math.max(
    0,
    Math.min(selectedColumnIndex, KANBAN_COLUMNS.length - 2),
  );
  return KANBAN_COLUMNS.slice(start, start + 2);
}

export function KanbanBoard({
  tasks,
  selection,
  density,
}: KanbanBoardProps): React.JSX.Element {
  const grouped = groupByColumn(tasks);
  const columns =
    density === 'compact'
      ? getVisibleColumnsCompact(selection.columnIndex)
      : KANBAN_COLUMNS;

  // Estado vazio — nenhuma tarefa
  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Box flexDirection="column" alignItems="center" gap={1}>
          <Text dimColor>Nenhuma tarefa em andamento.</Text>
          <Text color="cyan" bold>
            Pressione  N  para criar uma nova tarefa.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexGrow={1}>
      {columns.map((col) => {
        const colIndex = KANBAN_COLUMNS.indexOf(col);
        const colTasks = grouped[col];
        const isActiveColumn = colIndex === selection.columnIndex;

        const COLUMN_COLORS: Record<KanbanColumn, string> = {
          backlog: 'gray',
          running: 'yellow',
          review: 'blue',
          done: 'green',
          failed: 'red',
        };

        const COLUMN_ICONS: Record<KanbanColumn, string> = {
          backlog: '\u25CB',
          running: '\u25B6',
          review: '\u25CF',
          done: '\u2714',
          failed: '\u2716',
        };

        return (
          <Box
            key={col}
            flexDirection="column"
            flexGrow={1}
            borderStyle="round"
            borderColor={isActiveColumn ? 'cyan' : 'gray'}
          >
            <Box paddingX={1} gap={1}>
              <Text color={COLUMN_COLORS[col]}>{COLUMN_ICONS[col]}</Text>
              <Text bold={isActiveColumn} color={isActiveColumn ? 'cyan' : 'white'}>
                {COLUMN_LABELS[col]}
              </Text>
              <Text dimColor>({colTasks.length})</Text>
            </Box>
            {colTasks.length === 0 ? (
              <Box paddingX={2}>
                <Text dimColor italic>empty</Text>
              </Box>
            ) : (
              colTasks.map((task, rowIdx) => (
                <Card
                  key={task.id}
                  task={task}
                  isSelected={isActiveColumn && rowIdx === selection.rowIndex}
                  density={density}
                />
              ))
            )}
          </Box>
        );
      })}
    </Box>
  );
}
