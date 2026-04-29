import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  selectByRegex,
  countRegexMatches,
  expandAll,
} from '../../lib/file-scanner.js';
import type { FileNode } from '../../lib/types.js';

function compileSmartCase(pattern: string): RegExp {
  const flags = /[A-Z]/.test(pattern) ? '' : 'i';
  return new RegExp(pattern, flags);
}

export interface PreviousStepFiles {
  /** Original 0-based index in the pipeline (used for display as #N). */
  index: number;
  name: string;
  files: string[];
}

interface Props {
  repoRoot: string;
  initialSelection: string[];
  /** Earlier pipeline steps with at least one selected file. Enables the "copy from previous step" modal. */
  previousSteps?: PreviousStepFiles[];
  onCommit: (paths: string[]) => void;
  onCancel: () => void;
}

const PAGE_SIZE = 18;

export function FileMultiSelect({
  repoRoot,
  initialSelection,
  previousSteps,
  onCommit,
  onCancel,
}: Props): React.JSX.Element {
  const [tree, setTree] = useState<FileNode>(() => {
    const scanned = scanDirectory(repoRoot);
    return initialSelection.length > 0 ? selectByPaths(scanned, new Set(initialSelection)) : scanned;
  });
  const [filter, setFilter] = useState('');
  const [filterMode, setFilterMode] = useState(false);
  const [regexPattern, setRegexPattern] = useState('');
  const [regexMode, setRegexMode] = useState(false);
  const [regexError, setRegexError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const scrollStartRef = useRef<number | null>(null);
  const regexSnapshotRef = useRef<Set<string> | null>(null);

  const availablePreviousSteps = useMemo(
    () => (previousSteps ?? []).filter((s) => s.files.length > 0),
    [previousSteps],
  );
  const [prevPickerOpen, setPrevPickerOpen] = useState(false);
  const [prevCursor, setPrevCursor] = useState(0);

  const selectedFiles = useMemo(() => flattenSelected(tree), [tree]);

  const regexInfo = useMemo(() => {
    if (!regexPattern) return { regex: null as RegExp | null, error: null as string | null };
    try {
      return { regex: compileSmartCase(regexPattern), error: null };
    } catch (e) {
      return { regex: null, error: e instanceof Error ? e.message : 'invalid regex' };
    }
  }, [regexPattern]);

  const regexMatchCount = useMemo(() => {
    if (!regexInfo.regex) return 0;
    return countRegexMatches(tree, regexInfo.regex);
  }, [tree, regexInfo.regex]);

  const handleRegexChange = (next: string) => {
    setRegexPattern(next);
    if (!next) {
      setRegexError(null);
      const snap = regexSnapshotRef.current;
      if (snap) setTree((t) => selectByPaths(t, snap));
      return;
    }
    try {
      const regex = compileSmartCase(next);
      setRegexError(null);
      setTree((t) => selectByRegex(t, regex));
    } catch (e) {
      setRegexError(e instanceof Error ? e.message : 'invalid regex');
    }
  };

  const enterRegexMode = () => {
    regexSnapshotRef.current = new Set(flattenSelected(tree));
    setRegexMode(true);
    if (!regexPattern) {
      setTree((t) => expandAll(t));
      return;
    }
    try {
      const regex = compileSmartCase(regexPattern);
      setRegexError(null);
      setTree((t) => selectByRegex(expandAll(t), regex));
    } catch (e) {
      setRegexError(e instanceof Error ? e.message : 'invalid regex');
      setTree((t) => expandAll(t));
    }
  };

  const cancelRegexMode = () => {
    const snap = regexSnapshotRef.current;
    if (snap) setTree((t) => selectByPaths(t, snap));
    setRegexMode(false);
    setRegexPattern('');
    setRegexError(null);
  };

  const commitRegexMode = () => {
    setRegexMode(false);
  };

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
    if (regexMode) {
      // TextInput owns character keys; we only intercept Enter / Esc here.
      if (key.return) commitRegexMode();
      else if (key.escape) cancelRegexMode();
      return;
    }
    if (prevPickerOpen) {
      if (key.escape) {
        setPrevPickerOpen(false);
      } else if (key.upArrow || input === 'k') {
        setPrevCursor((c) => Math.max(0, c - 1));
      } else if (key.downArrow || input === 'j') {
        setPrevCursor((c) => Math.min(availablePreviousSteps.length - 1, c + 1));
      } else if (key.return) {
        const picked = availablePreviousSteps[prevCursor];
        if (picked) setTree((t) => selectByPaths(t, new Set(picked.files)));
        setPrevPickerOpen(false);
      }
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
        scrollStartRef.current = start;
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
    } else if (input === 'r' || input === 'R') {
      enterRegexMode();
    } else if ((input === 'p' || input === 'P') && availablePreviousSteps.length > 0) {
      setPrevCursor(0);
      setPrevPickerOpen(true);
    }
  });

  if (prevPickerOpen) {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="magenta">Copy files from a previous step</Text>
          <Text dimColor>Replaces the current selection with the files from the chosen step.</Text>

          <Box flexDirection="column" marginTop={1}>
            {availablePreviousSteps.map((s, i) => {
              const isCursor = i === prevCursor;
              return (
                <Text key={s.index} color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                  {isCursor ? '> ' : '  '}
                  #{s.index + 1}  {s.name || <Text dimColor italic>(unnamed)</Text>}
                  <Text dimColor>  ·  </Text>
                  <Text color="green">{s.files.length} file{s.files.length === 1 ? '' : 's'}</Text>
                </Text>
              );
            })}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>↑↓</Text> select · <Text bold>ENTER</Text> copy · <Text bold>ESC</Text> cancel
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  let start = Math.max(0, Math.min(cursor - Math.floor(PAGE_SIZE / 2), Math.max(0, visible.length - PAGE_SIZE)));
  if (scrollStartRef.current !== null) {
    start = scrollStartRef.current;
    scrollStartRef.current = null;
  }
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

        <Box>
          <Text>Regex:  </Text>
          {regexMode ? (
            <>
              <TextInput value={regexPattern} onChange={handleRegexChange} onSubmit={commitRegexMode} />
              {regexError ? (
                <Text color="red">  ✗ {regexError}</Text>
              ) : regexPattern ? (
                <Text color="green">  · {regexMatchCount} match{regexMatchCount === 1 ? '' : 'es'}</Text>
              ) : (
                <Text dimColor>  · type a pattern; ENTER to keep · ESC to cancel</Text>
              )}
            </>
          ) : (
            <>
              <Text>{regexPattern || <Text dimColor>(none)</Text>}</Text>
              <Text dimColor>   press r to edit</Text>
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
            <Text bold>A</Text> select all · <Text bold>C</Text> clear · <Text bold>/</Text> filter · <Text bold>r</Text> regex select
            {availablePreviousSteps.length > 0 && (
              <> · <Text bold>P</Text> copy from previous step</>
            )}
            {' '}· <Text bold>ENTER</Text> confirm · <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
