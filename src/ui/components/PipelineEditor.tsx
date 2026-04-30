import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import type { Pipeline, PromptStep } from '../../lib/types.js';
import {
  DEFAULT_CARD_TIMEOUT_MS,
  DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
} from '../../lib/types.js';
import { StepEditor } from './StepEditor.js';
import { log as dlog, bump as dbump } from '../../lib/debug-logger.js';
import { savePipelineToMemory } from '../../lib/pipeline-io.js';

interface Props {
  initialPipeline?: Pipeline;
  sourceName?: string;
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
  | { kind: 'naming-pipeline' }
  | { kind: 'editing-settings' };

function msToMin(ms: number): string {
  return (ms / 60_000).toString();
}

function minToMs(min: string): number | null {
  const trimmed = min.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 60_000);
}

function parseRetries(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > 3) return null;
  return n;
}

const FULL_CLEAR = '\x1b[3J';

export function PipelineEditor({
  initialPipeline,
  sourceName,
  repoRoot,
  onComplete,
  onImport,
  onExport,
  onCancel,
}: Props): React.JSX.Element {
  const { stdout } = useStdout();
  const [pipeline, setPipeline] = useState<Pipeline>(
    initialPipeline ?? { name: 'my-pipeline', steps: [{ ...EMPTY_STEP }] },
  );
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>(
    initialPipeline ? { kind: 'list' } : { kind: 'editing', index: 0 },
  );

  useEffect(() => {
    if (mode.kind === 'list' && stdout.isTTY) {
      stdout.write(FULL_CLEAR);
    }
  }, [mode.kind, stdout]);

  useEffect(() => {
    dlog('mount', 'PipelineEditor', { hasInitial: Boolean(initialPipeline) });
    return () => dlog('mount', 'PipelineEditor.unmount');
  }, [initialPipeline]);

  useEffect(() => {
    if (sourceName) {
      savePipelineToMemory(pipeline);
    }
  }, [pipeline, sourceName]);

  useEffect(() => {
    if (sourceName && pipeline.name === sourceName) {
      savePipelineToMemory(pipeline);
    }
  }, [pipeline, sourceName]);

  useInput((input, key) => {
    dbump('input.PipelineEditor');
    dlog('input', 'PipelineEditor.useInput', {
      mode: mode.kind,
      input,
      escape: key.escape,
      return: key.return,
      upArrow: key.upArrow,
      downArrow: key.downArrow,
      shift: key.shift,
    });
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
    } else if (input === 't' || input === 'T') {
      setMode({ kind: 'editing-settings' });
    } else if (input === 'i' || input === 'I') {
      onImport();
    } else if (input === 's' || input === 'S') {
      onExport(pipeline);
    } else if (key.return) {
      // ENTER is the only way to open the step editor.
      setMode({ kind: 'editing', index: cursor });
    } else if (input === 'g' || input === 'G') {
      const allValid = pipeline.steps.every(
        (s) => s.name && s.prompt && (s.scope !== 'per-file' || s.files.length > 0),
      );
      dlog('action', 'PipelineEditor.G_pressed', {
        allValid,
        stepCount: pipeline.steps.length,
        invalidSteps: pipeline.steps
          .map((s, i) => ({ i, name: s.name, hasPrompt: Boolean(s.prompt) }))
          .filter((s) => !s.name || !s.hasPrompt),
      });
      if (allValid) onComplete(pipeline);
    }
  });

  if (mode.kind === 'editing') {
    return (
      <StepEditor
        initialStep={pipeline.steps[mode.index]!}
        stepIndex={mode.index}
        allSteps={pipeline.steps}
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

  if (mode.kind === 'editing-settings') {
    return (
      <SettingsEditor
        initial={{
          cardTimeoutMs: pipeline.cardTimeoutMs ?? DEFAULT_CARD_TIMEOUT_MS,
          singleFileCardTimeoutMs: pipeline.singleFileCardTimeoutMs ?? DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS,
          maxRetries: pipeline.maxRetries ?? DEFAULT_MAX_RETRIES,
        }}
        onSave={(values) => {
          setPipeline((p) => ({ ...p, ...values }));
          setMode({ kind: 'list' });
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }

  const allValid = pipeline.steps.every(
    (s) => s.name && s.prompt && (s.scope !== 'per-file' || s.files.length > 0),
  );

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
            const scope = step.scope ?? 'flexible';
            const valid = Boolean(
              step.name &&
                step.prompt &&
                (scope !== 'per-file' || step.files.length > 0),
            );
            const fileBadge =
              scope === 'project' ? (
                <Text color="magenta">project</Text>
              ) : scope === 'per-file' ? (
                step.files.length === 0 ? (
                  <Text color="red">per-file (no files)</Text>
                ) : (
                  <Text color="blue">per-file · {step.files.length}</Text>
                )
              ) : step.files.length === 0 ? (
                <Text color="yellow">flex · whole project</Text>
              ) : (
                <Text color="green">flex · {step.files.length} file{step.files.length === 1 ? '' : 's'}</Text>
              );
            const modelBadge = step.modelId ? (
              <Text color="magenta">🧠 {step.modelId}</Text>
            ) : (
              <Text dimColor>🧠 global</Text>
            );
            return (
              <Box key={i}>
                <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                  {isCursor ? '› ' : '  '}#{i + 1}{'  '}
                  {step.name || <Text dimColor italic>(unnamed)</Text>}
                </Text>
                <Text dimColor>  —  </Text>
                {fileBadge}
                <Text dimColor>  ·  </Text>
                {modelBadge}
                {!valid && <Text color="red">  ⚠</Text>}
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            card timeout: {msToMin(pipeline.cardTimeoutMs ?? DEFAULT_CARD_TIMEOUT_MS)}min (multi/whole-project) · {msToMin(pipeline.singleFileCardTimeoutMs ?? DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS)}min (single-file) · retries: {pipeline.maxRetries ?? DEFAULT_MAX_RETRIES}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            <Text bold>↑↓</Text> select · <Text bold>SHIFT+↑↓</Text> reorder · <Text bold>ENTER</Text> edit · <Text bold>N</Text> new · <Text bold>D</Text> delete
          </Text>
          <Text dimColor>
            <Text bold>R</Text> rename · <Text bold>T</Text> timeouts · <Text bold>I</Text> import · <Text bold>S</Text> save · <Text bold>G</Text> run · <Text bold>ESC</Text> back
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

interface SettingsValues {
  cardTimeoutMs: number;
  singleFileCardTimeoutMs: number;
  maxRetries: number;
}

interface SettingsEditorProps {
  initial: SettingsValues;
  onSave: (values: SettingsValues) => void;
  onCancel: () => void;
}

type SettingsField = 'cardTimeout' | 'singleFileTimeout' | 'maxRetries';
type SettingsMode = 'selecting' | 'editing';

function SettingsEditor({ initial, onSave, onCancel }: SettingsEditorProps): React.JSX.Element {
  const [cardMin, setCardMin] = useState<string>(msToMin(initial.cardTimeoutMs));
  const [singleMin, setSingleMin] = useState<string>(msToMin(initial.singleFileCardTimeoutMs));
  const [retries, setRetries] = useState<string>(String(initial.maxRetries));
  const [field, setField] = useState<SettingsField>('cardTimeout');
  const [mode, setMode] = useState<SettingsMode>('selecting');

  const cardMs = minToMs(cardMin);
  const singleMs = minToMs(singleMin);
  const retriesN = parseRetries(retries);
  const allValid = cardMs !== null && singleMs !== null && retriesN !== null;

  useInput((_input, key) => {
    if (mode === 'editing') {
      if (key.escape) setMode('selecting');
      return;
    }
    if (key.escape) {
      if (allValid) {
        onSave({ cardTimeoutMs: cardMs!, singleFileCardTimeoutMs: singleMs!, maxRetries: retriesN! });
      } else {
        onCancel();
      }
      return;
    }
    if (key.upArrow) {
      setField((f) =>
        f === 'singleFileTimeout' ? 'cardTimeout' : f === 'maxRetries' ? 'singleFileTimeout' : 'cardTimeout',
      );
    } else if (key.downArrow || key.tab) {
      setField((f) =>
        f === 'cardTimeout' ? 'singleFileTimeout' : f === 'singleFileTimeout' ? 'maxRetries' : 'maxRetries',
      );
    } else if (key.return) {
      setMode('editing');
    }
  });

  const     fieldRow = (
    label: string,
    suffix: string,
    f: SettingsField,
    value: string,
    setValue: (v: string) => void,
    isValid: boolean,
  ) => (
    <Box marginTop={1}>
      <Text color="cyan">{field === f ? '› ' : '  '}</Text>
      <Box width={30}>
        <Text color={field === f ? 'cyan' : undefined}>{label}</Text>
      </Box>
      {field === f && mode === 'editing' ? (
        <TextInput value={value} onChange={setValue} onSubmit={() => setMode('selecting')} />
      ) : (
        <Text color={isValid ? undefined : 'red'}>
          {value || <Text dimColor>(empty)</Text>}
          <Text dimColor> {suffix}</Text>
        </Text>
      )}
    </Box>
  );

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">Card timeouts &amp; retries</Text>
        <Text dimColor>Os timeouts são aplicados POR CARD. Não existe limite de tempo para a pipeline inteira.</Text>

        {fieldRow('Whole-project card timeout:', 'min', 'cardTimeout', cardMin, setCardMin, cardMs !== null)}
        {fieldRow('Single-file card timeout:', 'min', 'singleFileTimeout', singleMin, setSingleMin, singleMs !== null)}
        {fieldRow('Max retries per card:', '(0–3)', 'maxRetries', retries, setRetries, retriesN !== null)}

        <Box marginTop={2} flexDirection="column">
          {mode === 'selecting' ? (
            <>
              <Text dimColor>
                <Text bold>↑↓</Text> select · <Text bold>TAB</Text> cycle · <Text bold>ENTER</Text> edit
              </Text>
              <Text>
                <Text bold>ESC</Text>{' '}
                {allValid ? (
                  <Text color="green">save and close</Text>
                ) : (
                  <Text color="red">cancel — fix invalid fields first</Text>
                )}
              </Text>
            </>
          ) : (
            <Text dimColor>
              <Text bold>ESC</Text> exit editing
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
