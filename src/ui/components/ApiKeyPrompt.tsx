import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  onSubmit: (apiKey: string) => void;
  onCancel: () => void;
}

export function ApiKeyPrompt({ onSubmit, onCancel }: Props): React.JSX.Element {
  const [value, setValue] = useState('');

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">OPENROUTER_API_KEY ausente</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Cole sua chave OpenRouter (sk-or-...). Ela so vive na memoria do processo;
        </Text>
        <Text>nao e gravada em disco.</Text>
      </Box>
      <Box marginTop={1}>
        <Text>API key: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => onSubmit(v.trim())}
          mask="*"
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter confirma · Esc cancela</Text>
      </Box>
    </Box>
  );
}
