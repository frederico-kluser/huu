// Cost View — breakdown by agent, model, phase
//
// Features:
// - KPIs: Total USD, Total tokens, Avg/task
// - Breakdown table by configurable dimension (agent/model/phase)
// - Sparkline trend (Unicode)
// - Keyboard: a group by agent, o group by model, p group by phase

import React, { useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CostDataProvider, CostGroupBy, CostBreakdownRow, Density } from '../types.js';
import { useCostData } from '../hooks/useSpecializedViewsData.js';

export interface CostViewProps {
  provider: CostDataProvider | undefined;
  isActive: boolean;
  density: Density;
}

// ── Formatting ──────────────────────────────────────────────────────

function fmtUsd(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  if (usd > 0) return `$${usd.toFixed(4)}`;
  return '$0.00';
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── Sparkline (Unicode block chars) ─────────────────────────────────

const SPARK_CHARS = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

function sparkline(data: number[]): string {
  if (data.length === 0) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  return data
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[idx];
    })
    .join('');
}

// ── Bar chart (ASCII) ───────────────────────────────────────────────

function pctBar(pct: number, width: number = 20): string {
  const filled = Math.round((pct / 100) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

// ── Component ───────────────────────────────────────────────────────

export function CostView({
  provider,
  isActive,
  density,
}: CostViewProps): React.JSX.Element {
  const { snapshot, groupBy, setGroupBy } = useCostData(provider, isActive);

  const handleInput = useCallback(
    (input: string) => {
      if (input === 'a') setGroupBy('agent');
      else if (input === 'o') setGroupBy('model');
      else if (input === 'p') setGroupBy('phase');
    },
    [setGroupBy],
  );

  useInput((input) => {
    if (!isActive) return;
    handleInput(input);
  });

  // Empty state
  if (!provider) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No cost provider available.</Text>
      </Box>
    );
  }

  if (snapshot.totalTokens === 0 && snapshot.totalCostUsd === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No cost data yet. Usage will appear as agents run.</Text>
      </Box>
    );
  }

  const isCompact = density === 'compact';
  const barWidth = isCompact ? 10 : 20;

  const GROUP_LABELS: Record<CostGroupBy, string> = {
    agent: 'Agent',
    model: 'Model',
    phase: 'Phase',
  };

  return (
    <Box flexDirection="column">
      {/* KPIs */}
      <Box paddingX={1} gap={2}>
        <Text bold>Cost Dashboard</Text>
        <Text>
          Total: <Text bold color="green">{fmtUsd(snapshot.totalCostUsd)}</Text>
        </Text>
        <Text>Tokens: {fmtTokens(snapshot.totalTokens)}</Text>
        <Text>Avg/task: {fmtUsd(snapshot.avgCostPerTask)}</Text>
        {snapshot.trend.length > 1 && (
          <Text dimColor>Trend: {sparkline(snapshot.trend)}</Text>
        )}
      </Box>

      {/* Grouping selector */}
      <Box paddingX={1} gap={1}>
        <Text dimColor>Group by:</Text>
        {(['agent', 'model', 'phase'] as const).map((g) => (
          <Text key={g} bold={g === groupBy} inverse={g === groupBy}>
            {' '}
            {GROUP_LABELS[g]}{' '}
          </Text>
        ))}
      </Box>

      {/* Table header */}
      <Box paddingX={1}>
        <Text bold dimColor>
          {isCompact
            ? `${GROUP_LABELS[groupBy].padEnd(16)} Prompt     Compl      Cost     %  Bar`
            : `${GROUP_LABELS[groupBy].padEnd(20)} Prompt Tokens  Compl Tokens   Cost USD     %   Distribution`}
        </Text>
      </Box>

      {/* Breakdown rows */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {snapshot.rows.map((row) => (
          <CostRow
            key={row.key}
            row={row}
            compact={isCompact}
            barWidth={barWidth}
          />
        ))}
      </Box>

      {/* Footer */}
      <Box paddingX={1} gap={2}>
        <Text dimColor>
          {isCompact
            ? 'a:agent o:model p:phase'
            : 'a group by agent | o group by model | p group by phase'}
        </Text>
      </Box>
    </Box>
  );
}

// ── Row component ───────────────────────────────────────────────────

function CostRow({
  row,
  compact,
  barWidth,
}: {
  row: CostBreakdownRow;
  compact: boolean;
  barWidth: number;
}): React.JSX.Element {
  const key = row.key.length > (compact ? 15 : 19)
    ? row.key.slice(0, compact ? 15 : 19)
    : row.key.padEnd(compact ? 15 : 19);

  return (
    <Text wrap="truncate">
      <Text>{key}</Text>
      {' '}
      <Text dimColor>{fmtTokens(row.promptTokens).padStart(compact ? 10 : 13)}</Text>
      {' '}
      <Text dimColor>{fmtTokens(row.completionTokens).padStart(compact ? 10 : 13)}</Text>
      {' '}
      <Text color="green" bold>{fmtUsd(row.costUsd).padStart(compact ? 8 : 11)}</Text>
      {' '}
      <Text>{String(row.pct).padStart(3)}%</Text>
      {' '}
      <Text color="cyan">{pctBar(row.pct, barWidth)}</Text>
    </Text>
  );
}
