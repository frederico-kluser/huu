import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { PromptStep } from '../../lib/types.js';
import { FileMultiSelect } from './FileMultiSelect.js';

type Field = 'name' | 'prompt' | 'files';
type EditorMode = 'selecting' | 'editing';

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
  const [editorMode, setEditorMode] = useState<EditorMode>('selecting');
  const [pickingFiles, setPickingFiles] = useState(false);
  // Files choice must be explicit. Treat existing steps (already-edited prompt
  // or files already selected) as previously chosen.
  const [filesChosen, setFilesChosen] = useState<boolean>(
    initialStep.files.length > 0 || initialStep.prompt.length > 0,
  );
  const canSave = Boolean(step.name && step.prompt && filesChosen);

  useInput((input, key) => {
    if (pickingFiles) return;

    if (editorMode === 'editing') {
      if (key.escape) {
        setEditorMode('selecting');
      }
      return;
    }

    if (key.escape) {
      if (canSave) {
        onSave(step);
      } else {
        onCancel();
      }
      return;
    }

    if (key.upArrow) {
      setField((f) => (f === 'files' ? 'prompt' : f === 'prompt' ? 'name' : 'name'));
    } else if (key.downArrow) {
      setField((f) => (f === 'name' ? 'prompt' : f === 'prompt' ? 'files' : 'files'));
    } else if (key.tab) {
      setField((f) => (f === 'name' ? 'prompt' : f === 'prompt' ? 'files' : 'name'));
    } else if (key.return) {
      if (field !== 'files') {
        setEditorMode('editing');
      }
    } else if (field === 'files') {
      if (input === 'f' || input === 'F') {
        setPickingFiles(true);
      } else if (input === 'w' || input === 'W') {
        setStep({ ...step, files: [] });
        setFilesChosen(true);
      }
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

  const promptDisplay = step.prompt
    ? step.prompt.length > 60
      ? step.prompt.slice(0, 60) + '...'
      : step.prompt
    : null;

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">Edit step #{stepIndex + 1}</Text>

        <Box marginTop={1}>
          <Box width={10}><Text color={field === 'name' ? 'cyan' : undefined}>Name:</Text></Box>
          {field === 'name' && editorMode === 'editing' ? (
            <TextInput
              value={step.name}
              onChange={(v) => setStep({ ...step, name: v })}
              onSubmit={() => setField('prompt')}
              placeholder="e.g. Refactor headers"
            />
          ) : (
            <Text>{step.name || <Text dimColor>(empty)</Text>}</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={field === 'prompt' ? 'cyan' : undefined}>Prompt:</Text>
          {field === 'prompt' && editorMode === 'editing' ? (
            <TextInput
              value={step.prompt}
              onChange={(v) => setStep({ ...step, prompt: v })}
              onSubmit={() => {
                setField('files');
                setEditorMode('selecting');
              }}
              placeholder="Use $file when files are selected"
            />
          ) : (
            <Text>{promptDisplay || <Text dimColor>(empty)</Text>}</Text>
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
          {editorMode === 'selecting' ? (
            <>
              <Text dimColor>
                <Text bold>↑↓</Text> select · <Text bold>TAB</Text> cycle · <Text bold>ENTER</Text> edit
                {field === 'files' && (
                  <> · <Text bold>F</Text> pick files · <Text bold>W</Text> whole project</>
                )}
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
            </>
          ) : (
            <Text dimColor>
              <Text bold>ESC</Text> exit editing · <Text bold>ENTER</Text> next field
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
