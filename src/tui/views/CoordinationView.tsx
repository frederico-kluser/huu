// Coordination overhead metrics view — displayed in the [C]ost tab
//
// Shows:
// - coordination_overhead_ratio with semaphore (green/yellow/red)
// - Queue stats: p50/p95 wait, merge wait, tasks/s
// - Scheduler status: running/pending/saturated
// - Decomposition: queue wait + merge wait + lock wait

import React from 'react';
import { Box, Text } from 'ink';
import type { CoordinationMetricsSnapshot, OverheadLevel, Density } from '../types.js';

export interface CoordinationViewProps {
  metrics: CoordinationMetricsSnapshot | null;
  density: Density;
}

const LEVEL_COLORS: Record<OverheadLevel, string> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
};

const LEVEL_LABELS: Record<OverheadLevel, string> = {
  green: 'LOW',
  yellow: 'MODERATE',
  red: 'HIGH',
};

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function CoordinationView({
  metrics,
  density,
}: CoordinationViewProps): React.JSX.Element {
  if (!metrics || metrics.taskCount === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No coordination metrics yet.</Text>
      </Box>
    );
  }

  const isCompact = density === 'compact';
  const color = LEVEL_COLORS[metrics.level];
  const label = LEVEL_LABELS[metrics.level];

  return (
    <Box flexDirection="column">
      {/* Header with ratio */}
      <Box paddingX={1} gap={2}>
        <Text bold>Coordination Overhead</Text>
        <Text>
          Ratio:{' '}
          <Text bold color={color}>
            {fmtRatio(metrics.ratio)} [{label}]
          </Text>
        </Text>
        <Text>Tasks: {metrics.taskCount}</Text>
        <Text>Throughput: {metrics.tasksPerSecond} tasks/s</Text>
      </Box>

      {/* Breakdown */}
      <Box paddingX={1} gap={isCompact ? 1 : 3}>
        <Text dimColor>
          Coord: {fmtMs(metrics.coordinationMs)}
        </Text>
        <Text dimColor>
          Exec: {fmtMs(metrics.executionMs)}
        </Text>
        <Text dimColor>
          Queue p50: {fmtMs(metrics.p50QueueWaitMs)}
        </Text>
        <Text dimColor>
          Queue p95: {fmtMs(metrics.p95QueueWaitMs)}
        </Text>
        <Text dimColor>
          Merge wait: {fmtMs(metrics.avgMergeWaitMs)}
        </Text>
      </Box>

      {/* Scheduler status */}
      <Box paddingX={1} gap={2}>
        <Text dimColor>
          Scheduler: {metrics.schedulerRunning} running, {metrics.schedulerPending} pending
        </Text>
        {metrics.schedulerSaturated && (
          <Text color="yellow" bold>SATURATED</Text>
        )}
      </Box>
    </Box>
  );
}
