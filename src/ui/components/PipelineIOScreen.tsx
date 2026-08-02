import React, { useMemo, useState } from 'react';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Pipeline } from '../../lib/types.js';
import { exportPipeline, importPipeline, savePipelineToMemory } from '../../lib/pipeline-io.js';
import { getHuuHome } from '../../lib/huu-home.js';
import { t } from '../../lib/i18n/index.js';

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
  return join(getHuuHome(), 'Downloads', `${sanitized}.json`);
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
          setError(t('tui.pipeline_io.err_path_empty'));
          return;
        }
        const loaded = importPipeline(trimmed);
        onComplete(loaded);
      } else {
        if (!pipeline) {
          setError(t('tui.pipeline_io.err_no_pipeline'));
          return;
        }
        const target = trimmed || defaultExportPath;
        mkdirSync(dirname(target), { recursive: true });
        exportPipeline(pipeline, target);
        savePipelineToMemory(pipeline);
        setDone(
          trimmed
            ? t('tui.pipeline_io.saved_to', { path: target })
            : t('tui.pipeline_io.saved_downloads', { path: target }),
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
          {mode === 'import' ? t('tui.pipeline_io.title_import') : t('tui.pipeline_io.title_export')}
        </Text>

        <Box marginTop={1}>
          <Text>{t('tui.pipeline_io.path')}</Text>
          <TextInput
            value={path}
            onChange={setPath}
            onSubmit={handleSubmit}
            placeholder={mode === 'export' ? defaultExportPath : t('tui.pipeline_io.placeholder_import')}
          />
        </Box>

        {mode === 'export' && (
          <Box marginTop={1}>
            <Text dimColor>
              {t('tui.pipeline_io.downloads_hint')} <Text>{defaultExportPath}</Text>
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
            <Text bold>ENTER</Text> {t('common.action.confirm')} · <Text bold>ESC</Text>{' '}
            {t('common.action.cancel')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
