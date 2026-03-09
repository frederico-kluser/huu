// Metrics panel — tokens, cost, elapsed, model
//
// Compact 1-line-per-metric display for quick scanning.
// Shows N/A for missing data instead of misleading zeros.

import React from 'react';
import { Box, Text } from 'ink';
import type { TaskMetrics } from '../types.js';

interface MetricsPanelProps {
  metrics: TaskMetrics;
}

function formatTokens(n: number): string {
  if (n === 0) return 'N/A';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd === 0) return 'N/A';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatElapsed(ms: number): string {
  if (ms === 0) return 'N/A';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function MetricRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}): React.JSX.Element {
  return (
    <Box>
      <Text dimColor>{label}: </Text>
      {color ? <Text color={color}>{value}</Text> : <Text>{value}</Text>}
    </Box>
  );
}

export function MetricsPanel({
  metrics,
}: MetricsPanelProps): React.JSX.Element {
  const contextPct =
    metrics.contextWindowTokens > 0
      ? Math.round(
          (metrics.contextUsedTokens / metrics.contextWindowTokens) * 100,
        )
      : 0;

  const contextDisplay =
    metrics.contextWindowTokens > 0
      ? `${contextPct}% (${formatTokens(metrics.contextUsedTokens)}/${formatTokens(metrics.contextWindowTokens)})`
      : 'N/A';

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold>Metrics</Text>
      <MetricRow label="Model" value={metrics.model} />
      <MetricRow
        label="Tokens in"
        value={formatTokens(metrics.inputTokens)}
      />
      <MetricRow
        label="Tokens out"
        value={formatTokens(metrics.outputTokens)}
      />
      <MetricRow label="Context" value={contextDisplay} />
      <MetricRow
        label="Cost (est)"
        value={formatCost(metrics.costUsd)}
        color="green"
      />
      <MetricRow
        label="Elapsed"
        value={formatElapsed(metrics.elapsedMs)}
      />
    </Box>
  );
}
