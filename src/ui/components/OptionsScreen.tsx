import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import {
  API_KEY_REGISTRY,
  configFilePath,
  resolveApiKeyWithSource,
  saveApiKey,
  type ApiKeyResolution,
  type ApiKeySpec,
} from '../../lib/api-key.js';
import {
  DEFAULT_RAM_PERCENT,
  MAX_RAM_PERCENT,
  MIN_RAM_PERCENT,
  clampPercent,
} from '../../lib/budget.js';
import {
  effectiveRamPercent,
  loadWebSettings,
  saveWebSettings,
  webSettingsPath,
} from '../../lib/web-settings.js';
import { theme } from '../theme.js';
import { ActionBar, type ActionHint } from './ActionBar.js';
import { t } from '../../lib/i18n/index.js';

interface Props {
  /** When set, the cursor starts on the spec whose `name` matches. */
  focusSpecName?: string;
  onClose: () => void;
}

/**
 * The RAM dial occupies row 0; the credential registry follows. One flat cursor
 * over both so the screen keeps a single ↑↓/ENTER model.
 */
const RAM_ROW = 0;
const FIRST_KEY_ROW = 1;

/** Where the dial currently in force came from — mirrors the key source labels. */
function describeRamSource(): string {
  if (loadWebSettings().ramPercent !== undefined) return t('tui.options.src_saved');
  const env = process.env.HUU_RAM_PERCENT?.trim();
  if (env) return t('tui.options.src_env', { envVar: 'HUU_RAM_PERCENT' });
  return t('tui.options.src_default');
}

