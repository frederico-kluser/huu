import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { PromptStep } from '../../lib/types.js';
import { FileMultiSelect } from './FileMultiSelect.js';

type Field = 'name' | 'prompt' | 'files';

interface Props {
  initialStep: PromptStep;
  stepIndex: number;
  repoRoot: string;
  onSave: (step: PromptStep) => void;
  onCancel: () => void;
}

export function StepEditor({ initialStep, stepIndex, repoRoot, onSave, onCancel }: Props): React.JSX.Element {
  const [step, setStep] = useState<PromptStep>(initialStep);
  const [field, setField] = useState<Field>('name');
  const [pickingFiles, setPickingFiles] = useState(false);
  // Files choice must be explicit. Treat existing steps (already-edited prompt
  // or files already selected) as previously chosen.
  const [filesChosen, setFilesChosen] = useState<boolean>(
    initialStep.files.length > 0 || initialStep.prompt.length > 0,
  );
  const canSave = Boolean(step.name && step.prompt && filesChosen);

  useInput((input, key) => {
    if (pickingFiles) return;
    if (key.escape) {
      if (canSave) {
        onSave(step);
      } else {
        onCancel();
      }
      return;
    }
    if (key.tab) {
      setField((f) => (f === 'name' ? 'prompt' : f === 'prompt' ? 'files' : 'name'));
    } else if (field === 'files') {
      if (input === 'f' || input === 'F') {
        setPickingFiles(true);
      } else if (input === 'w' || input === 'W') {
        setStep({ ...step, files: [] });
        setFilesChosen(true);
      }
      // ENTER intentionally does nothing here — choice must be explicit (F or W).
    }
  });

  if (pickingFiles) {
    return (
      <FileMultiSelect
        repoRoot={repoRoot}
        initialSelection={step.files}
        onCommit={(files) => {
          setStep({ ...step, files });
          setFilesChosen(true);
          setPickingFiles(false);
        }}
        onCancel={() => setPickingFiles(false)}
      />
    );
  }

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
          {!filesChosen ? (
            <Text color="red">(no choice — press <Text bold>F</Text> for files or <Text bold>W</Text> for whole project)</Text>
          ) : step.files.length === 0 ? (
            <Text color="yellow">[whole project — runs once with no file scope]</Text>
          ) : (
            <Text color="green">{step.files.length} file(s) selected</Text>
          )}
          {field === 'files' && filesChosen && (
            <Text dimColor>   <Text bold>F</Text> pick files · <Text bold>W</Text> whole project</Text>
          )}
        </Box>

        <Box marginTop={2} flexDirection="column">
          <Text dimColor>
            <Text bold>TAB</Text> cycle fields · <Text bold>ENTER</Text> in name/prompt moves to the next field
          </Text>
          <Text>
            <Text bold>ESC</Text>{' '}
            {canSave ? (
              <Text color="green">save and close</Text>
            ) : !filesChosen ? (
              <Text color="red">cancel — choose Files (F or W) before saving</Text>
            ) : (
              <Text color="red">cancel and discard</Text>
            )}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
