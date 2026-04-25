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

const EMPTY_STEP: PromptStep = { name: 'New step', prompt: '', files: [] };

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
    initialPipeline ?? { name: 'my-pipeline', steps: [{ ...EMPTY_STEP }] },
  );
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>(
    initialPipeline ? { kind: 'list' } : { kind: 'editing', index: 0 },
  );

  useInput((input, key) => {
    if (mode.kind !== 'list') return;
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow && key.shift && cursor > 0) {
      setPipeline((p) => {
        const steps = [...p.steps];
        [steps[cursor - 1], steps[cursor]] = [steps[cursor]!, steps[cursor - 1]!];
        return { ...p, steps };
      });
      setCursor((c) => c - 1);
    } else if (key.downArrow && key.shift && cursor < pipeline.steps.length - 1) {
      setPipeline((p) => {
        const steps = [...p.steps];
        [steps[cursor], steps[cursor + 1]] = [steps[cursor + 1]!, steps[cursor]!];
        return { ...p, steps };
      });
      setCursor((c) => c + 1);
    } else if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(pipeline.steps.length - 1, c + 1));
    } else if (input === 'n' || input === 'N') {
      setPipeline((p) => ({
        ...p,
        steps: [...p.steps, { ...EMPTY_STEP, name: `Step ${p.steps.length + 1}` }],
      }));
      setCursor(pipeline.steps.length);
    } else if ((input === 'd' || input === 'D') && pipeline.steps.length > 1) {
      setPipeline((p) => ({ ...p, steps: p.steps.filter((_, i) => i !== cursor) }));
      setCursor((c) => Math.max(0, c - 1));
    } else if (input === 'r' || input === 'R') {
      setMode({ kind: 'naming-pipeline' });
    } else if (input === 'i' || input === 'I') {
      onImport();
    } else if (input === 's' || input === 'S') {
      onExport(pipeline);
    } else if (key.return) {
      // ENTER is the only way to open the step editor.
      setMode({ kind: 'editing', index: cursor });
    } else if (input === 'g' || input === 'G') {
      if (pipeline.steps.every((s) => s.name && s.prompt)) onComplete(pipeline);
    }
  });

  if (mode.kind === 'editing') {
    return (
      <StepEditor
        initialStep={pipeline.steps[mode.index]!}
        stepIndex={mode.index}
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
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="cyan">Rename pipeline</Text>
          <Box marginTop={1}>
            <Text>Name: </Text>
            <TextInput
              value={pipeline.name}
              onChange={(v) => setPipeline((p) => ({ ...p, name: v }))}
              onSubmit={() => setMode({ kind: 'list' })}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor><Text bold>ENTER</Text> confirm · <Text bold>ESC</Text> cancel</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  const allValid = pipeline.steps.every((s) => s.name && s.prompt);

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Box>
          <Text bold color="cyan">{pipeline.name}</Text>
          <Text dimColor>  ·  {pipeline.steps.length} step{pipeline.steps.length === 1 ? '' : 's'}</Text>
          <Text dimColor>  ·  </Text>
          {allValid ? (
            <Text color="green">ready</Text>
          ) : (
            <Text color="red">incomplete</Text>
          )}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {pipeline.steps.map((step, i) => {
            const isCursor = i === cursor;
            const valid = Boolean(step.name && step.prompt);
            const fileBadge =
              step.files.length === 0 ? (
                <Text color="yellow">whole project</Text>
              ) : (
                <Text color="green">{step.files.length} file{step.files.length === 1 ? '' : 's'}</Text>
              );
            return (
              <Box key={i}>
                <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                  {isCursor ? '› ' : '  '}#{i + 1}{'  '}
                  {step.name || <Text dimColor italic>(unnamed)</Text>}
                </Text>
                <Text dimColor>  —  </Text>
                {fileBadge}
                {!valid && <Text color="red">  ⚠</Text>}
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            <Text bold>↑↓</Text> select · <Text bold>SHIFT+↑↓</Text> reorder · <Text bold>ENTER</Text> edit · <Text bold>N</Text> new · <Text bold>D</Text> delete
          </Text>
          <Text dimColor>
            <Text bold>R</Text> rename · <Text bold>I</Text> import · <Text bold>S</Text> save · <Text bold>G</Text> run · <Text bold>ESC</Text> back
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
