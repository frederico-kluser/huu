import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import type { PromptStep } from '../../lib/types.js';
import { FileMultiSelect } from './FileMultiSelect.js';
import { ModelSelectorOverlay } from './ModelSelectorOverlay.js';

type Field = 'name' | 'prompt' | 'files' | 'model';
type EditorMode = 'selecting' | 'editing';

interface Props {
  initialStep: PromptStep;
  stepIndex: number;
  /** All steps in the pipeline. Used to offer "copy files from a previous step". */
  allSteps: PromptStep[];
  repoRoot: string;
  onSave: (step: PromptStep) => void;
  onCancel: () => void;
}

const FULL_CLEAR = '\x1b[3J';

export function StepEditor({ initialStep, stepIndex, allSteps, repoRoot, onSave, onCancel }: Props): React.JSX.Element {
  const { stdout } = useStdout();
  const [step, setStep] = useState<PromptStep>(initialStep);
  const [field, setField] = useState<Field>('name');
  const [editorMode, setEditorMode] = useState<EditorMode>('selecting');
  const [pickingFiles, setPickingFiles] = useState(false);
  const [pickingModel, setPickingModel] = useState(false);

  useEffect(() => {
    if (editorMode === 'selecting' && !pickingModel && stdout.isTTY) {
      stdout.write(FULL_CLEAR);
    }
  }, [editorMode, pickingModel, stdout]);
  // Files choice must be explicit. Treat existing steps (already-edited prompt
  // or files already selected) as previously chosen.
  const [filesChosen, setFilesChosen] = useState<boolean>(
    initialStep.files.length > 0 || initialStep.prompt.length > 0,
  );
  const canSave = Boolean(step.name && step.prompt && filesChosen);

  useInput((input, key) => {
    if (pickingFiles || pickingModel) return;

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
      setField((f) =>
        f === 'model' ? 'files' : f === 'files' ? 'prompt' : f === 'prompt' ? 'name' : 'name',
      );
    } else if (key.downArrow) {
      setField((f) =>
        f === 'name' ? 'prompt' : f === 'prompt' ? 'files' : f === 'files' ? 'model' : 'model',
      );
    } else if (key.tab) {
      setField((f) =>
        f === 'name' ? 'prompt' : f === 'prompt' ? 'files' : f === 'files' ? 'model' : 'name',
      );
    } else if (key.return) {
      if (field === 'name' || field === 'prompt') {
        setEditorMode('editing');
      } else if (field === 'model') {
        setPickingModel(true);
      }
    } else if (field === 'files') {
      if (input === 'f' || input === 'F') {
        setPickingFiles(true);
      } else if (input === 'w' || input === 'W') {
        setStep({ ...step, files: [] });
        setFilesChosen(true);
      }
    } else if (field === 'model') {
      if (input === 'm' || input === 'M') {
        setPickingModel(true);
      } else if (input === 'c' || input === 'C') {
        const { modelId: _omit, ...rest } = step;
        setStep(rest);
      }
    }
  });

  if (pickingFiles) {
    const previousSteps = allSteps
      .slice(0, stepIndex)
      .map((s, i) => ({ index: i, name: s.name, files: s.files }))
      .filter((s) => s.files.length > 0);
    return (
      <FileMultiSelect
        repoRoot={repoRoot}
        initialSelection={step.files}
        previousSteps={previousSteps}
        onCommit={(files) => {
          setStep({ ...step, files });
          setFilesChosen(true);
          setPickingFiles(false);
        }}
        onCancel={() => setPickingFiles(false)}
      />
    );
  }

  if (pickingModel) {
    return (
      <ModelSelectorOverlay
        onSelect={(modelId) => {
          setStep({ ...step, modelId });
          setPickingModel(false);
        }}
        onCancel={() => setPickingModel(false)}
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

        <Box marginTop={1} marginLeft={field === 'name' ? 2 : 0}>
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

        <Box marginTop={1} marginLeft={field === 'prompt' ? 2 : 0} flexDirection="column">
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

        <Box marginTop={1} marginLeft={field === 'files' ? 2 : 0}>
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

        <Box marginTop={1} marginLeft={field === 'model' ? 2 : 0}>
          <Box width={10}><Text color={field === 'model' ? 'cyan' : undefined}>Model:</Text></Box>
          {step.modelId ? (
            <Text color="green">🧠 {step.modelId}</Text>
          ) : (
            <Text dimColor>(global default — chosen on the next screen)</Text>
          )}
          {field === 'model' && (
            <Text dimColor>   <Text bold>M</Text> pick · <Text bold>C</Text> clear</Text>
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
                {field === 'model' && (
                  <> · <Text bold>M</Text> pick model · <Text bold>C</Text> use global default</>
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
