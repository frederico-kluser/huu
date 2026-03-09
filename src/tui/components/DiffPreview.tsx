// Diff preview — unified diff with color coding
//
// Shows file changes from an agent's work. Navigable per-file.
// +green, -red, @@cyan, headers in blue. Preserves +/- prefixes for accessibility.

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DiffFile } from '../types.js';

interface DiffPreviewProps {
  diffs: DiffFile[];
  height: number;
  isFocused: boolean;
}

const MAX_VISIBLE_LINES = 400;

function colorForDiffLine(
  line: string,
): { color?: string; dimColor?: boolean } {
  if (line.startsWith('+++') || line.startsWith('---'))
    return { color: 'blue' };
  if (line.startsWith('@@')) return { color: 'cyan' };
  if (line.startsWith('+')) return { color: 'green' };
  if (line.startsWith('-')) return { color: 'red' };
  return { dimColor: true };
}

export function DiffPreview({
  diffs,
  height,
  isFocused,
}: DiffPreviewProps): React.JSX.Element {
  const [fileIndex, setFileIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const safeFileIndex = Math.max(0, Math.min(fileIndex, diffs.length - 1));
  const currentFile = diffs[safeFileIndex];
  const contentHeight = Math.max(height - 4, 1);

  useInput(
    (_input, key) => {
      if (key.tab) {
        // Next file
        setFileIndex((prev) => (prev + 1) % Math.max(diffs.length, 1));
        setScrollOffset(0);
      } else if (key.upArrow) {
        setScrollOffset((prev) => Math.max(prev - 1, 0));
      } else if (key.downArrow) {
        if (currentFile) {
          setScrollOffset((prev) =>
            Math.min(prev + 1, Math.max(currentFile.lines.length - contentHeight, 0)),
          );
        }
      } else if (key.pageUp) {
        setScrollOffset((prev) => Math.max(prev - 10, 0));
      } else if (key.pageDown) {
        if (currentFile) {
          setScrollOffset((prev) =>
            Math.min(prev + 10, Math.max(currentFile.lines.length - contentHeight, 0)),
          );
        }
      }
    },
    { isActive: isFocused },
  );

  if (diffs.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        height={height}
      >
        <Box paddingX={1}>
          <Text bold>Diff</Text>
        </Box>
        <Box paddingX={1}>
          <Text dimColor>No file changes detected.</Text>
        </Box>
      </Box>
    );
  }

  const visibleLines = currentFile
    ? currentFile.lines.slice(scrollOffset, scrollOffset + Math.min(contentHeight, MAX_VISIBLE_LINES))
    : [];

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      height={height}
    >
      <Box paddingX={1}>
        <Text bold>Diff</Text>
        <Text dimColor>
          {' '}({safeFileIndex + 1}/{diffs.length}){' '}
        </Text>
        <Text>{currentFile?.path ?? '—'}</Text>
        {currentFile?.truncated && (
          <Text color="yellow"> (truncated, {currentFile.totalLines} total)</Text>
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleLines.map((line, i) => {
          const style = colorForDiffLine(line);
          return (
            <Text key={scrollOffset + i} wrap="truncate" {...style}>
              {line}
            </Text>
          );
        })}
      </Box>
      {diffs.length > 1 && (
        <Box paddingX={1}>
          <Text dimColor>Tab: next file</Text>
        </Box>
      )}
    </Box>
  );
}
