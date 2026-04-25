import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { PromptStep } from '../../lib/types.js';
import { FileMultiSelect } from './FileMultiSelect.js';
import { useTerminalClear } from '../hooks/useTerminalClear.js';

type Field = 'name' | 'prompt' | 'files';

interface Props {
  initialStep: PromptStep;
  stepIndex: number;
  repoRoot: string;
  onSave: (step: PromptStep) => void;
  onCancel: () => void;
}

export function StepEditor({ initialStep, stepIndex, repoRoot, onSave, onCancel }: Props): React.JSX.Element {
  useTerminalClear();
  const [step, setStep] = useState<PromptStep>(initialStep);
  const [field, setField] = useState<Field>('name');
  const [pickingFiles, setPickingFiles] = useState(false);

  useInput((input, key) => {
    if (pickingFiles) return;
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab && !key.shift) {
      setField((f) => (f === 'name' ? 'prompt' : f === 'prompt' ? 'files' : 'name'));
    } else if (key.tab && key.shift) {
      setField((f) => (f === 'name' ? 'files' : f === 'prompt' ? 'name' : 'prompt'));
    } else if (field === 'files') {
      if (input === 'f' || input === 'F' || key.return) {
        setPickingFiles(true);
      } else if (input === 'w' || input === 'W') {
        setStep({ ...step, files: [] });
      } else if (input === 's' || input === 'S') {
        if (step.name && step.prompt) onSave(step);
      }
    } else if ((input === 's' || input === 'S') && key.ctrl) {
      if (step.name && step.prompt) onSave(step);
    }
  });

  if (pickingFiles) {
    return (
      <FileMultiSelect
        repoRoot={repoRoot}
        initialSelection={step.files}
        onCommit={(files) => {
          setStep({ ...step, files });
          setPickingFiles(false);
        }}
        onCancel={() => setPickingFiles(false)}
      />
    );
  }

  const canSave = Boolean(step.name && step.prompt);

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">Edit step #{stepIndex + 1}</Text>

        <Box marginTop={1}>
          <Box width={10}><Text color={field === 'name' ? 'cyan' : undefined}>Name:</Text></Box>
          {field === 'name' ? (
            <TextInput
              value={step.name}
              onChange={(v) => setStep({ ...step, name: v })}
              onSubmit={() => setField('prompt')}
              placeholder="e.g. Refactor headers"
            />
          ) : (
            <Text>{step.name || <Text dimColor>(empty — focus this field with Tab)</Text>}</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={field === 'prompt' ? 'cyan' : undefined}>Prompt:</Text>
          {field === 'prompt' ? (
            <TextInput
              value={step.prompt}
              onChange={(v) => setStep({ ...step, prompt: v })}
              onSubmit={() => setField('files')}
              placeholder="Use $file when files are selected"
            />
          ) : (
            <Text>{step.prompt || <Text dimColor>(empty)</Text>}</Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Box width={10}><Text color={field === 'files' ? 'cyan' : undefined}>Files:</Text></Box>
          {step.files.length === 0 ? (
            <Text color="yellow">[whole project — runs once with no file scope]</Text>
          ) : (
            <Text color="green">{step.files.length} file(s) selected</Text>
          )}
          {field === 'files' && (
            <Text dimColor>   <Text bold>F</Text>/ENTER pick files · <Text bold>W</Text> whole project</Text>
          )}
        </Box>

        <Box marginTop={2} flexDirection="column">
          <Text dimColor>
            <Text bold>TAB</Text>/<Text bold>SHIFT+TAB</Text> cycle fields · <Text bold>ENTER</Text> in a text field moves to the next
          </Text>
          <Text dimColor>
            On <Text bold>Files</Text>: <Text bold>F</Text> open picker · <Text bold>W</Text> whole project · <Text bold>S</Text> save step
          </Text>
          <Text>
            <Text dimColor>Save: </Text>
            <Text bold>CTRL+S</Text>{' '}
            {canSave ? <Text color="green">ready</Text> : <Text color="red">requires name + prompt</Text>}
            <Text dimColor>  ·  </Text>
            <Text bold>ESC</Text> <Text dimColor>cancel and discard</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
