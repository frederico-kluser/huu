// Live log stream with scroll and follow-tail
//
// Keyboard: up/down/pageUp/pageDown/home/end for scrolling.
// Auto-scroll (follow tail) is active by default, disabled on manual scroll up,
// re-enabled when user presses End.

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { LogLine } from '../types.js';

interface LogStreamProps {
  logs: LogLine[];
  height: number;
  isFocused: boolean;
}

const PAGE_SIZE = 10;

const LEVEL_COLORS: Record<string, string> = {
  error: 'red',
  escalation: 'red',
  warn: 'yellow',
  info: 'white',
  progress: 'cyan',
};

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return ts.slice(11, 19);
  }
}

function levelTag(level: string): string {
  switch (level) {
    case 'error':
      return 'ERR';
    case 'escalation':
      return 'ESC';
    case 'warn':
      return 'WRN';
    case 'info':
      return 'INF';
    case 'progress':
      return 'PRG';
    default:
      return '???';
  }
}

export function visibleWindow(
  lines: LogLine[],
  height: number,
  scrollOffset: number,
): LogLine[] {
  const end = Math.max(lines.length - scrollOffset, 0);
  const start = Math.max(end - height, 0);
  return lines.slice(start, end);
}

export function LogStream({
  logs,
  height,
  isFocused,
}: LogStreamProps): React.JSX.Element {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [followTail, setFollowTail] = useState(true);

  // When follow-tail is active, always show the latest lines
  const effectiveOffset = followTail ? 0 : scrollOffset;
  const visible = visibleWindow(logs, Math.max(height - 2, 1), effectiveOffset);

  const scrollUp = useCallback(
    (amount: number) => {
      setFollowTail(false);
      setScrollOffset((prev) => Math.min(prev + amount, Math.max(logs.length - 1, 0)));
    },
    [logs.length],
  );

  const scrollDown = useCallback(
    (amount: number) => {
      setScrollOffset((prev) => {
        const next = Math.max(prev - amount, 0);
        if (next === 0) setFollowTail(true);
        return next;
      });
    },
    [],
  );

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        scrollUp(1);
      } else if (key.downArrow) {
        scrollDown(1);
      } else if (key.pageUp) {
        scrollUp(PAGE_SIZE);
      } else if (key.pageDown) {
        scrollDown(PAGE_SIZE);
      } else if (_input === 'G') {
        // End — go to bottom
        setScrollOffset(0);
        setFollowTail(true);
      } else if (_input === 'g') {
        // Home — go to top
        setFollowTail(false);
        setScrollOffset(Math.max(logs.length - 1, 0));
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      height={height}
    >
      <Box paddingX={1}>
        <Text bold>Logs</Text>
        <Text dimColor>
          {' '}({logs.length} lines{followTail ? ', follow' : `, +${effectiveOffset}`})
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visible.length === 0 ? (
          <Text dimColor>No log entries yet.</Text>
        ) : (
          visible.map((line) => (
            <Text key={line.id} wrap="truncate">
              <Text dimColor>{formatTimestamp(line.ts)} </Text>
              <Text color={LEVEL_COLORS[line.level] ?? 'white'}>
                [{levelTag(line.level)}]
              </Text>
              <Text> {line.message}</Text>
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
