// Kanban card — visual unit for a single task
//
// Adapts content density by terminal width:
// - compact (80-119): single line, truncated
// - normal (120-199): 2 lines with metadata
// - wide (200+): 2 lines with full names and all metadata

import React from 'react';
import { Box, Text } from 'ink';
import type { KanbanTask, Density } from '../types.js';

interface CardProps {
  task: KanbanTask;
  isSelected: boolean;
  density: Density;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

const COLUMN_STATUS_ICON: Record<string, string> = {
  backlog: '\u25CB',   // empty circle
  running: '\u25B6',   // play
  review: '\u25CF',    // filled circle
  done: '\u2714',      // check
  failed: '\u2716',    // x
};

const COLUMN_COLORS: Record<string, string> = {
  backlog: 'gray',
  running: 'yellow',
  review: 'blue',
  done: 'green',
  failed: 'red',
};

export function Card({
  task,
  isSelected,
  density,
}: CardProps): React.JSX.Element {
  const borderStyle = isSelected ? ('bold' as const) : ('round' as const);
  const borderColor = isSelected ? 'cyan' : (COLUMN_COLORS[task.column] ?? 'gray');
  const statusIcon = COLUMN_STATUS_ICON[task.column] ?? '\u25CB';

  if (density === 'compact') {
    return (
      <Box borderStyle={borderStyle} borderColor={borderColor} paddingX={1}>
        <Text color={borderColor}>{statusIcon} </Text>
        <Text wrap="truncate" bold={isSelected}>
          {task.name}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle}
      borderColor={borderColor}
      paddingX={1}
    >
      <Box>
        <Text color={borderColor}>{statusIcon} </Text>
        <Text bold wrap="truncate">
          {task.name}
        </Text>
      </Box>
      <Box gap={1}>
        <Text color="magenta">{task.agent}</Text>
        <Text dimColor>{task.model}</Text>
        <Text color="yellow">{formatElapsed(task.elapsedMs)}</Text>
        <Text color="green">{formatCost(task.costUsd)}</Text>
      </Box>
    </Box>
  );
}
