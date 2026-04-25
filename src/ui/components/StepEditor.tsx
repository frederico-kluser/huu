import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { PromptStep } from '../../lib/types.js';
import { FileMultiSelect } from './FileMultiSelect.js';

type Field = 'name' | 'prompt' | 'files' | 'done';

interface Props {
  initialStep: PromptStep;
  repoRoot: string;
  onSave: (step: PromptStep) => void;
  onCancel: () => void;
}

export function StepEditor({ initialStep, repoRoot, onSave, onCancel }: Props): React.JSX.Element {
  const [step, setStep] = useState<PromptStep>(initialStep);
  const [field, setField] = useState<Field>('name');
  const [pickingFiles, setPickingFiles] = useState(false);

  useInput((input, key) => {
    if (pickingFiles) return;
    if (key.escape) onCancel();
    if (field === 'done') {
      if (key.return) onSave(step);
      if (input === 'e') setField('name');
      return;
    }
    if (key.tab && !key.shift) {
      setField((f) => (f === 'name' ? 'prompt' : f === 'prompt' ? 'files' : 'done'));
    } else if (key.tab && key.shift) {
      setField((f) => (f === 'done' ? 'files' : f === 'files' ? 'prompt' : 'name'));
    } else if (field === 'files' && key.return) {
      setPickingFiles(true);
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

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">Editar etapa</Text>

      <Box marginTop={1}>
        <Text color={field === 'name' ? 'cyan' : undefined}>Nome: </Text>
        {field === 'name' ? (
          <TextInput
            value={step.name}
            onChange={(v) => setStep({ ...step, name: v })}
            onSubmit={() => setField('prompt')}
          />
        ) : (
          <Text>{step.name || <Text dimColor>(vazio)</Text>}</Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={field === 'prompt' ? 'cyan' : undefined}>Prompt:</Text>
        {field === 'prompt' ? (
          <TextInput
            value={step.prompt}
            onChange={(v) => setStep({ ...step, prompt: v })}
            onSubmit={() => setField('files')}
            placeholder="Use $file quando arquivos selecionados"
          />
        ) : (
          <Text>{step.prompt || <Text dimColor>(vazio)</Text>}</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={field === 'files' ? 'cyan' : undefined}>
          Arquivos: {step.files.length === 0 ? <Text color="yellow">[rodada livre]</Text> : <Text>{step.files.length} selecionados</Text>}
        </Text>
        {field === 'files' && <Text dimColor>  Enter para abrir o seletor</Text>}
      </Box>

      <Box marginTop={1}>
        <Text color={field === 'done' ? 'cyan' : 'green'}>
          {field === 'done' ? '> ' : '  '}[ Salvar etapa ]
        </Text>
        {field === 'done' && <Text dimColor>  Enter confirma · e edita de novo</Text>}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Tab/Shift+Tab navega · Esc cancela</Text>
      </Box>
    </Box>
  );
}
