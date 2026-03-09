// Merge Queue View — FIFO queue with tier indicators
//
// Features:
// - Summary: queue length, running, blocked, avg wait
// - Table: Pos | Task | Branch | Tier | Status | Wait | Retries
// - Detail panel on Enter: tier history + last error
// - Color-coded tiers: T1 green, T2 cyan, T3 yellow, T4 magenta
// - Status badges with textual symbols

import React, { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { MergeQueueDataProvider, MergeQueueItemView, MergeViewStatus, MergeViewTier, Density } from '../types.js';
import { useMergeQueueData } from '../hooks/useSpecializedViewsData.js';

export interface MergeQueueViewProps {
  provider: MergeQueueDataProvider | undefined;
  isActive: boolean;
  density: Density;
}

// ── Status styling ──────────────────────────────────────────────────

const STATUS_BADGE: Record<MergeViewStatus, string> = {
  queued: '\u25CB QUE',   // ○
  running: '\u25B6 RUN',  // ▶
  blocked: '\u2718 BLK',  // ✘
  merged: '\u2714 MRG',   // ✔
  failed: '\u2718 FAIL',  // ✘
};

const STATUS_COLOR: Record<MergeViewStatus, string> = {
  queued: 'white',
  running: 'blue',
  blocked: 'red',
  merged: 'green',
  failed: 'red',
};

// ── Tier styling ────────────────────────────────────────────────────

const TIER_COLOR: Record<MergeViewTier, string> = {
  1: 'green',
  2: 'cyan',
  3: 'yellow',
  4: 'magenta',
};

// ── Time formatting ─────────────────────────────────────────────────

function fmtWait(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m${String(remSeconds).padStart(2, '0')}s`;
}

// ── Component ───────────────────────────────────────────────────────

export function MergeQueueView({
  provider,
  isActive,
  density,
}: MergeQueueViewProps): React.JSX.Element {
  const {
    snapshot,
    filteredItems,
    selectedIndex,
    setSelectedIndex,
    expandedId,
    setExpandedId,
    statusFilter,
    setStatusFilter,
  } = useMergeQueueData(provider, isActive);

  const handleInput = useCallback(
    (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean }) => {
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(filteredItems.length - 1, prev + 1));
      } else if (key.return) {
        const item = filteredItems[selectedIndex];
        if (item) {
          setExpandedId((prev) => (prev === item.id ? null : item.id));
        }
      } else if (input === 'f') {
        // Cycle through status filters
        const filters: (string | null)[] = [null, 'queued', 'running', 'blocked', 'merged', 'failed'];
        const idx = filters.indexOf(statusFilter);
        setStatusFilter(filters[(idx + 1) % filters.length]);
      }
    },
    [filteredItems, selectedIndex, statusFilter, setSelectedIndex, setExpandedId, setStatusFilter],
  );

  useInput((input, key) => {
    if (!isActive) return;
    handleInput(input, key);
  });

  // Empty state
  if (!provider) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No merge queue provider available.</Text>
      </Box>
    );
  }

  if (snapshot.items.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No entries in merge queue. Items will appear when agents complete work.</Text>
      </Box>
    );
  }

  const isCompact = density === 'compact';

  return (
    <Box flexDirection="column">
      {/* Summary */}
      <Box paddingX={1} gap={2}>
        <Text bold>Merge Queue</Text>
        <Text>Queue: {snapshot.queueLength}</Text>
        <Text color="blue">Running: {snapshot.runningCount}</Text>
        <Text color="red">Blocked: {snapshot.blockedCount}</Text>
        <Text dimColor>Avg Wait: {fmtWait(snapshot.avgWaitMs)}</Text>
        {statusFilter && (
          <Text color="cyan">[Filter: {statusFilter}]</Text>
        )}
      </Box>

      {/* Table header */}
      <Box paddingX={1}>
        <Text bold dimColor>
          {isCompact
            ? ' # Task           Branch         Tier Status  Wait   Ret'
            : ' #  Task              Branch                 Tier  Status     Wait       Retries'}
        </Text>
      </Box>

      {/* Table rows */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {filteredItems.map((item, idx) => (
          <Box key={item.id} flexDirection="column">
            <MergeRow
              item={item}
              selected={idx === selectedIndex}
              compact={isCompact}
            />
            {expandedId === item.id && (
              <MergeDetail item={item} />
            )}
          </Box>
        ))}
      </Box>

      {/* Footer */}
      <Box paddingX={1} gap={2}>
        <Text dimColor>
          {isCompact
            ? '\u2191\u2193 Enter f'
            : '\u2191/\u2193 navigate | Enter detail | f filter'}
        </Text>
      </Box>
    </Box>
  );
}

// ── Row component ───────────────────────────────────────────────────

function MergeRow({
  item,
  selected,
  compact,
}: {
  item: MergeQueueItemView;
  selected: boolean;
  compact: boolean;
}): React.JSX.Element {
  const tierText = item.currentTier ? `T${item.currentTier}` : '--';
  const tierColor = item.currentTier ? TIER_COLOR[item.currentTier] : 'gray';
  const statusText = STATUS_BADGE[item.status];
  const statusColor = STATUS_COLOR[item.status];

  const pos = item.position > 0 ? String(item.position).padStart(2, ' ') : ' -';
  const taskId = item.taskId.length > (compact ? 14 : 18)
    ? item.taskId.slice(0, compact ? 14 : 18)
    : item.taskId.padEnd(compact ? 14 : 18);
  const branch = item.branch.length > (compact ? 14 : 22)
    ? item.branch.slice(0, compact ? 14 : 22)
    : item.branch.padEnd(compact ? 14 : 22);
  const wait = fmtWait(item.waitMs).padStart(compact ? 6 : 10);
  const retries = String(item.retries).padStart(compact ? 3 : 7);

  return (
    <Text wrap="truncate" inverse={selected} bold={selected}>
      {pos} <Text>{taskId}</Text> <Text dimColor>{branch}</Text>{' '}
      <Text color={tierColor} bold>{tierText.padEnd(4)}</Text>
      {' '}
      <Text color={statusColor}>{statusText.padEnd(compact ? 7 : 10)}</Text>
      {' '}
      <Text>{wait}</Text>
      {' '}
      <Text dimColor>{retries}</Text>
    </Text>
  );
}

// ── Detail panel ────────────────────────────────────────────────────

function MergeDetail({
  item,
}: {
  item: MergeQueueItemView;
}): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      paddingX={3}
      paddingY={0}
      borderStyle="single"
      borderColor="gray"
    >
      <Text>
        <Text bold>Request:</Text> {item.taskId}
      </Text>
      <Text>
        <Text bold>Branch:</Text> {item.branch}
      </Text>
      <Text>
        <Text bold>Tier:</Text>{' '}
        {item.currentTier ? (
          <Text color={TIER_COLOR[item.currentTier]} bold>
            T{item.currentTier}
          </Text>
        ) : (
          <Text dimColor>not set</Text>
        )}
      </Text>
      <Text>
        <Text bold>Retries:</Text> {item.retries}
      </Text>
      {item.lastError && (
        <Text>
          <Text bold color="red">Error:</Text>{' '}
          <Text color="red">{item.lastError}</Text>
        </Text>
      )}
    </Box>
  );
}