/** Mask a secret for display: keep a short prefix, hide the rest. */
function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 6)}…${'•'.repeat(4)}`;
}

/**
 * Label for where the value came from, driven by the resolver's own `source`
 * so it stays truthful after the precedence change: a saved key now outranks
 * the env var, so the "saved globally" label also notes when it is overriding
 * an env var the user might have expected to win.
 */
function describeSource(res: ApiKeyResolution, spec: ApiKeySpec): string {
  switch (res.source) {
    case 'stored':
      return res.storedOverridesEnv ? t('tui.options.src_saved_override') : t('tui.options.src_saved');
    case 'env':
      return t('tui.options.src_env', { envVar: spec.envVar });
    case 'env-file':
      return t('tui.options.src_env_file', { envVar: spec.envFileVar ?? '' });
    case 'secret-mount':
      return t('tui.options.src_secret');
    default:
      return t('tui.options.src_generic');
  }
}

/**
 * Machine settings + provider/API-key editor. Row 0 is the machine-global RAM
 * budget dial (the same store the web ⚙ Settings panel writes — one machine, one
 * RAM); the rest are the credential registry, each showing its resolved (masked)
 * value and source and overwritable in place, persisting to the global config so
 * the fix survives the run. Opened from the Welcome screen ([O]) or automatically
 * when a run aborts on an auth failure (focused on the rejected provider).
 */
export function OptionsScreen({ focusSpecName, onClose }: Props): React.JSX.Element {
  const focusedSpecIndex = API_KEY_REGISTRY.findIndex((s) => s.name === focusSpecName);
  const [cursor, setCursor] = useState(
    focusedSpecIndex >= 0 ? FIRST_KEY_ROW + focusedSpecIndex : RAM_ROW,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Bump to force re-resolution of displayed values after a save.
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const lastRow = FIRST_KEY_ROW + API_KEY_REGISTRY.length - 1;
  const onRamRow = cursor === RAM_ROW;
  const current = API_KEY_REGISTRY[cursor - FIRST_KEY_ROW];
  const ramPercent = effectiveRamPercent();

  useInput((input, key) => {
    if (editing) {
      if (key.escape) {
        setEditing(false);
        setDraft('');
      }
      return; // TextInput owns the rest while editing.
    }
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(RAM_ROW, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(lastRow, c + 1));
    } else if (key.return) {
      // ALWAYS start empty — pre-filling the dial with the current value meant
      // typing "35" produced "7035" (TextInput appends), which then clamped to
      // 95 or parsed as NaN and saved nothing. The current value is shown in the
      // prompt label instead.
      setDraft('');
      setNotice(null);
      setEditing(true);
    }
  });

  /** Persist the machine-global dial. Applies to the NEXT run, not a live one. */
  const submitRamPercent = (raw: string): void => {
    const trimmed = raw.trim();
    const n = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(n)) {
      // Say so rather than closing silently: a stray keystroke used to look like
      // a successful save that changed nothing.
      setNotice(t('tui.options.ram_nan', { percent: ramPercent }));
    } else {
      const pct = clampPercent(n);
      saveWebSettings({ ...loadWebSettings(), ramPercent: pct });
      setNotice(
        pct === Math.round(n)
          ? t('tui.options.ram_saved', { percent: pct })
          : t('tui.options.ram_saved_clamped', { percent: pct, from: Math.round(n) }),
      );
      setVersion((v) => v + 1);
    }
    setEditing(false);
    setDraft('');
  };

  const handleSubmit = (raw: string): void => {
    if (onRamRow) {
      submitRamPercent(raw);
      return;
    }
    const v = raw.trim();
    if (v && current) {
      saveApiKey(current, v);
      // Mirror app.tsx's api-key handler: push into env so resolveApiKey and
      // any direct process.env readers see the new value this session.
      process.env[current.envVar] = v;
      setVersion((n) => n + 1);
    }
    setEditing(false);
    setDraft('');
  };

  const ramDraft = draft.trim();
  const ramDraftNum = Number(ramDraft);
  const validationWarning = onRamRow
    ? ramDraft === ''
      ? null
      : !Number.isFinite(ramDraftNum)
        ? t('tui.options.ram_digits_only', { min: MIN_RAM_PERCENT, max: MAX_RAM_PERCENT })
        : clampPercent(ramDraftNum) !== Math.round(ramDraftNum)
          ? t('tui.options.ram_will_clamp', {
              value: clampPercent(ramDraftNum),
              min: MIN_RAM_PERCENT,
              max: MAX_RAM_PERCENT,
            })
          : null
    : current?.validatePrefix && draft && !draft.startsWith(current.validatePrefix)
      ? t('tui.apikey.prefix_warning', { prefix: current.validatePrefix })
      : null;

  const hints: ActionHint[] = editing
    ? [
        { key: 'ENTER', label: t('common.action.save'), color: theme.success },
        { key: 'ESC', label: t('common.action.cancel'), color: theme.error },
      ]
    : [
        { key: '↑↓', label: t('common.action.select'), color: theme.info },
        {
          key: 'ENTER',
          label: onRamRow ? t('tui.options.hint_edit_ram') : t('tui.options.hint_edit_key'),
          color: theme.success,
        },
        { key: 'ESC', label: t('common.action.back'), color: theme.error },
      ];

  return (
    <Box flexDirection="column" width="100%">
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        flexDirection="column"
        width="100%"
      >
        <Text bold color="cyanBright">
          {t('tui.options.title')}
        </Text>
        <Text dimColor>
          {t('tui.options.paths', { credentials: configFilePath(), settings: webSettingsPath() })}
        </Text>

        {/* `key` includes `version` so the list remounts and re-resolves
            displayed values after a save. */}
        <Box key={`options-${version}`} marginTop={1} flexDirection="column">
          {/* Machine-global RAM budget dial — same store the web ⚙ Settings
              panel writes, because one machine has one RAM. */}
          <Box flexDirection="column">
            <Box>
              <Text color={onRamRow ? 'cyan' : undefined} bold={onRamRow}>
                {onRamRow ? '› ' : '  '}
                {t('tui.options.ram_row')}
              </Text>
              <Text dimColor>{`  —  ${t('tui.options.ram_desc')}`}</Text>
            </Box>
            <Box>
              <Text>{'    '}</Text>
              <Text color="green">
                {ramPercent}%
                <Text dimColor>{`  ·  ${t('tui.options.via', { source: describeRamSource() })}`}</Text>
              </Text>
              <Text dimColor>
                {'  '}·{' '}
                {t('tui.options.ram_range', {
                  min: MIN_RAM_PERCENT,
                  max: MAX_RAM_PERCENT,
                  default: DEFAULT_RAM_PERCENT,
                })}
              </Text>
            </Box>
          </Box>

          {API_KEY_REGISTRY.map((spec, i) => {
            const isCursor = i + FIRST_KEY_ROW === cursor;
            const res = resolveApiKeyWithSource(spec);
            const resolved = res.value;
            const source = describeSource(res, spec);
            return (
              <Box key={spec.name} flexDirection="column">
                <Box>
                  <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                    {isCursor ? '› ' : '  '}
                    {spec.label}
                  </Text>
                  {spec.required ? (
                    <Text color="yellow"> {t('tui.options.required')}</Text>
                  ) : null}
                  <Text dimColor>  —  {spec.envVar}</Text>
                </Box>
                <Box>
                  <Text>{'    '}</Text>
                  {resolved ? (
                    <Text color="green">
                      {maskValue(resolved)}
                      {source ? (
                        <Text dimColor>{`  ·  ${t('tui.options.via', { source })}`}</Text>
                      ) : null}
                    </Text>
                  ) : (
                    <Text color="red">{t('tui.options.not_set')}</Text>
                  )}
                  {spec.hint ? <Text dimColor>  ·  {spec.hint}</Text> : null}
                </Box>
                {res.storedOverridesEnv ? (
                  <Box>
                    <Text>{'    '}</Text>
                    <Text color={theme.warning}>
                      {t('tui.options.env_ignored', { envVar: spec.envVar })}
                    </Text>
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>

        {editing ? (
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text bold color="cyan">
                {onRamRow
                  ? t('tui.options.ram_prompt', { percent: ramPercent })
                  : t('tui.options.key_prompt', { label: current?.label ?? '' })}
              </Text>
              <TextInput
                value={draft}
                onChange={setDraft}
                onSubmit={handleSubmit}
                {...(onRamRow ? {} : { mask: '*' })}
              />
            </Box>
            {validationWarning ? (
              <Text color="yellow">⚠ {validationWarning}</Text>
            ) : null}
          </Box>
        ) : null}

        {notice && !editing ? (
          <Box marginTop={1}>
            <Text color={theme.success}>{notice}</Text>
          </Box>
        ) : null}

        <Box marginTop={1}>
          <ActionBar hints={hints} />
        </Box>
      </Box>
    </Box>
  );
}
