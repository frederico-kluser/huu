// Context usage bar — visual gauge with color thresholds
//
// <= 70%: green (safe)
// 71-85%: yellow (attention)
// > 85%: red (high risk)
//
// Always shows numeric text alongside the bar for accessibility.

import React from 'react';
import { Box, Text } from 'ink';

interface ContextUsageBarProps {
  usedTokens: number;
  windowTokens: number;
  barWidth?: number;
}

function contextColor(pct: number): string {
  if (pct > 85) return 'red';
  if (pct > 70) return 'yellow';
  return 'green';
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function ContextUsageBar({
  usedTokens,
  windowTokens,
  barWidth = 30,
}: ContextUsageBarProps): React.JSX.Element {
  if (windowTokens <= 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Context: N/A</Text>
      </Box>
    );
  }

  const pct = Math.min(Math.round((usedTokens / windowTokens) * 100), 100);
  const filledCount = Math.round((pct / 100) * barWidth);
  const emptyCount = barWidth - filledCount;
  const color = contextColor(pct);

  const filled = '\u2588'.repeat(filledCount);
  const empty = '\u2591'.repeat(emptyCount);

  return (
    <Box paddingX={1}>
      <Text dimColor>Context </Text>
      <Text color={color}>{filled}</Text>
      <Text dimColor>{empty}</Text>
      <Text color={color}>
        {' '}{pct}% ({formatTokensShort(usedTokens)}/{formatTokensShort(windowTokens)})
      </Text>
    </Box>
  );
}
