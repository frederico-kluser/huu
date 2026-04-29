import React from 'react';
import { Box, Text } from 'ink';
import { useSystemMetrics } from '../hooks/useSystemMetrics.js';

function colorFor(percent: number): 'green' | 'yellow' | 'red' {
  if (percent >= 85) return 'red';
  if (percent >= 60) return 'yellow';
  return 'green';
}

function fmtGb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}

function fmtMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0);
}

function pad2(n: number): string {
  return n.toFixed(0).padStart(2, ' ');
}

/**
 * Always-on header showing system CPU%, system RAM%, and this process RSS.
 * Color codes: green <60%, yellow 60-85%, red >=85% — visual cue for whether
 * to raise (+) or lower (-) the orchestrator concurrency.
 */
export function SystemMetricsBar(): React.JSX.Element | null {
  const m = useSystemMetrics(1000);
  if (!m) return null;

  return (
    <Box paddingX={1} width="100%">
      <Text dimColor>CPU </Text>
      <Text bold color={colorFor(m.cpuPercent)}>
        {pad2(m.cpuPercent)}%
      </Text>
      <Text dimColor>  ·  RAM </Text>
      <Text bold color={colorFor(m.memPercent)}>
        {pad2(m.memPercent)}%
      </Text>
      <Text dimColor>
        {' '}
        ({fmtGb(m.memUsedBytes)}/{fmtGb(m.memTotalBytes)} GB)
      </Text>
      <Text dimColor>  ·  proc </Text>
      <Text bold>{fmtMb(m.processRssBytes)} MB</Text>
      {m.loadAvg1 > 0 && (
        <>
          <Text dimColor>  ·  load </Text>
          <Text bold>{m.loadAvg1.toFixed(2)}</Text>
        </>
      )}
    </Box>
  );
}
