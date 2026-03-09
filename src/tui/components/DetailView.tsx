// Detail View — deep dive into a single agent's work
//
// Combines LogStream, DiffPreview, MetricsPanel, ContextUsageBar,
// InterventionReadiness, InterventionBar, and InterventionInput
// into a single screen.
// ESC returns to Kanban. Tab toggles focus between log and diff panels.
// S/F/A/P activate intervention modes when not composing.

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DetailSnapshot, Density } from '../types.js';
import { LogStream } from './LogStream.js';
import { DiffPreview } from './DiffPreview.js';
import { MetricsPanel } from './MetricsPanel.js';
import { ContextUsageBar } from './ContextUsageBar.js';
import { InterventionReadiness } from './InterventionReadiness.js';
import { InterventionBar } from './InterventionBar.js';
import { InterventionInput } from './InterventionInput.js';
import type { InterventionMode, InterventionSubmission } from './InterventionInput.js';

interface DetailViewProps {
  snapshot: DetailSnapshot;
  density: Density;
  onClose: () => void;
  terminalRows: number;
  onIntervention?: ((submission: InterventionSubmission) => void) | undefined;
  pendingFollowUps?: number | undefined;
}

type DetailFocus = 'logs' | 'diff';

export function DetailView({
  snapshot,
  density,
  onClose,
  terminalRows,
  onIntervention,
  pendingFollowUps = 0,
}: DetailViewProps): React.JSX.Element {
  const [focus, setFocus] = useState<DetailFocus>('logs');
  const [interventionMode, setInterventionMode] = useState<InterventionMode | null>(null);

  const isComposing = interventionMode !== null;

  const handleInterventionSubmit = useCallback(
    (submission: InterventionSubmission) => {
      setInterventionMode(null);
      onIntervention?.(submission);
    },
    [onIntervention],
  );

  const handleInterventionCancel = useCallback(() => {
    setInterventionMode(null);
  }, []);

  useInput(
    (input, key) => {
      // Don't handle keys when composing an intervention
      if (isComposing) return;

      if (key.escape) {
        onClose();
        return;
      }
      if (key.tab) {
        setFocus((prev) => (prev === 'logs' ? 'diff' : 'logs'));
        return;
      }

      // Intervention shortcuts
      if (input === 's' || input === 'S') {
        if (snapshot.column === 'running') {
          setInterventionMode('steer');
        }
        return;
      }
      if (input === 'f' || input === 'F') {
        if (snapshot.column === 'running') {
          setInterventionMode('follow-up');
        }
        return;
      }
      if (input === 'a' || input === 'A') {
        if (snapshot.column === 'running' || snapshot.column === 'review') {
          setInterventionMode('abort');
        }
        return;
      }
      if (input === 'p' || input === 'P') {
        if (snapshot.column === 'done') {
          setInterventionMode('promote');
        }
        return;
      }
    },
    { isActive: !isComposing },
  );

  const isCompact = density === 'compact';

  // Allocate vertical space
  const headerHeight = 3;
  const metricsHeight = 9;
  const contextBarHeight = 1;
  const interventionBarHeight = 1;
  const interventionHeight = snapshot.interventionSignals.length + 4;
  const inputHeight = isComposing ? 4 : 0;
  const fixedHeight =
    headerHeight + metricsHeight + contextBarHeight +
    interventionBarHeight + interventionHeight + inputHeight;
  const remainingHeight = Math.max(terminalRows - fixedHeight - 2, 6);
  const logHeight = Math.max(Math.floor(remainingHeight * 0.6), 4);
  const diffHeight = Math.max(remainingHeight - logHeight, 4);

  const helpText = isComposing
    ? 'ESC: cancel'
    : 'ESC: back | Tab: switch | S/F/A/P: intervene';

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
        <Text dimColor>{helpText}</Text>
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
          <InterventionBar
            column={snapshot.column}
            activeMode={interventionMode}
            pendingFollowUps={pendingFollowUps}
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
            <InterventionBar
              column={snapshot.column}
              activeMode={interventionMode}
              pendingFollowUps={pendingFollowUps}
            />
          </Box>
        </Box>
      )}

      {/* Intervention input area */}
      {interventionMode && (
        <InterventionInput
          mode={interventionMode}
          isActive={isComposing}
          onSubmit={handleInterventionSubmit}
          onCancel={handleInterventionCancel}
        />
      )}
    </Box>
  );
}
