import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Pipeline } from '../../lib/types.js';
import type { PipelineEntry } from '../../lib/pipeline-io.js';
import { t } from '../../lib/i18n/index.js';

interface Props {
  entries: PipelineEntry[];
  onSelect: (pipeline: Pipeline) => void;
  /** Run 2+ pipelines CONCURRENTLY (multi-select). When absent, only single. */
  onSelectMany?: (pipelines: Pipeline[]) => void;
  onDelete: (name: string) => void;
  onCancel: () => void;
  /** Heading override — the multi-project flow reuses this screen. */
  title?: string;
  subtitle?: string;
  /**
   * Delete is a MEMORY-store operation. The multi-project flow lists
   * `./pipelines` files too, which it cannot delete, so it turns this off.
   * Default true (the classic saved-pipelines screen).
   */
  allowDelete?: boolean;
}

export function SavedPipelinesManager({
  entries,
  onSelect,
  onSelectMany,
  onDelete,
  onCancel,
  title,
  subtitle,
  allowDelete = true,
}: Props): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Indices toggled with SPACE for a concurrent multi-run batch.
  const [checked, setChecked] = useState<Set<number>>(() => new Set());

  useInput((_input, key) => {
    if (key.escape) {
      if (confirmDelete) {
        setConfirmDelete(false);
        return;
      }
      onCancel();
      return;
    }

    if (confirmDelete) {
      if (_input === 'y' || _input === 'Y') {
        const selected = entries[selectedIndex];
        if (selected) {
          onDelete(selected.pipeline.name);
        }
        setConfirmDelete(false);
      } else {
        setConfirmDelete(false);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(entries.length - 1, prev + 1));
      return;
    }
    if (_input === ' ' && onSelectMany) {
      // SPACE toggles the current entry into the concurrent batch.
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(selectedIndex)) next.delete(selectedIndex);
        else next.add(selectedIndex);
        return next;
      });
      return;
    }
    if (key.return) {
      // 2+ checked → run them concurrently; otherwise load the highlighted one.
      if (onSelectMany && checked.size >= 2) {
        const picks = [...checked]
          .sort((a, b) => a - b)
          .map((i) => entries[i]?.pipeline)
          .filter((p): p is Pipeline => Boolean(p));
        if (picks.length >= 2) {
          onSelectMany(picks);
          return;
        }
      }
      const selected = entries[selectedIndex];
      if (selected) {
        onSelect(selected.pipeline);
      }
      return;
    }
    if ((_input === 'd' || _input === 'D') && allowDelete) {
      if (entries.length > 0) {
        setConfirmDelete(true);
      }
      return;
    }
  });

  if (confirmDelete) {
    const selected = entries[selectedIndex];
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="red" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="red">{t('tui.saved.delete_title')}</Text>
          <Text>
            {t('tui.saved.delete_confirm', {
              name: selected?.pipeline.name ?? t('tui.saved.this_pipeline'),
            })}
          </Text>
          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>Y</Text> {t('common.action.confirm')} · <Text bold>N/ESC</Text>{' '}
              {t('common.action.cancel')}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">{title ?? t('tui.saved.title')}</Text>
        <Text dimColor>{subtitle ?? t('tui.saved.subtitle')}</Text>

        {entries.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>
              {allowDelete ? t('tui.saved.empty_memory') : t('tui.saved.empty_any')}
            </Text>
          </Box>
        )}

        {entries.map((entry, idx) => {
          const isChecked = checked.has(idx);
          return (
            <Box key={entry.filePath}>
              <Text>
                {'  '}
                <Text bold color={idx === selectedIndex ? 'green' : 'cyan'}>
                  {idx === selectedIndex ? '>' : ' '}
                </Text>{' '}
                {onSelectMany && (
                  <Text color={isChecked ? 'green' : undefined} dimColor={!isChecked}>
                    {isChecked ? '[x]' : '[ ]'}{' '}
                  </Text>
                )}
                {entry.pipeline.name}{' '}
                <Text dimColor>({entry.source})</Text>
              </Text>
            </Box>
          );
        })}

        {onSelectMany && checked.size > 0 && (
          <Box marginTop={1}>
            <Text color="green">{t('tui.saved.selected_count', { count: checked.size })}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>ENTER</Text>{' '}
            {checked.size >= 2
              ? t('tui.saved.run_together', { count: checked.size })
              : t('tui.saved.load')}
            {onSelectMany ? <> · <Text bold>SPACE</Text> {t('common.action.select')}</> : null}
            {' '}· <Text bold>↑↓</Text> {t('common.action.navigate')}
            {allowDelete ? <> · <Text bold>D</Text> {t('common.action.delete')}</> : null} ·{' '}
            <Text bold>ESC</Text> {t('common.action.back')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
