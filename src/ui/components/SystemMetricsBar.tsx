import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useSystemMetrics } from '../hooks/useSystemMetrics.js';
import { useAutoscaleSnapshot } from '../autoscale-store.js';

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

const PULSE_COLORS: Array<'cyan' | 'magenta' | 'yellow' | 'green'> = ['cyan', 'magenta', 'yellow', 'green'];
const PULSE_INTERVAL_MS = 400;

/**
 * Always-on header showing system CPU%, system RAM%, and this process RSS.
 * Color codes: green <60%, yellow 60-85%, red >=85%.
 *
 * In autoscale mode (driven by the singleton in `autoscale-store.ts`), appends
 * a label that rotates through `cyan/magenta/yellow/green` every 400 ms —
 * a constant visual cue that the +/- keys are disabled and the Autoscaler
 * is in charge.
 */
export function SystemMetricsBar(): React.JSX.Element | null {
  const m = useSystemMetrics(1000);
  const autoscale = useAutoscaleSnapshot();
  const [pulseIdx, setPulseIdx] = useState(0);

  useEffect(() => {
    if (!autoscale.enabled) return;
    const id = setInterval(() => setPulseIdx((i) => (i + 1) % PULSE_COLORS.length), PULSE_INTERVAL_MS);
    id.unref?.();
    return () => clearInterval(id);
  }, [autoscale.enabled]);

  if (!m) return null;

  const pulseColor = PULSE_COLORS[pulseIdx]!;

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
      {m.source === 'host' && (
        <>
          <Text dimColor>  ·  </Text>
          <Text dimColor>(host metrics)</Text>
        </>
      )}
      {autoscale.enabled && (
        <>
          <Text dimColor>  ·  </Text>
          <Text bold color={pulseColor}>
            AUTO
          </Text>
          {autoscale.killedCount > 0 && (
            <Text dimColor> (killed {autoscale.killedCount})</Text>
          )}
        </>
      )}
    </Box>
  );
}
