// Beat Sheet View — hierarchical progress with checkpoints
//
// Features:
// - 4-level tree: Objective → Act → Sequence → Task
// - Expand/collapse with → / ←
// - Checkpoint lane showing 5 mandatory checkpoints
// - Status indicators with symbols + colors
// - Keyboard: ↑/↓ navigate, →/← expand/collapse, Home/End jump

import React, { useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  BeatSheetDataProvider,
  BeatNode,
  BeatNodeType,
  BeatViewStatus,
  CheckpointView,
  Density,
} from '../types.js';
import { useBeatSheetData } from '../hooks/useSpecializedViewsData.js';

export interface BeatSheetViewProps {
  provider: BeatSheetDataProvider | undefined;
  isActive: boolean;
  density: Density;
  terminalRows?: number | undefined;
}

// ── Status symbols ──────────────────────────────────────────────────

const STATUS_SYMBOL: Record<BeatViewStatus, string> = {
  pending: '\u25CB',  // ○
  running: '\u25B6',  // ▶
  done: '\u2714',     // ✔
  blocked: '\u2718',  // ✘
};

const STATUS_COLOR: Record<BeatViewStatus, string> = {
  pending: 'gray',
  running: 'blue',
  done: 'green',
  blocked: 'red',
};

// ── Node type icons ─────────────────────────────────────────────────

const TYPE_ICON: Record<BeatNodeType, string> = {
  objective: '\u25C6',  // ◆
  act: '\u25A0',        // ■
  sequence: '\u25B8',   // ▸
  task: '\u2022',       // •
};

// ── Checkpoint symbols ──────────────────────────────────────────────

const CHECKPOINT_SYMBOL: Record<BeatViewStatus, string> = {
  pending: '\u25CB',  // ○
  running: '\u25D4',  // ◔
  done: '\u25CF',     // ●
  blocked: '\u2718',  // ✘
};

// ── Component ───────────────────────────────────────────────────────

export function BeatSheetView({
  provider,
  isActive,
  density,
  terminalRows = 24,
}: BeatSheetViewProps): React.JSX.Element {
  const {
    snapshot,
    visibleNodes,
    expandedIds,
    selectedIndex,
    setSelectedIndex,
    toggleExpand,
    expandNode,
    collapseNode,
  } = useBeatSheetData(provider, isActive);

  const visibleCount = Math.max(terminalRows - 8, 5);

  // Handle input
  useInput((input, key) => {
    if (!isActive) return;

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(visibleNodes.length - 1, prev + 1));
    } else if (key.rightArrow) {
      const node = visibleNodes[selectedIndex];
      if (node && node.type !== 'task') {
        if (!expandedIds.has(node.id)) {
          expandNode(node.id);
        } else {
          // Move to first child
          const childIdx = visibleNodes.findIndex(
            (n) => n.parentId === node.id,
          );
          if (childIdx >= 0) setSelectedIndex(childIdx);
        }
      }
    } else if (key.leftArrow) {
      const node = visibleNodes[selectedIndex];
      if (node) {
        if (expandedIds.has(node.id)) {
          collapseNode(node.id);
        } else if (node.parentId) {
          // Move to parent
          const parentIdx = visibleNodes.findIndex(
            (n) => n.id === node.parentId,
          );
          if (parentIdx >= 0) setSelectedIndex(parentIdx);
        }
      }
    } else if (input === 'H' || (key as { meta?: boolean }).meta) {
      // Home — not easily detected, use first visible
    }
  });

  // Empty state
  if (!provider) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No beat sheet provider available.</Text>
      </Box>
    );
  }

  if (snapshot.nodes.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No beat sheet data. A plan will appear after decomposition.</Text>
      </Box>
    );
  }

  // Compute scroll window
  const scrollStart = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(visibleCount / 2),
      visibleNodes.length - visibleCount,
    ),
  );
  const windowNodes = visibleNodes.slice(
    scrollStart,
    scrollStart + visibleCount,
  );

  const isCompact = density === 'compact';

  return (
    <Box flexDirection="column">
      {/* Header: overall progress */}
      <Box paddingX={1} gap={2}>
        <Text bold>Beat Sheet</Text>
        <Text>
          Progress:{' '}
          <Text bold color={snapshot.overallProgressPct >= 100 ? 'green' : 'blue'}>
            {snapshot.overallProgressPct}%
          </Text>
        </Text>
        <Text dimColor>
          Nodes: {snapshot.nodes.length}
        </Text>
      </Box>

      {/* Checkpoint lane */}
      {snapshot.checkpoints.length > 0 && (
        <Box paddingX={1} gap={1}>
          {snapshot.checkpoints.map((cp) => (
            <CheckpointBadge key={cp.name} checkpoint={cp} compact={isCompact} />
          ))}
        </Box>
      )}

      {/* Tree */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {windowNodes.map((node, windowIdx) => {
          const absoluteIdx = scrollStart + windowIdx;
          const hasChildren =
            node.type !== 'task' &&
            snapshot.nodes.some((n) => n.parentId === node.id);
          const isExpanded = expandedIds.has(node.id);

          return (
            <TreeNodeRow
              key={node.id}
              node={node}
              selected={absoluteIdx === selectedIndex}
              hasChildren={hasChildren}
              isExpanded={isExpanded}
              compact={isCompact}
            />
          );
        })}
      </Box>

      {/* Footer */}
      <Box paddingX={1} gap={2}>
        <Text dimColor>
          {visibleNodes.length > 0
            ? `${selectedIndex + 1}/${visibleNodes.length}`
            : 'empty'}
        </Text>
        <Text dimColor>
          {isCompact
            ? '\u2191\u2193 \u2190\u2192'
            : '\u2191/\u2193 navigate | \u2192 expand | \u2190 collapse'}
        </Text>
      </Box>
    </Box>
  );
}

// ── Tree node row ───────────────────────────────────────────────────

function TreeNodeRow({
  node,
  selected,
  hasChildren,
  isExpanded,
  compact,
}: {
  node: BeatNode;
  selected: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  compact: boolean;
}): React.JSX.Element {
  const indent = '  '.repeat(node.depth);
  const expandGlyph = hasChildren ? (isExpanded ? '\u25BE' : '\u25B8') : ' ';
  const icon = TYPE_ICON[node.type];
  const statusSym = STATUS_SYMBOL[node.status];
  const statusCol = STATUS_COLOR[node.status];

  const progressText =
    node.type !== 'task'
      ? ` ${node.progressPct}%`
      : '';

  return (
    <Text wrap="truncate" inverse={selected} bold={selected}>
      <Text dimColor>{indent}</Text>
      <Text>{expandGlyph}</Text>
      {' '}
      <Text color={statusCol}>{statusSym}</Text>
      {' '}
      <Text dimColor>{icon}</Text>
      {' '}
      <Text>{node.title}</Text>
      {progressText && (
        <Text dimColor>{progressText}</Text>
      )}
    </Text>
  );
}

// ── Checkpoint badge ────────────────────────────────────────────────

function CheckpointBadge({
  checkpoint,
  compact,
}: {
  checkpoint: CheckpointView;
  compact: boolean;
}): React.JSX.Element {
  const sym = CHECKPOINT_SYMBOL[checkpoint.status];
  const color = STATUS_COLOR[checkpoint.status];
  const label = compact
    ? checkpoint.label.slice(0, 3)
    : checkpoint.label;

  return (
    <Text>
      <Text color={color}>{sym}</Text>
      {' '}
      <Text dimColor>{label}</Text>
    </Text>
  );
}
