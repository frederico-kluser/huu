// Logs View — aggregated log timeline from all agents
//
// Features:
// - Unified timeline from messages + audit_log
// - Filterable by agent, level, text search (substring/regex)
// - Color-coded by level with textual badges
// - Buffer circular (max 5000 entries in memory)
// - Keyboard: ↑/↓ scroll, / search, f filter, e errors-only, g jump to end

import React, { useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { LogsDataProvider, AggregatedLogEntry, LogLevel, Density } from '../types.js';
import { useLogsData } from '../hooks/useSpecializedViewsData.js';

export interface LogsViewProps {
  provider: LogsDataProvider | undefined;
  isActive: boolean;
  density: Density;
  terminalRows?: number | undefined;
}

// ── Level styling ───────────────────────────────────────────────────

const LEVEL_BADGE: Record<LogLevel, string> = {
  error: '[ERR]',
  warn: '[WRN]',
  info: '[INF]',
  debug: '[DBG]',
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  error: 'red',
  warn: 'yellow',
  info: 'blue',
  debug: 'gray',
};

// ── Agent color palette (stable hash) ───────────────────────────────

const AGENT_COLORS = [
  'cyan',
  'green',
  'magenta',
  'yellow',
  'blue',
  'white',
  'redBright',
  'greenBright',
] as const;

function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length] ?? 'white';
}

// ── Time formatting ─────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// ── Component ───────────────────────────────────────────────────────

export function LogsView({
  provider,
  isActive,
  density,
  terminalRows = 24,
}: LogsViewProps): React.JSX.Element {
  const {
    entries,
    counts,
    filter,
    setFilter,
    scrollOffset,
    setScrollOffset,
  } = useLogsData(provider, isActive);

  const visibleCount = Math.max(terminalRows - 5, 5);

  // Compute visible window
  const visibleEntries = useMemo(() => {
    const start = Math.max(0, entries.length - visibleCount - scrollOffset);
    const end = start + visibleCount;
    return entries.slice(start, end);
  }, [entries, visibleCount, scrollOffset]);

  const handleInput = useCallback(
    (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean }) => {
      if (key.upArrow) {
        setScrollOffset((prev) => Math.min(prev + 1, Math.max(0, entries.length - visibleCount)));
      } else if (key.downArrow) {
        setScrollOffset((prev) => Math.max(0, prev - 1));
      } else if (input === 'e') {
        // Toggle errors-only filter
        setFilter((prev) => ({
          ...prev,
          levels: prev.levels.length === 1 && prev.levels[0] === 'error'
            ? []
            : ['error'],
        }));
      } else if (input === 'g') {
        // Jump to end (latest)
        setScrollOffset(0);
      }
    },
    [entries.length, visibleCount, setScrollOffset, setFilter],
  );

  useInput((input, key) => {
    if (!isActive) return;
    handleInput(input, key);
  });

  // Empty state
  if (!provider) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No log provider available. Logs will appear when the orchestrator is running.</Text>
      </Box>
    );
  }

  if (entries.length === 0 && counts.total === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No log entries yet. Waiting for agent activity...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header: counters + active filters */}
      <Box paddingX={1} gap={2}>
        <Text bold>Logs</Text>
        <Text>Total: {counts.total}</Text>
        <Text color="red">Errors: {counts.errors}</Text>
        <Text color="yellow">Warns: {counts.warns}</Text>
        <Text dimColor>Agents: {counts.agentCount}</Text>
        {filter.levels.length > 0 && (
          <Text color="cyan">[Filter: {filter.levels.join(',')}]</Text>
        )}
        {filter.search && (
          <Text color="cyan">[Search: {filter.search}]</Text>
        )}
      </Box>

      {/* Log entries */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleEntries.map((entry) => (
          <LogLine key={entry.id} entry={entry} compact={density === 'compact'} />
        ))}
      </Box>

      {/* Footer: scroll position + shortcuts */}
      <Box paddingX={1} gap={2}>
        <Text dimColor>
          {entries.length > 0
            ? `${Math.max(1, entries.length - scrollOffset - visibleCount + 1)}-${entries.length - scrollOffset} of ${entries.length}`
            : '0 entries'}
        </Text>
        <Text dimColor>
          {density === 'compact'
            ? '\u2191\u2193 e g'
            : '\u2191/\u2193 scroll | e errors | g end'}
        </Text>
      </Box>
    </Box>
  );
}

// ── Log line component ──────────────────────────────────────────────

function LogLine({
  entry,
  compact,
}: {
  entry: AggregatedLogEntry;
  compact: boolean;
}): React.JSX.Element {
  const color = LEVEL_COLOR[entry.level];
  const badge = LEVEL_BADGE[entry.level];
  const aColor = agentColor(entry.agentId);

  if (compact) {
    return (
      <Text wrap="truncate">
        <Text dimColor>{fmtTime(entry.ts)}</Text>
        {' '}
        <Text color={color}>{badge}</Text>
        {' '}
        <Text color={aColor}>{entry.agentId}</Text>
        {' '}
        <Text>{entry.message}</Text>
      </Text>
    );
  }

  return (
    <Text wrap="truncate">
      <Text dimColor>{fmtTime(entry.ts)}</Text>
      {' '}
      <Text color={aColor}>[{entry.agentId}]</Text>
      {' '}
      <Text color={color} bold>{badge}</Text>
      {' '}
      <Text>{entry.message}</Text>
    </Text>
  );
}
