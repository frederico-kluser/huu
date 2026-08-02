import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Pipeline } from '../../lib/types.js';
import type { PipelineEntry } from '../../lib/pipeline-io.js';
import { t } from '../../lib/i18n/index.js';

interface Props {
  entries: PipelineEntry[];
  onSelect: (pipeline: Pipeline) => void;
  onPasteJson: () => void;
  onCustomPath: () => void;
  onCancel: () => void;
}

export function PipelineImportList({
  entries,
  onSelect,
  onPasteJson,
  onCustomPath,
  onCancel,
}: Props): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  // Total items: entries + "Paste JSON" + "Custom path"
  const extraCount = 2;

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(entries.length + extraCount - 1, prev + 1));
      return;
    }
    if (key.return) {
      if (selectedIndex < entries.length) {
        onSelect(entries[selectedIndex].pipeline);
      } else if (selectedIndex === entries.length) {
        onPasteJson();
      } else {
        onCustomPath();
      }
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">{t('tui.import.title')}</Text>
        <Text dimColor>{t('tui.import.subtitle')}</Text>

        {entries.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>{t('tui.import.empty')}</Text>
          </Box>
        )}

        {entries.map((entry, idx) => (
          <Box key={entry.filePath}>
            <Text>
              {'  '}
              <Text bold color={idx === selectedIndex ? 'green' : 'cyan'}>
                {idx === selectedIndex ? '>' : ' '}
              </Text>{' '}
              {entry.pipeline.name}{' '}
              <Text dimColor>({entry.source})</Text>
            </Text>
          </Box>
        ))}

        <Box>
          <Text>
            {'  '}
            <Text bold color={selectedIndex === entries.length ? 'green' : 'cyan'}>
              {selectedIndex === entries.length ? '>' : ' '}
            </Text>{' '}
            <Text dimColor>{t('tui.import.paste_json')}</Text>
          </Text>
        </Box>

        <Box>
          <Text>
            {'  '}
            <Text bold color={selectedIndex === entries.length + 1 ? 'green' : 'cyan'}>
              {selectedIndex === entries.length + 1 ? '>' : ' '}
            </Text>{' '}
            <Text dimColor>{t('tui.import.custom_path')}</Text>
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>ENTER</Text> {t('common.action.select')} · <Text bold>↑↓</Text>{' '}
            {t('common.action.navigate')} · <Text bold>ESC</Text> {t('common.action.cancel')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
