import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { log as dlog } from '../../lib/debug-logger.js';

export interface DirectoryPickerProps {
  /** Directory the picker opens at (the current run directory). */
  initialDir: string;
  /** Called with the chosen absolute directory path. */
  onSelect: (dir: string) => void;
  onCancel: () => void;
}

interface Row {
  kind: 'use' | 'parent' | 'dir';
  label: string;
  /** Absolute path to navigate to (parent/dir only). */
  path?: string;
}

/** Visible window size for the directory list (keeps the screen bounded). */
const WINDOW = 12;

function listSubdirs(dir: string): { dirs: string[]; error: string | null } {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => {
        // Follow real directories and dir symlinks; skip dotfolders that are
        // never run targets to keep the list readable. `.huu*` is huu's own
        // scratch, also skipped.
        if (!e.isDirectory() && !e.isSymbolicLink()) return false;
        if (e.name.startsWith('.')) return false;
        return true;
      })
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    return { dirs, error: null };
  } catch (err) {
    return { dirs: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function DirectoryPicker({
  initialDir,
  onSelect,
  onCancel,
}: DirectoryPickerProps): React.JSX.Element {
  const [dir, setDir] = useState<string>(initialDir);
  const [cursor, setCursor] = useState<number>(0);

  const { dirs, error } = useMemo(() => listSubdirs(dir), [dir]);
  const atRoot = parse(dir).root === dir;
  const isGitRepo = existsSync(join(dir, '.git'));

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [{ kind: 'use', label: '✓ Run here (use this directory)' }];
    if (!atRoot) out.push({ kind: 'parent', label: '..  (parent directory)', path: dirname(dir) });
    for (const name of dirs) out.push({ kind: 'dir', label: name, path: join(dir, name) });
    return out;
  }, [dirs, dir, atRoot]);

  const navigate = (target: string): void => {
    setDir(target);
    setCursor(0);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(rows.length - 1, c + 1));
      return;
    }
    // Left arrow / backspace → jump to parent (quick escape up the tree).
    if ((key.leftArrow || key.backspace || key.delete) && !atRoot) {
      navigate(dirname(dir));
      return;
    }
    const row = rows[cursor];
    if (!row) return;
    // Enter / right arrow: open a directory, climb to parent, or select.
    if (key.return || key.rightArrow) {
      if (row.kind === 'use') {
        dlog('action', 'DirectoryPicker.select', { dir });
        onSelect(dir);
      } else if (row.path) {
        navigate(row.path);
      }
      return;
    }
    // 'u' is a shortcut for "use this directory" from anywhere in the list.
    if (input === 'u' || input === 'U') {
      onSelect(dir);
    }
  });

  // Scroll the visible window so the cursor stays in view.
  const start = Math.min(
    Math.max(0, cursor - Math.floor(WINDOW / 2)),
    Math.max(0, rows.length - WINDOW),
  );
  const visible = rows.slice(start, start + WINDOW);

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyanBright">Choose run directory</Text>
        <Text dimColor wrap="truncate-start">{dir}</Text>
        <Box>
          <Text color={isGitRepo ? 'green' : 'yellow'}>
            {isGitRepo ? '✓ git repository' : '⚠ not a git repository — runs need one'}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {start > 0 ? <Text dimColor>{'  ↑ more'}</Text> : null}
          {visible.map((row, i) => {
            const idx = start + i;
            const isCursor = idx === cursor;
            const color =
              row.kind === 'use' ? 'green' : row.kind === 'parent' ? 'yellow' : 'cyan';
            const icon = row.kind === 'dir' ? '📁 ' : row.kind === 'parent' ? '⤴ ' : '';
            return (
              <Text key={`${row.kind}:${row.path ?? row.label}`} color={isCursor ? color : undefined} bold={isCursor}>
                {isCursor ? '› ' : '  '}
                {icon}
                {row.label}
              </Text>
            );
          })}
          {start + WINDOW < rows.length ? <Text dimColor>{'  ↓ more'}</Text> : null}
          {error ? <Text color="red" wrap="wrap">  {error}</Text> : null}
          {!error && dirs.length === 0 ? <Text dimColor>  (no sub-directories)</Text> : null}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>↑↓</Text> move · <Text bold>ENTER/→</Text> open · <Text bold>←</Text> parent · <Text bold>U</Text> use here · <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
