import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import {
  scanDirectory,
  toggleNode,
  toggleExpand,
  flattenVisible,
  flattenSelected,
  selectAll,
  selectByPaths,
  expandAll,
} from '../../lib/file-scanner.js';
import type { FileNode } from '../../lib/types.js';

interface Props {
  repoRoot: string;
  initialSelection: string[];
  onCommit: (paths: string[]) => void;
  onCancel: () => void;
}

const PAGE_SIZE = 18;

export function FileMultiSelect({
  repoRoot,
  initialSelection,
  onCommit,
  onCancel,
}: Props): React.JSX.Element {
  const [tree, setTree] = useState<FileNode>(() => {
    const scanned = scanDirectory(repoRoot);
    return initialSelection.length > 0 ? selectByPaths(scanned, new Set(initialSelection)) : scanned;
  });
  const [filter, setFilter] = useState('');
  const [filterMode, setFilterMode] = useState(false);
  const [cursor, setCursor] = useState(0);

  const selectedFiles = useMemo(() => flattenSelected(tree), [tree]);

  const visible = useMemo(() => {
    const all = flattenVisible(tree);
    const f = filter.trim().toLowerCase();
    if (!f) return all;
    return all.filter(({ node }) => node.path.toLowerCase().includes(f));
  }, [tree, filter]);

  useEffect(() => {
    if (cursor >= visible.length) setCursor(Math.max(0, visible.length - 1));
  }, [visible.length, cursor]);

  useInput((input, key) => {
    if (filterMode) {
      if (key.return || key.escape) setFilterMode(false);
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onCommit(selectedFiles.slice().sort());
      return;
    }

    const current = visible[cursor];

    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(visible.length - 1, c + 1));
    } else if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.pageDown) {
      setCursor((c) => Math.min(visible.length - 1, c + PAGE_SIZE));
    } else if (key.pageUp) {
      setCursor((c) => Math.max(0, c - PAGE_SIZE));
    } else if (input === ' ') {
      if (!current) return;
      setTree((t) => toggleNode(t, current.node.path));
    } else if (key.rightArrow) {
      if (current?.node.isDirectory && !current.node.expanded) {
        setTree((t) => toggleExpand(t, current.node.path));
      }
    } else if (key.leftArrow) {
      if (current?.node.isDirectory && current.node.expanded) {
        setTree((t) => toggleExpand(t, current.node.path));
      }
    } else if (input === 'a' || input === 'A') {
      setTree((t) => selectAll(t, true));
    } else if (input === 'c' || input === 'C') {
      setTree((t) => selectAll(t, false));
    } else if (input === 'e' || input === 'E') {
      setTree((t) => expandAll(t));
    } else if (input === '/') {
      setFilterMode(true);
      setTree((t) => expandAll(t));
    }
  });

  const start = Math.max(0, Math.min(cursor - Math.floor(PAGE_SIZE / 2), Math.max(0, visible.length - PAGE_SIZE)));
  const visibleSlice = visible.slice(start, start + PAGE_SIZE);
  const totalSelected = selectedFiles.length;

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Box>
          <Text bold color="cyan">Select files</Text>
          <Text dimColor>  ·  </Text>
          {totalSelected === 0 ? (
            <Text color="yellow">no files selected → step will run on the whole project</Text>
          ) : (
            <Text color="green">{totalSelected} selected</Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text>Filter: </Text>
          {filterMode ? (
            <TextInput value={filter} onChange={setFilter} onSubmit={() => setFilterMode(false)} />
          ) : (
            <>
              <Text>{filter || <Text dimColor>(none)</Text>}</Text>
              <Text dimColor>   press / to edit</Text>
            </>
          )}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {visibleSlice.length === 0 && <Text dimColor>(no matching files)</Text>}
          {visibleSlice.map(({ node, depth }, i) => {
            const idx = start + i;
            const isCursor = idx === cursor;
            const indent = '  '.repeat(Math.max(0, depth - 1));
            const icon = node.isDirectory ? (node.expanded ? '▾' : '▸') : '•';
            const check = node.selected ? '[x]' : '[ ]';
            const color = isCursor ? 'cyan' : node.isDirectory ? 'blue' : node.selected ? 'green' : undefined;
            return (
              <Text key={node.path} color={color}>
                {isCursor ? '> ' : '  '}
                {indent}
                {check} {icon} {node.name}
              </Text>
            );
          })}
          {visible.length > PAGE_SIZE && (
            <Text dimColor>  · showing {start + 1}-{Math.min(start + PAGE_SIZE, visible.length)} of {visible.length}</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            <Text bold>↑↓</Text> navigate · <Text bold>←/→</Text> collapse/expand folder · <Text bold>SPACE</Text> toggle · <Text bold>E</Text> expand all
          </Text>
          <Text dimColor>
            <Text bold>A</Text> select all · <Text bold>C</Text> clear · <Text bold>/</Text> filter · <Text bold>ENTER</Text> confirm · <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
