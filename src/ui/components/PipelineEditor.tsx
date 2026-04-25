import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Pipeline, PromptStep } from '../../lib/types.js';
import { StepEditor } from './StepEditor.js';

interface Props {
  initialPipeline?: Pipeline;
  repoRoot: string;
  onComplete: (pipeline: Pipeline) => void;
  onImport: () => void;
  onExport: (pipeline: Pipeline) => void;
  onCancel: () => void;
}

const EMPTY_STEP: PromptStep = { name: 'Nova etapa', prompt: '', files: [] };

type Mode =
  | { kind: 'list' }
  | { kind: 'editing'; index: number }
  | { kind: 'naming-pipeline' };

export function PipelineEditor({
  initialPipeline,
  repoRoot,
  onComplete,
  onImport,
  onExport,
  onCancel,
}: Props): React.JSX.Element {
  const [pipeline, setPipeline] = useState<Pipeline>(
    initialPipeline ?? { name: 'minha-pipeline', steps: [{ ...EMPTY_STEP }] },
  );
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  useInput((input, key) => {
    if (mode.kind !== 'list') return;
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(pipeline.steps.length - 1, c + 1));
    } else if (input === 'a') {
      setPipeline((p) => ({
        ...p,
        steps: [...p.steps, { ...EMPTY_STEP, name: `Etapa ${p.steps.length + 1}` }],
      }));
      setCursor(pipeline.steps.length);
    } else if (input === 'd' && pipeline.steps.length > 1) {
      setPipeline((p) => ({ ...p, steps: p.steps.filter((_, i) => i !== cursor) }));
      setCursor((c) => Math.max(0, c - 1));
    } else if (input === 'J' && cursor < pipeline.steps.length - 1) {
      setPipeline((p) => {
        const steps = [...p.steps];
        [steps[cursor], steps[cursor + 1]] = [steps[cursor + 1]!, steps[cursor]!];
        return { ...p, steps };
      });
      setCursor((c) => c + 1);
    } else if (input === 'K' && cursor > 0) {
      setPipeline((p) => {
        const steps = [...p.steps];
        [steps[cursor], steps[cursor - 1]] = [steps[cursor - 1]!, steps[cursor]!];
        return { ...p, steps };
      });
      setCursor((c) => c - 1);
    } else if (input === 'e' || key.return) {
      setMode({ kind: 'editing', index: cursor });
    } else if (input === 'n') {
      setMode({ kind: 'naming-pipeline' });
    } else if (input === 'i') {
      onImport();
    } else if (input === 'x') {
      onExport(pipeline);
    } else if (input === 'r') {
      if (pipeline.steps.every((s) => s.name && s.prompt)) onComplete(pipeline);
    }
  });

  if (mode.kind === 'editing') {
    return (
      <StepEditor
        initialStep={pipeline.steps[mode.index]!}
        repoRoot={repoRoot}
        onSave={(step) => {
          setPipeline((p) => ({
            ...p,
            steps: p.steps.map((s, i) => (i === mode.index ? step : s)),
          }));
          setMode({ kind: 'list' });
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'naming-pipeline') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Nome da pipeline:</Text>
        <TextInput
          value={pipeline.name}
          onChange={(v) => setPipeline((p) => ({ ...p, name: v }))}
          onSubmit={() => setMode({ kind: 'list' })}
        />
      </Box>
    );
  }

  const allValid = pipeline.steps.every((s) => s.name && s.prompt);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box>
        <Text bold color="cyan">Pipeline: </Text>
        <Text>{pipeline.name}</Text>
        <Text dimColor>  (n para renomear)</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {pipeline.steps.map((step, i) => {
          const isCursor = i === cursor;
          const fileBadge =
            step.files.length === 0
              ? <Text color="yellow">[rodada livre]</Text>
              : <Text color="green">[{step.files.length} arquivos]</Text>;
          const valid = step.name && step.prompt;
          return (
            <Box key={i}>
              <Text color={isCursor ? 'cyan' : undefined}>
                {isCursor ? '> ' : '  '}
                #{i + 1} {step.name || <Text dimColor>(sem nome)</Text>}{'  '}
              </Text>
              {fileBadge}
              {!valid && <Text color="red">  ⚠ incompleto</Text>}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          ↑↓ navega · e/Enter edita · a adiciona · d remove · J/K reordena
        </Text>
        <Text dimColor>
          n renomeia pipeline · i importa · x exporta · {' '}
          <Text color={allValid ? 'green' : 'gray'} bold={allValid}>r executa</Text> · Esc sai
        </Text>
      </Box>
    </Box>
  );
}
