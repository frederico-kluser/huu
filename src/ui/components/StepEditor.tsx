import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import type { PromptStep, StepScope } from '../../lib/types.js';
import { FileMultiSelect } from './FileMultiSelect.js';
import { ModelSelectorOverlay } from './ModelSelectorOverlay.js';

type Field = 'name' | 'prompt' | 'scope' | 'files' | 'model' | 'interactive';
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

const SCOPE_CYCLE: StepScope[] = ['flexible', 'project', 'per-file'];
function nextScope(current: StepScope): StepScope {
  const i = SCOPE_CYCLE.indexOf(current);
  return SCOPE_CYCLE[(i + 1) % SCOPE_CYCLE.length]!;
}

function scopeLabel(scope: StepScope): string {
  switch (scope) {
    case 'project': return 'whole project (locked)';
    case 'per-file': return 'per file (must pick files)';
    case 'flexible': return 'flexible (choose at edit time)';
  }
}

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

  const scope: StepScope = step.scope ?? 'flexible';

  // For flexible scope, files choice must be explicit. Treat existing steps
  // (already-edited prompt or files already selected) as previously chosen.
  // For project/per-file, "chosen" is derived from scope so this state is
  // ignored.
  const [filesChosen, setFilesChosen] = useState<boolean>(
    initialStep.files.length > 0 || initialStep.prompt.length > 0,
  );

  const filesValid =
    scope === 'project' ? true :
    scope === 'per-file' ? step.files.length > 0 :
    filesChosen;
  const canSave = Boolean(step.name && step.prompt && filesValid);

  function applyScope(s: StepScope): void {
    if (s === 'project') {
      setStep({ ...step, scope: s, files: [] });
      setFilesChosen(true);
    } else if (s === 'per-file') {
      setStep({ ...step, scope: s });
      setFilesChosen(step.files.length > 0);
    } else {
      setStep({ ...step, scope: s });
    }
  }

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
        f === 'interactive' ? 'model' :
        f === 'model' ? 'files' :
        f === 'files' ? 'scope' :
        f === 'scope' ? 'prompt' :
        f === 'prompt' ? 'name' :
        'name',
      );
    } else if (key.downArrow) {
      setField((f) =>
        f === 'name' ? 'prompt' :
        f === 'prompt' ? 'scope' :
        f === 'scope' ? 'files' :
        f === 'files' ? 'model' :
        f === 'model' ? 'interactive' :
        'interactive',
      );
    } else if (key.tab) {
      setField((f) =>
        f === 'name' ? 'prompt' :
        f === 'prompt' ? 'scope' :
        f === 'scope' ? 'files' :
        f === 'files' ? 'model' :
        f === 'model' ? 'interactive' :
        'name',
      );
    } else if (key.return) {
      if (field === 'name' || field === 'prompt') {
        setEditorMode('editing');
      } else if (field === 'scope') {
        applyScope(nextScope(scope));
      } else if (field === 'files') {
        // ENTER opens the picker when scope is per-file (forced) or flexible
        // and files have already been chosen explicitly. For 'project', the
        // selection is locked to whole-project — ENTER is a no-op.
        if (scope === 'per-file') {
          setPickingFiles(true);
        } else if (scope === 'flexible' && filesChosen) {
          setPickingFiles(true);
        }
      } else if (field === 'model') {
        setPickingModel(true);
      } else if (field === 'interactive') {
        setStep({ ...step, interactive: !step.interactive });
      }
    } else if (field === 'scope') {
      if (input === 'p' || input === 'P') applyScope('project');
      else if (input === 'f' || input === 'F') applyScope('per-file');
      else if (input === 'x' || input === 'X') applyScope('flexible');
    } else if (field === 'files') {
      if (scope === 'project') {
        // Locked: F/W disabled.
      } else if (scope === 'per-file') {
        // Only F (or ENTER) opens picker; W is disabled because per-file
        // requires actual files.
        if (input === 'f' || input === 'F') setPickingFiles(true);
      } else {
        // flexible
        if (input === 'f' || input === 'F') {
          setPickingFiles(true);
        } else if (input === 'w' || input === 'W') {
          setStep({ ...step, files: [] });
          setFilesChosen(true);
        }
      }
    } else if (field === 'model') {
      if (input === 'm' || input === 'M') {
        setPickingModel(true);
      } else if (input === 'c' || input === 'C') {
        const { modelId: _omit, ...rest } = step;
        setStep(rest);
      }
    } else if (field === 'interactive') {
      if (input === 't' || input === 'T' || input === ' ') {
        setStep({ ...step, interactive: !step.interactive });
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

  const promptText = step.prompt
    ? step.prompt.length > 60
      ? step.prompt.slice(0, 60) + '...'
      : step.prompt
    : null;
  // Highlight the literal $file token in green so the user sees where the
  // orchestrator will substitute the agent's file. Stays literal in the text;
  // we only color it for visibility.
  const promptDisplayParts: React.JSX.Element[] | null = promptText
    ? promptText.split(/(\$file)/g).map((seg, i) =>
        seg === '$file' ? (
          <Text key={i} bold color="green">
            $file
          </Text>
        ) : (
          <Text key={i}>{seg}</Text>
        ),
      )
    : null;
  const fileToken = step.files.length > 0 && !step.prompt.includes('$file');

  const scopeColor =
    scope === 'project' ? 'magenta' :
    scope === 'per-file' ? 'blue' :
    'yellow';

    return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">Edit step #{stepIndex + 1}</Text>

        <Box marginTop={1}>
          <Text color="cyan">{field === 'name' ? '› ' : '  '}</Text>
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
          <Text color="cyan">{field === 'prompt' ? '› ' : '  '}</Text>
          <Text color={field === 'prompt' ? 'cyan' : undefined}>Prompt:</Text>
          {field === 'prompt' && editorMode === 'editing' ? (
            <TextInput
              value={step.prompt}
              onChange={(v) => setStep({ ...step, prompt: v })}
              onSubmit={() => {
                setField('scope');
                setEditorMode('selecting');
              }}
              placeholder="Use $file when files are selected"
            />
          ) : (
            <Text>
              {promptDisplayParts ?? <Text dimColor>(empty)</Text>}
              {fileToken && <Text dimColor>  ⚠ files set but $file not in prompt</Text>}
            </Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text color="cyan">{field === 'scope' ? '› ' : '  '}</Text>
          <Box width={10}><Text color={field === 'scope' ? 'cyan' : undefined}>Scope:</Text></Box>
          <Text color={scopeColor}>{scopeLabel(scope)}</Text>
          {field === 'scope' && (
            <Text dimColor>   <Text bold>ENTER</Text> cycle · <Text bold>P</Text> project · <Text bold>F</Text> per-file · <Text bold>X</Text> flexible</Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text color="cyan">{field === 'files' ? '› ' : '  '}</Text>
          <Box width={10}><Text color={field === 'files' ? 'cyan' : undefined}>Files:</Text></Box>
          {scope === 'project' ? (
            <Text color="yellow">[whole project — locked by scope]</Text>
          ) : scope === 'per-file' ? (
            step.files.length === 0 ? (
              <Text color="red">(no files — press <Text bold>ENTER</Text> or <Text bold>F</Text> to pick)</Text>
            ) : (
              <Text color="green">{step.files.length} file(s) selected</Text>
            )
          ) : !filesChosen ? (
            <Text color="red">(no choice — press <Text bold>F</Text> for files or <Text bold>W</Text> for whole project)</Text>
          ) : step.files.length === 0 ? (
            <Text color="yellow">[whole project — runs once with no file scope]</Text>
          ) : (
            <Text color="green">{step.files.length} file(s) selected</Text>
          )}
          {field === 'files' && scope === 'per-file' && (
            <Text dimColor>   <Text bold>ENTER</Text>/<Text bold>F</Text> pick files</Text>
          )}
          {field === 'files' && scope === 'flexible' && filesChosen && (
            <Text dimColor>   <Text bold>F</Text> pick files · <Text bold>W</Text> whole project</Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text color="cyan">{field === 'model' ? '› ' : '  '}</Text>
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

        <Box marginTop={1}>
          <Text color="cyan">{field === 'interactive' ? '› ' : '  '}</Text>
          <Box width={12}><Text color={field === 'interactive' ? 'cyan' : undefined}>Interactive:</Text></Box>
          {step.interactive ? (
            <Text color="magenta">⌬ ON — refinement chat opens before this stage runs</Text>
          ) : (
            <Text dimColor>off — stage runs the prompt as-is</Text>
          )}
          {field === 'interactive' && (
            <Text dimColor>   <Text bold>T</Text>/<Text bold>SPACE</Text>/<Text bold>ENTER</Text> toggle</Text>
          )}
        </Box>

        <Box marginTop={2} flexDirection="column">
          {editorMode === 'selecting' ? (
            <>
              <Text dimColor>
                <Text bold>↑↓</Text> select · <Text bold>TAB</Text> cycle · <Text bold>ENTER</Text> edit
                {field === 'scope' && (
                  <> · <Text bold>P</Text>/<Text bold>F</Text>/<Text bold>X</Text> set scope</>
                )}
                {field === 'files' && scope === 'per-file' && (
                  <> · <Text bold>F</Text> pick files</>
                )}
                {field === 'files' && scope === 'flexible' && (
                  <> · <Text bold>F</Text> pick files · <Text bold>W</Text> whole project</>
                )}
                {field === 'model' && (
                  <> · <Text bold>M</Text> pick model · <Text bold>C</Text> use global default</>
                )}
                {field === 'interactive' && (
                  <> · <Text bold>T</Text> toggle refinement chat</>
                )}
              </Text>
              <Text>
                <Text bold>ESC</Text>{' '}
                {canSave ? (
                  <Text color="green">save and close</Text>
                ) : scope === 'flexible' && !filesChosen ? (
                  <Text color="red">cancel — choose Files (F or W) before saving</Text>
                ) : scope === 'per-file' && step.files.length === 0 ? (
                  <Text color="red">cancel — per-file scope requires picking files</Text>
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
