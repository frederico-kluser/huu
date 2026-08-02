import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { configFilePath, type ApiKeySpec } from '../../lib/api-key.js';
import { t } from '../../lib/i18n/index.js';

interface Props {
  /**
   * Specs the user must fill in. The wizard walks them in order and
   * surfaces the values + the "save globally" preference back via
   * onSubmit when every spec has a non-empty value.
   */
  specs: readonly ApiKeySpec[];
  onSubmit: (values: Record<string, string>, saveGlobally: boolean) => void;
  onCancel: () => void;
}

/**
 * Multi-step wizard that prompts for any API keys huu couldn't resolve
 * from env / docker secret / global store. Driven by the registry, so
 * adding a new key elsewhere automatically extends this UI.
 *
 * UX:
 *   - One spec at a time, with a "(N/M)" header.
 *   - Optional prefix validation surfaced as a soft warning (does NOT
 *     block submit — keys can change format and we don't want to lock
 *     the user out over a stale check).
 *   - "Save globally" toggle (default ON). When ON, values are written
 *     to ~/.config/huu/config.json so subsequent runs skip the prompt.
 *   - Tab toggles save preference; Enter advances; ESC cancels.
 */
export function ApiKeyPrompt({ specs, onSubmit, onCancel }: Props): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [value, setValue] = useState('');
  const [accumulated, setAccumulated] = useState<Record<string, string>>({});
  const [saveGlobally, setSaveGlobally] = useState(true);

  const current = specs[step];

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      setSaveGlobally((s) => !s);
    }
  });

  if (!current) {
    // Defensive: parent should not mount with an empty list, but if it
    // does we surrender control rather than render a blank box.
    return (
      <Box>
        <Text color="red">{t('tui.apikey.no_specs')}</Text>
      </Box>
    );
  }

  const handleSubmit = (raw: string): void => {
    const v = raw.trim();
    if (!v) return; // require non-empty before advancing
    const next = { ...accumulated, [current.name]: v };
    setAccumulated(next);
    setValue('');
    if (step + 1 < specs.length) {
      setStep(step + 1);
    } else {
      onSubmit(next, saveGlobally);
    }
  };

  const validationWarning =
    current.validatePrefix && value && !value.startsWith(current.validatePrefix)
      ? t('tui.apikey.prefix_warning', { prefix: current.validatePrefix })
      : null;

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="yellow">
          {t('tui.apikey.title', { envVar: current.envVar, step: step + 1, total: specs.length })}
        </Text>

        <Box marginTop={1} flexDirection="column">
          {/* One sentence, one key: the provider label is a placeholder so
              translators keep control of word order (it loses the inline bold
              the English-only version had — a fair trade for translatability). */}
          <Text>
            {t('tui.apikey.paste', {
              label: current.label,
              hint: current.hint ? ` (${current.hint})` : '',
            })}
          </Text>
          {saveGlobally ? (
            <Text dimColor>{t('tui.apikey.save_to', { path: configFilePath() })}</Text>
          ) : (
            <Text dimColor>{t('tui.apikey.save_disabled')}</Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text>{t('tui.apikey.field')}</Text>
          <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} mask="*" />
        </Box>

        {validationWarning && (
          <Box marginTop={1}>
            <Text color="yellow">⚠ {validationWarning}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text>
            <Text bold>[{saveGlobally ? 'x' : ' '}]</Text> {t('tui.apikey.save_globally')}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>ENTER</Text> {t('common.action.next')} · <Text bold>TAB</Text>{' '}
            {t('tui.apikey.toggle_save')} · <Text bold>ESC</Text> {t('common.action.cancel')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
