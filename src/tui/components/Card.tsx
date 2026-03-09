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

export function Card({
  task,
  isSelected,
  density,
}: CardProps): React.JSX.Element {
  const borderStyle = isSelected ? ('bold' as const) : ('single' as const);
  const colorProps = isSelected ? { borderColor: 'cyan' as const } : {};

  if (density === 'compact') {
    return (
      <Box borderStyle={borderStyle} {...colorProps}>
        <Text wrap="truncate">
          {task.id} {task.name}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle}
      {...colorProps}
      paddingX={1}
    >
      <Text bold wrap="truncate">
        {task.id} {task.name}
      </Text>
      <Box>
        <Text dimColor>
          {task.agent} {task.model}
        </Text>
        <Text> {formatElapsed(task.elapsedMs)} </Text>
        <Text color="green">{formatCost(task.costUsd)}</Text>
      </Box>
    </Box>
  );
}
