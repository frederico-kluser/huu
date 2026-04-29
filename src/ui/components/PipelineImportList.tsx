import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Pipeline } from '../../lib/types.js';
import type { PipelineEntry } from '../../lib/pipeline-io.js';

interface Props {
  entries: PipelineEntry[];
  onSelect: (pipeline: Pipeline) => void;
  onCustomPath: () => void;
  onCancel: () => void;
}

export function PipelineImportList({
  entries,
  onSelect,
  onCustomPath,
  onCancel,
}: Props): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

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
      setSelectedIndex((prev) => Math.min(entries.length, prev + 1));
      return;
    }
    if (key.return) {
      if (selectedIndex < entries.length) {
        onSelect(entries[selectedIndex].pipeline);
      } else {
        onCustomPath();
      }
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">Import pipeline</Text>
        <Text dimColor>Select a pipeline from the list or choose custom path</Text>

        {entries.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>No pipelines available.</Text>
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
            <Text dimColor>Import from custom path...</Text>
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>ENTER</Text> select · <Text bold>↑↓</Text> navigate · <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
