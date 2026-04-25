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
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="yellow">OPENROUTER_API_KEY missing</Text>

        <Box marginTop={1} flexDirection="column">
          <Text>Paste your OpenRouter API key (starts with <Text bold>sk-or-</Text>).</Text>
          <Text dimColor>The key lives only in process memory; it is not written to disk.</Text>
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
          <Text dimColor>
            <Text bold>ENTER</Text> confirm · <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
