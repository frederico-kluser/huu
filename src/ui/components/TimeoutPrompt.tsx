import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../theme.js';
import { t } from '../../lib/i18n/index.js';

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
      setError(t('tui.timeout.err_empty'));
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setError(t('tui.timeout.err_integer'));
      return;
    }
    const n = Number(trimmed);
    if (n <= 0) {
      setError(t('tui.timeout.err_min'));
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
          {t('tui.timeout.title')}
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text>{t('tui.timeout.description')}</Text>
          <Text dimColor>{t('tui.timeout.applies_to')}</Text>
        </Box>

        <Box marginTop={1}>
          <Text>{t('tui.timeout.field')}</Text>
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
            <Text bold>ENTER</Text> {t('common.action.confirm')} · <Text bold>ESC</Text>{' '}
            {t('common.action.cancel')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
