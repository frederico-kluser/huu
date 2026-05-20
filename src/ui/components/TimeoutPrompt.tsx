import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../theme.js';

interface Props {
  /** Default timeout in minutes shown in the input. */
  defaultMinutes?: number;
  onSubmit: (minutes: number) => void;
  onCancel: () => void;
}

/**
 * Pre-run prompt asking for the maximum time (in minutes) an agent may
 * spend on a single task card. Only positive integers are accepted;
 * non-numeric or non-integer input surfaces an inline error and blocks
 * submission until a valid value is entered.
 */
export function TimeoutPrompt({
  defaultMinutes = 10,
  onSubmit,
  onCancel,
}: Props): React.JSX.Element {
  const [value, setValue] = useState(String(defaultMinutes));
  const [error, setError] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const handleSubmit = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setError('Value cannot be empty.');
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setError('Only positive integer numbers are accepted.');
      return;
    }
    const n = Number(trimmed);
    if (n <= 0) {
      setError('Timeout must be at least 1 minute.');
      return;
    }
    setError(null);
    onSubmit(n);
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box
        borderStyle="round"
        borderColor={theme.info}
        paddingX={1}
        flexDirection="column"
        width="100%"
      >
        <Text bold color={theme.info}>
          ⏱  Agent task timeout
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text>
            Maximum time (in minutes) each agent may spend on a single task
            card before being terminated.
          </Text>
          <Text dimColor>
            Applies to every card in the pipeline (project, multi-file, and
            single-file).
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text>Timeout (min): </Text>
          <TextInput
            value={value}
            onChange={(v) => {
              setValue(v);
              if (error) setError(null);
            }}
            onSubmit={handleSubmit}
          />
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color={theme.error}>✖ {error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>ENTER</Text> confirm · <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
