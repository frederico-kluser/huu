import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Pipeline } from '../../lib/types.js';
import { exportPipeline, importPipeline } from '../../lib/pipeline-io.js';
import { useTerminalClear } from '../hooks/useTerminalClear.js';

export type PipelineIOMode = 'import' | 'export';

interface Props {
  mode: PipelineIOMode;
  initialPath?: string;
  pipeline?: Pipeline;
  onComplete: (pipeline: Pipeline | null) => void;
  onCancel: () => void;
}

export function PipelineIOScreen({
  mode,
  initialPath = '',
  pipeline,
  onComplete,
  onCancel,
}: Props): React.JSX.Element {
  useTerminalClear();
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Path cannot be empty');
      return;
    }
    try {
      if (mode === 'import') {
        const loaded = importPipeline(trimmed);
        onComplete(loaded);
      } else {
        if (!pipeline) {
          setError('No pipeline to export');
          return;
        }
        exportPipeline(pipeline, trimmed);
        setDone(`Exported to ${trimmed}`);
        setTimeout(() => onComplete(pipeline), 800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">
          {mode === 'import' ? 'Import pipeline from JSON' : 'Export pipeline to JSON'}
        </Text>

        <Box marginTop={1}>
          <Text>Path: </Text>
          <TextInput
            value={path}
            onChange={setPath}
            onSubmit={handleSubmit}
            placeholder="e.g. ./my-pipeline.json"
          />
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        {done && (
          <Box marginTop={1}>
            <Text color="green">{done}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>ENTER</Text> confirm · <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
