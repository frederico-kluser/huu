// Detail View — deep dive into a single agent's work
//
// Combines LogStream, DiffPreview, MetricsPanel, ContextUsageBar,
// and InterventionReadiness into a single screen.
// ESC returns to Kanban. Tab toggles focus between log and diff panels.

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DetailSnapshot, Density } from '../types.js';
import { LogStream } from './LogStream.js';
import { DiffPreview } from './DiffPreview.js';
import { MetricsPanel } from './MetricsPanel.js';
import { ContextUsageBar } from './ContextUsageBar.js';
import { InterventionReadiness } from './InterventionReadiness.js';

interface DetailViewProps {
  snapshot: DetailSnapshot;
  density: Density;
  onClose: () => void;
  terminalRows: number;
}

type DetailFocus = 'logs' | 'diff';

export function DetailView({
  snapshot,
  density,
  onClose,
  terminalRows,
}: DetailViewProps): React.JSX.Element {
  const [focus, setFocus] = useState<DetailFocus>('logs');

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.tab) {
      setFocus((prev) => (prev === 'logs' ? 'diff' : 'logs'));
    }
  });

  const isCompact = density === 'compact';

  // Allocate vertical space
  const headerHeight = 3;
  const metricsHeight = 9; // metrics panel lines
  const contextBarHeight = 1;
  const interventionHeight = snapshot.interventionSignals.length + 4;
  const fixedHeight =
    headerHeight + metricsHeight + contextBarHeight + interventionHeight;
  const remainingHeight = Math.max(terminalRows - fixedHeight - 2, 6);
  const logHeight = Math.max(Math.floor(remainingHeight * 0.6), 4);
  const diffHeight = Math.max(remainingHeight - logHeight, 4);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box borderStyle="single" paddingX={1}>
        <Text bold>
          {snapshot.taskId} {snapshot.taskName}
        </Text>
        <Text dimColor>
          {' '} — {snapshot.agent} [{snapshot.column}]
        </Text>
        <Box flexGrow={1} />
        <Text dimColor>ESC: back | Tab: switch panel</Text>
      </Box>

      {isCompact ? (
        // Compact: stacked layout
        <Box flexDirection="column" flexGrow={1}>
          <ContextUsageBar
            usedTokens={snapshot.metrics.contextUsedTokens}
            windowTokens={snapshot.metrics.contextWindowTokens}
          />
          <LogStream
            logs={snapshot.logs}
            height={logHeight + diffHeight}
            isFocused={true}
          />
          <MetricsPanel metrics={snapshot.metrics} />
          <InterventionReadiness
            level={snapshot.interventionLevel}
            signals={snapshot.interventionSignals}
          />
        </Box>
      ) : (
        // Normal/Wide: side-by-side log+diff with sidebar
        <Box flexDirection="row" flexGrow={1}>
          {/* Main area: log + diff stacked */}
          <Box flexDirection="column" flexGrow={1}>
            <ContextUsageBar
              usedTokens={snapshot.metrics.contextUsedTokens}
              windowTokens={snapshot.metrics.contextWindowTokens}
            />
            <LogStream
              logs={snapshot.logs}
              height={logHeight}
              isFocused={focus === 'logs'}
            />
            <DiffPreview
              diffs={snapshot.diffs}
              height={diffHeight}
              isFocused={focus === 'diff'}
            />
          </Box>
          {/* Sidebar: metrics + intervention */}
          <Box flexDirection="column" width={32}>
            <MetricsPanel metrics={snapshot.metrics} />
            <InterventionReadiness
              level={snapshot.interventionLevel}
              signals={snapshot.interventionSignals}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
