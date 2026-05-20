import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Pipeline } from '../../lib/types.js';
import type { PipelineEntry } from '../../lib/pipeline-io.js';

interface Props {
  entries: PipelineEntry[];
  onSelect: (pipeline: Pipeline) => void;
  onDelete: (name: string) => void;
  onCancel: () => void;
}

export function SavedPipelinesManager({
  entries,
  onSelect,
  onDelete,
  onCancel,
}: Props): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    if (key.return) {
      const selected = entries[selectedIndex];
      if (selected) {
        onSelect(selected.pipeline);
      }
      return;
    }
    if (_input === 'd' || _input === 'D') {
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
          <Text bold color="red">Delete pipeline?</Text>
          <Text>
            Are you sure you want to delete <Text bold>{selected?.pipeline.name ?? 'this pipeline'}</Text>?
          </Text>
          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>Y</Text> confirm · <Text bold>N/ESC</Text> cancel
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">Saved pipelines</Text>
        <Text dimColor>Pipelines stored in global memory</Text>

        {entries.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>No saved pipelines in memory.</Text>
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

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>ENTER</Text> load · <Text bold>↑↓</Text> navigate · <Text bold>D</Text> delete · <Text bold>ESC</Text> back
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
