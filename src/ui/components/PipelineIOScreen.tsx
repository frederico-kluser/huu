import React, { useMemo, useState } from 'react';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Pipeline } from '../../lib/types.js';
import { exportPipeline, importPipeline, savePipelineToMemory } from '../../lib/pipeline-io.js';

export type PipelineIOMode = 'import' | 'export';

interface Props {
  mode: PipelineIOMode;
  initialPath?: string;
  pipeline?: Pipeline;
  onComplete: (pipeline: Pipeline | null) => void;
  onCancel: () => void;
}

function defaultDownloadsPath(pipelineName: string): string {
  const sanitized = pipelineName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'pipeline';
  return join(homedir(), 'Downloads', `${sanitized}.json`);
}

export function PipelineIOScreen({
  mode,
  initialPath = '',
  pipeline,
  onComplete,
  onCancel,
}: Props): React.JSX.Element {
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const defaultExportPath = useMemo(
    () => (mode === 'export' && pipeline ? defaultDownloadsPath(pipeline.name) : ''),
    [mode, pipeline],
  );

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    try {
      if (mode === 'import') {
        if (!trimmed) {
          setError('Path cannot be empty');
          return;
        }
        const loaded = importPipeline(trimmed);
        onComplete(loaded);
      } else {
        if (!pipeline) {
          setError('No pipeline to export');
          return;
        }
        const target = trimmed || defaultExportPath;
        mkdirSync(dirname(target), { recursive: true });
        exportPipeline(pipeline, target);
        savePipelineToMemory(pipeline);
        setDone(
          trimmed
            ? `Saved to ${target}`
            : `No path provided — saved to your OS Downloads folder: ${target}`,
        );
        setTimeout(() => onComplete(pipeline), 1800);
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
            placeholder={mode === 'export' ? defaultExportPath : 'e.g. ./my-pipeline.json'}
          />
        </Box>

        {mode === 'export' && (
          <Box marginTop={1}>
            <Text dimColor>
              Leave empty to save to your OS Downloads folder: <Text>{defaultExportPath}</Text>
            </Text>
          </Box>
        )}

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
