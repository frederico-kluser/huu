import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RunQueueItem } from '../../lib/run-queue.js';
import { log as dlog } from '../../lib/debug-logger.js';
import { theme } from '../theme.js';
import { ActionBar, type ActionHint } from './ActionBar.js';
import { t } from '../../lib/i18n/index.js';

interface Props {
  /** The (pipeline × project) fan-out to review. */
  items: readonly RunQueueItem[];
  /** Model the whole batch shares — shown so the cost is not a surprise. */
  modelId: string;
  /** Confirmed queue, in priority order (index 0 is served first). */
  onConfirm: (items: RunQueueItem[]) => void;
  onCancel: () => void;
}

/** Visible window; a 6-pipeline × 8-project batch is 48 rows. */
const WINDOW = 14;

/**
 * Last stop before a multi-project batch starts: the reviewed (pipeline ×
 * project) queue. Exists because N × M runs is real RAM and real tokens — a
 * mis-marked folder should be removable here, not discovered three merges in.
 *
 * Rows are grouped by pipeline and ordered by PRIORITY: index 0 is admitted
 * first, later rows backfill as the shared budget frees up (they do NOT all
 * start at once — see MultiRunDriver).
 */
export function RunQueueScreen({
  items,
  modelId,
  onConfirm,
  onCancel,
}: Props): React.JSX.Element {
  const queue = useMemo(() => [...items], [items]);
  const [cursor, setCursor] = useState(0);
  /**
   * Indices excluded from the run. A TOGGLE, not a delete: nothing is destroyed,
   * so a mis-press (or a stray byte from a terminal escape sequence — that
   * really happened) is undone with the same key. SPACE matches every other
   * multi-select in this TUI (file picker, saved pipelines, project picker).
   */
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const included = queue.filter((_, i) => !skipped.has(i));

  // A non-git folder can still be marked, but it WILL fail preflight, so say so
  // before the run instead of after.
  const gitFlags = useMemo(
    () => queue.map((item) => existsSync(join(item.cwd, '.git'))),
    [queue],
  );
  const nonGitCount = queue.reduce(
    (n, _item, i) => (!skipped.has(i) && gitFlags[i] === false ? n + 1 : n),
    0,
  );

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
      setCursor((c) => Math.min(queue.length - 1, c + 1));
      return;
    }
    if (input === ' ') {
      setSkipped((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
      return;
    }
    if (input === 'a' || input === 'A') {
      // All-or-nothing, like the file picker's A/C pair folded into one key.
      setSkipped((prev) => (prev.size > 0 ? new Set() : new Set(queue.map((_, i) => i))));
      return;
    }
    if (key.return) {
      if (included.length === 0) {
        onCancel();
        return;
      }
      dlog('action', 'RunQueueScreen.confirm', {
        runs: included.length,
        skipped: skipped.size,
      });
      onConfirm(included);
    }
  });

  const start = Math.min(
    Math.max(0, cursor - Math.floor(WINDOW / 2)),
    Math.max(0, queue.length - WINDOW),
  );
  const visible = queue.slice(start, start + WINDOW);

  const hints: ActionHint[] = [
    { key: '↑↓', label: t('common.action.select'), color: theme.info },
    { key: 'SPACE', label: t('tui.run_queue.hint_skip'), color: theme.warning },
    {
      key: 'A',
      label: skipped.size > 0 ? t('tui.run_queue.hint_include_all') : t('tui.run_queue.hint_skip_all'),
      color: theme.info,
    },
    { key: 'ENTER', label: t('tui.run_queue.hint_run', { count: included.length }), color: theme.success },
    { key: 'ESC', label: t('common.action.back'), color: theme.error },
  ];

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyanBright">{t('tui.run_queue.title')}</Text>
        <Text dimColor>
          {t('tui.run_queue.summary', {
            runs:
              included.length === 1
                ? t('tui.run_queue.runs_one', { count: included.length })
                : t('tui.run_queue.runs_other', { count: included.length }),
            skipped: skipped.size > 0 ? t('tui.run_queue.skipped_suffix', { count: skipped.size }) : '',
            model: modelId || t('tui.run_queue.model_per_step'),
          })}
        </Text>

        <Box marginTop={1} flexDirection="column">
          {start > 0 ? <Text dimColor>{`  ${t('common.more_up')}`}</Text> : null}
          {visible.map((item, i) => {
            const idx = start + i;
            const isCursor = idx === cursor;
            // Only label the first row of each pipeline group, so a 6×8 batch
            // reads as six blocks instead of 48 repetitions of the same name.
            const isGroupHead =
              idx === 0 || queue[idx - 1]!.pipeline.name !== item.pipeline.name;
            const isGit = gitFlags[idx] ?? true;
            const isSkipped = skipped.has(idx);
            return (
              <Box key={`${item.pipeline.name}:${item.cwd}`} flexDirection="column">
                {isGroupHead ? (
                  <Text color={theme.info} bold>
                    {'  '}
                    {item.pipeline.name}
                  </Text>
                ) : null}
                <Box>
                  <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                    {isCursor ? '  › ' : '    '}
                    {isSkipped ? '[ ] ' : '[x] '}
                  </Text>
                  <Text
                    color={isSkipped ? undefined : isGit ? undefined : theme.warning}
                    dimColor={isSkipped}
                    wrap="truncate-start"
                  >
                    {item.cwd}
                  </Text>
                  {isSkipped ? (
                    <Text dimColor>{`  — ${t('tui.run_queue.skipped_tag')}`}</Text>
                  ) : !isGit ? (
                    <Text color={theme.warning}>{`  ⚠ ${t('tui.run_queue.not_git')}`}</Text>
                  ) : null}
                </Box>
              </Box>
            );
          })}
          {start + WINDOW < queue.length ? <Text dimColor>{`  ${t('common.more_down')}`}</Text> : null}
          {queue.length === 0 ? (
            <Text color={theme.warning}>
              {'  '}
              {t('tui.run_queue.empty')}
            </Text>
          ) : included.length === 0 ? (
            <Text color={theme.warning}>
              {'  '}
              {t('tui.run_queue.all_skipped')}
            </Text>
          ) : null}
        </Box>

        {nonGitCount > 0 ? (
          <Box marginTop={1}>
            <Text color={theme.warning}>
              ⚠{' '}
              {nonGitCount === 1
                ? t('tui.run_queue.non_git_one', { count: nonGitCount })
                : t('tui.run_queue.non_git_other', { count: nonGitCount })}
            </Text>
          </Box>
        ) : null}

        <Box marginTop={1}>
          <ActionBar hints={hints} />
        </Box>
      </Box>
    </Box>
  );
}
