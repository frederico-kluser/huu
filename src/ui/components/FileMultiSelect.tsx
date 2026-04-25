import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { listRepoFiles } from '../../lib/file-scanner.js';
import { useTerminalClear } from '../hooks/useTerminalClear.js';

interface Props {
  repoRoot: string;
  initialSelection: string[];
  onCommit: (paths: string[]) => void;
  onCancel: () => void;
}

const PAGE_SIZE = 15;

export function FileMultiSelect({
  repoRoot,
  initialSelection,
  onCommit,
  onCancel,
}: Props): React.JSX.Element {
  useTerminalClear();

  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [filterMode, setFilterMode] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));

  useEffect(() => {
    setAllFiles(listRepoFiles(repoRoot));
  }, [repoRoot]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return allFiles;
    return allFiles.filter((p) => p.toLowerCase().includes(f));
  }, [allFiles, filter]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1));
  }, [filtered.length, cursor]);

  useInput((input, key) => {
    if (filterMode) {
      if (key.return || key.escape) setFilterMode(false);
      return;
    }
    if (key.escape) {
      onCancel();
    } else if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
    } else if (input === ' ') {
      const path = filtered[cursor];
      if (!path) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    } else if (input === 'a' || input === 'A') {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const p of filtered) next.add(p);
        return next;
      });
    } else if (input === 'c' || input === 'C') {
      setSelected(new Set());
    } else if (input === '/') {
      setFilterMode(true);
    } else if (key.return) {
      onCommit(Array.from(selected).sort());
    }
  });

  const start = Math.max(0, Math.min(cursor - Math.floor(PAGE_SIZE / 2), filtered.length - PAGE_SIZE));
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const totalSelected = selected.size;

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
          {visible.length === 0 && <Text dimColor>(no matching files)</Text>}
          {visible.map((path, i) => {
            const idx = start + i;
            const isCursor = idx === cursor;
            const isSelected = selected.has(path);
            return (
              <Text key={path} color={isCursor ? 'cyan' : isSelected ? 'green' : undefined}>
                {isCursor ? '> ' : '  '}
                {isSelected ? '[x] ' : '[ ] '}
                {path}
              </Text>
            );
          })}
          {filtered.length > PAGE_SIZE && (
            <Text dimColor>  · showing {start + 1}-{Math.min(start + PAGE_SIZE, filtered.length)} of {filtered.length}</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            <Text bold>↑↓</Text> navigate · <Text bold>SPACE</Text> toggle · <Text bold>A</Text> select all · <Text bold>C</Text> clear all · <Text bold>/</Text> filter
          </Text>
          <Text dimColor>
            <Text bold>ENTER</Text> confirm (empty = whole project) · <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
