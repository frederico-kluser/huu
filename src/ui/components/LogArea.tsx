import React from 'react';
import { Box, Text } from 'ink';
import type { LogEntry } from '../../lib/types.js';

// Self-contained sidebar log viewer, matched in spirit to pi-orq's log-area
// but using this project's LogEntry type. Render rules:
//   • Pure function of props — no setState, no setInterval.
//   • Owns its own border so the dashboard can drop it next to the kanban
//     without bespoke wrapper styling.
//   • Slices the tail of `logs` to `maxLines` so a long-running session
//     can't outgrow the visible budget.

const LEVEL_COLOR: Record<LogEntry['level'], string> = {
  info: 'white',
  warn: 'yellow',
  error: 'red',
  debug: 'gray',
};

export interface LogAreaProps {
  logs: ReadonlyArray<LogEntry>;
  /**
   * When set, render only entries whose `agentId` matches. `null`/`undefined`
   * shows every entry (orchestrator, integrator, all agents).
   */
  filterAgentId?: number | null;
  /** Visible row budget. The component renders the last `maxLines` entries. */
  maxLines: number;
  /**
   * Run start in ms. When supplied, timestamps render as `+MM:SS.s` elapsed
   * since run start (matching pi-orq); otherwise we fall back to wall-clock.
   */
  runStartedAt?: number;
  /** Fixed width column. Use to give the sidebar a stable footprint. */
  width?: number;
  /** Highlight title in cyan when the panel is the active focus target. */
  isActive?: boolean;
}

export function LogArea({
  logs,
  filterAgentId,
  maxLines,
  runStartedAt,
  width,
  isActive = false,
}: LogAreaProps): React.JSX.Element {
  const hasFilter = filterAgentId !== undefined && filterAgentId !== null;
  const filtered = hasFilter ? logs.filter((l) => l.agentId === filterAgentId) : logs;
  const budget = Math.max(1, maxLines);
  const visible = filtered.slice(-budget);

  const titleLabel = hasFilter ? `Logs (${formatAgentLabel(filterAgentId!)})` : 'Logs (all)';
  const titleColor = isActive ? 'cyan' : 'magenta';

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={titleColor}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={titleColor}>
          {titleLabel}
        </Text>
        <Text color="gray" dimColor>
          {filtered.length} evt
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visible.length === 0 ? (
          <Text color="gray" dimColor>
            Aguardando eventos...
          </Text>
        ) : (
          visible.map((entry, idx) => (
            <LogRow
              key={`${entry.timestamp}-${idx}`}
              entry={entry}
              runStartedAt={runStartedAt}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

function LogRow({
  entry,
  runStartedAt,
}: {
  entry: LogEntry;
  runStartedAt?: number;
}): React.JSX.Element {
  const stamp = runStartedAt
    ? formatElapsed(entry.timestamp - runStartedAt)
    : formatClock(entry.timestamp);
  const agent = formatAgentLabel(entry.agentId);
  return (
    <Text wrap="truncate-end">
      <Text color="gray">{stamp}</Text>
      <Text color="cyan" bold>{` ${agent}`}</Text>
      <Text color={LEVEL_COLOR[entry.level]}>{` ${entry.message}`}</Text>
    </Text>
  );
}

export function formatAgentLabel(agentId: number): string {
  if (agentId < 0) return 'ORQ';
  if (agentId === 9999) return 'INT';
  return `A${String(agentId).padStart(2, '0')}`;
}

function formatElapsed(ms: number): string {
  const safe = Math.max(0, ms);
  const min = Math.floor(safe / 60000);
  const sec = ((safe % 60000) / 1000).toFixed(1).padStart(4, '0');
  return `+${String(min).padStart(2, '0')}:${sec}`;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
