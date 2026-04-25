import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Pipeline } from '../../lib/types.js';
import { exportPipeline, importPipeline } from '../../lib/pipeline-io.js';

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
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Caminho nao pode ser vazio');
      return;
    }
    try {
      if (mode === 'import') {
        const loaded = importPipeline(trimmed);
        onComplete(loaded);
      } else {
        if (!pipeline) {
          setError('Pipeline ausente para exportacao');
          return;
        }
        exportPipeline(pipeline, trimmed);
        setDone(`Exportado para ${trimmed}`);
        setTimeout(() => onComplete(pipeline), 800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        {mode === 'import' ? 'Importar pipeline' : 'Exportar pipeline'}
      </Text>
      <Box marginTop={1}>
        <Text>Caminho: </Text>
        <TextInput value={path} onChange={setPath} onSubmit={handleSubmit} />
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
        <Text dimColor>Enter confirma · Esc cancela</Text>
      </Box>
    </Box>
  );
}
