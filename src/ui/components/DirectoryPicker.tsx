import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, parse } from 'node:path';
import { log as dlog } from '../../lib/debug-logger.js';
import { applyMarkAll, markAllPlan, toggleMark } from '../../lib/folder-mark.js';
import { isPathInside } from '../../lib/docker-reexec.js';
import { theme } from '../theme.js';
import { t } from '../../lib/i18n/index.js';

export interface DirectoryPickerProps {
  /** Directory the picker opens at (the current run directory). */
  initialDir: string;
  /** Called with the chosen absolute directory path. */
  onSelect: (dir: string) => void;
  onCancel: () => void;
  /**
   * MULTI-MARK mode: browse the tree checking off N project folders instead of
   * choosing one. `SPACE` toggles the highlighted folder, `A` bulk-toggles the
   * whole current listing, `ENTER` confirms via {@link onConfirmMany}. Marks
   * persist across navigation, so "one pipeline over ~/Projects/*" is one pass.
   * Absent → the single-select behavior is byte-identical to before.
   */
  multi?: boolean;
  /** Pre-checked absolute paths (re-entering the picker keeps the selection). */
  initialMarked?: readonly string[];
  /** Multi mode only: the confirmed set, in listing order. */
  onConfirmMany?: (dirs: string[]) => void;
  /**
   * The browsable root — `HUU_WORKSPACE`, which the Docker wrapper bind-mounts
   * RW at the same absolute path (default the host `$HOME`). Multi mode OPENS
   * here because that is where sibling projects live, and `H` jumps back to it;
   * anything OUTSIDE this root is not mounted in the container, so a run there
   * could not see its own files. Absent → behave as before (open at `initialDir`).
   */
  workspaceRoot?: string;
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
  multi = false,
  initialMarked,
  onConfirmMany,
  workspaceRoot,
}: DirectoryPickerProps): React.JSX.Element {
  // Multi mode starts at the workspace root: marking N sibling projects from
  // inside ONE of them would mean climbing out first, every time.
  const [dir, setDir] = useState<string>(
    multi && workspaceRoot ? workspaceRoot : initialDir,
  );
  const [cursor, setCursor] = useState<number>(0);
  const [marked, setMarked] = useState<Set<string>>(() => new Set(initialMarked ?? []));

  const { dirs, error } = useMemo(() => listSubdirs(dir), [dir]);
  const atRoot = parse(dir).root === dir;
  const isGitRepo = existsSync(join(dir, '.git'));

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [
      {
        kind: 'use',
        label: multi ? t('tui.dirpicker.mark_here') : t('tui.dirpicker.use_here'),
      },
    ];
    if (!atRoot) out.push({ kind: 'parent', label: t('tui.dirpicker.parent'), path: dirname(dir) });
    for (const name of dirs) out.push({ kind: 'dir', label: name, path: join(dir, name) });
    return out;
  }, [dirs, dir, atRoot, multi]);

  /** Absolute paths of the sub-folders in THIS listing — the mark-all scope. */
  const listingPaths = useMemo(() => dirs.map((name) => join(dir, name)), [dirs, dir]);
  const bulkPlan = useMemo(() => markAllPlan(marked, listingPaths), [marked, listingPaths]);

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

    if (multi) {
      // SPACE checks the highlighted folder (or the current dir on the top row).
      if (input === ' ') {
        const target = row?.kind === 'dir' ? row.path : row?.kind === 'use' ? dir : undefined;
        if (target) setMarked((m) => toggleMark(m, target));
        return;
      }
      // A bulk-toggles THIS listing only — marks elsewhere are never touched.
      if (input === 'a' || input === 'A') {
        if (bulkPlan.action !== 'none') setMarked((m) => applyMarkAll(m, bulkPlan));
        return;
      }
      if (key.return) {
        // ENTER on a folder row navigates INTO it (browsing must stay cheap);
        // confirming the whole selection is `G`, so ENTER never ends the pass
        // by accident half-way through marking.
        if (row?.kind === 'dir' || row?.kind === 'parent') {
          if (row.path) navigate(row.path);
          return;
        }
        if (row?.kind === 'use') {
          setMarked((m) => toggleMark(m, dir));
          return;
        }
        return;
      }
      if (key.rightArrow) {
        if (row?.path) navigate(row.path);
        return;
      }
      if (input === 'g' || input === 'G') {
        if (marked.size > 0) {
          const dirsOut = [...marked].sort((a, b) => a.localeCompare(b));
          dlog('action', 'DirectoryPicker.confirmMany', { count: dirsOut.length });
          onConfirmMany?.(dirsOut);
        }
        return;
      }
      if (input === 'c' || input === 'C') {
        setMarked(new Set());
        return;
      }
      // Jump back to the workspace root — the web picker's ⌂ Home.
      if ((input === 'h' || input === 'H') && workspaceRoot) {
        navigate(workspaceRoot);
        return;
      }
      return;
    }

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
        <Text bold color="cyanBright">
          {multi ? t('tui.dirpicker.title_multi') : t('tui.dirpicker.title_single')}
        </Text>
        <Text dimColor wrap="truncate-start">{dir}</Text>
        <Box>
          <Text color={isGitRepo ? 'green' : 'yellow'}>
            {isGitRepo ? t('tui.dirpicker.is_git') : t('tui.dirpicker.not_git')}
          </Text>
          {multi ? (
            <Text color={marked.size > 0 ? theme.success : undefined} dimColor={marked.size === 0}>
              {'  ·  '}
              {t('tui.dirpicker.marked', { count: marked.size })}
            </Text>
          ) : null}
        </Box>
        {/* Outside the workspace root nothing is bind-mounted into the
            container, so a run there would not find its own files. */}
        {multi && workspaceRoot && !isPathInside(dir, workspaceRoot) ? (
          <Text color={theme.warning} wrap="truncate-start">
            {t('tui.dirpicker.outside_workspace', { root: workspaceRoot })}
          </Text>
        ) : null}

        <Box marginTop={1} flexDirection="column">
          {start > 0 ? <Text dimColor>{`  ${t('common.more_up')}`}</Text> : null}
          {visible.map((row, i) => {
            const idx = start + i;
            const isCursor = idx === cursor;
            const color =
              row.kind === 'use' ? 'green' : row.kind === 'parent' ? 'yellow' : 'cyan';
            const icon = row.kind === 'dir' ? '📁 ' : row.kind === 'parent' ? '⤴ ' : '';
            // In multi mode every markable row carries a checkbox; the parent
            // row keeps its indent so the column stays aligned.
            const markable = multi && (row.kind === 'dir' || row.kind === 'use');
            const checked = markable
              ? marked.has(row.kind === 'use' ? dir : row.path!)
              : false;
            const box = multi ? (markable ? (checked ? '[x] ' : '[ ] ') : '    ') : '';
            return (
              <Text
                key={`${row.kind}:${row.path ?? row.label}`}
                color={isCursor ? color : undefined}
                bold={isCursor}
              >
                {isCursor ? '› ' : '  '}
                {box}
                {icon}
                {row.label}
              </Text>
            );
          })}
          {start + WINDOW < rows.length ? <Text dimColor>{`  ${t('common.more_down')}`}</Text> : null}
          {error ? <Text color="red" wrap="wrap">  {error}</Text> : null}
          {!error && dirs.length === 0 ? (
            <Text dimColor>{`  ${t('tui.dirpicker.no_subdirs')}`}</Text>
          ) : null}
        </Box>

        {multi && marked.size > 0 ? (
          <Box marginTop={1}>
            <Text dimColor wrap="truncate-end">
              {'  '}
              {[...marked]
                .sort((a, b) => a.localeCompare(b))
                .map((p) => basename(p) || p)
                .join(' · ')}
            </Text>
          </Box>
        ) : null}

        <Box marginTop={1}>
          {multi ? (
            <Text dimColor>
              <Text bold>↑↓</Text> {t('common.action.move')} · <Text bold>SPACE</Text>{' '}
              {t('tui.dirpicker.hint_mark')} · <Text bold>A</Text>{' '}
              {bulkPlan.action === 'unmark'
                ? t('tui.dirpicker.hint_unmark_all', { count: bulkPlan.total })
                : t('tui.dirpicker.hint_mark_all', { count: bulkPlan.total })}{' '}
              · <Text bold>ENTER</Text> {t('common.action.open')} · <Text bold>←</Text>{' '}
              {t('tui.dirpicker.hint_parent')} ·{' '}
              {workspaceRoot ? (
                <>
                  <Text bold>H</Text> {t('tui.dirpicker.hint_home')} ·{' '}
                </>
              ) : null}
              <Text bold>C</Text> {t('common.action.clear')} ·{' '}
              <Text bold color={theme.success}>G</Text>{' '}
              {t('tui.dirpicker.hint_go', { count: marked.size })} ·{' '}
              <Text bold color={theme.error}>ESC</Text> {t('common.action.cancel')}
            </Text>
          ) : (
            <Text dimColor>
              <Text bold>↑↓</Text> {t('common.action.move')} · <Text bold>ENTER/→</Text>{' '}
              {t('common.action.open')} · <Text bold>←</Text> {t('tui.dirpicker.hint_parent')} ·{' '}
              <Text bold>U</Text> {t('tui.dirpicker.hint_use_here')} · <Text bold>ESC</Text>{' '}
              {t('common.action.cancel')}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
