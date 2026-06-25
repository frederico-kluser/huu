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
import { theme } from '../theme.js';
import { ActionBar, type ActionHint } from './ActionBar.js';

interface Props {
  /** When set, the cursor starts on the spec whose `name` matches. */
  focusSpecName?: string;
  onClose: () => void;
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
      return res.storedOverridesEnv ? 'saved globally (overrides env)' : 'saved globally';
    case 'env':
      return `${spec.envVar} (env)`;
    case 'env-file':
      return `${spec.envFileVar} (file)`;
    case 'secret-mount':
      return 'mounted secret';
    default:
      return 'env/secret';
  }
}

/**
 * Provider / API-key editor. Lists every credential in the registry, shows
 * its resolved (masked) value and source, and lets the user overwrite any
 * one — persisting to the global config so the fix survives the run. Opened
 * from the Welcome screen ([O]) or automatically when a run aborts on an
 * auth failure (focused on the rejected provider).
 */
export function OptionsScreen({ focusSpecName, onClose }: Props): React.JSX.Element {
  const initialCursor = Math.max(
    0,
    API_KEY_REGISTRY.findIndex((s) => s.name === focusSpecName),
  );
  const [cursor, setCursor] = useState(initialCursor);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Bump to force re-resolution of displayed values after a save.
  const [version, setVersion] = useState(0);

  const current = API_KEY_REGISTRY[cursor]!;

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
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(API_KEY_REGISTRY.length - 1, c + 1));
    } else if (key.return) {
      setDraft('');
      setEditing(true);
    }
  });

  const handleSubmit = (raw: string): void => {
    const v = raw.trim();
    if (v) {
      saveApiKey(current, v);
      // Mirror app.tsx's api-key handler: push into env so resolveApiKey and
      // any direct process.env readers see the new value this session.
      process.env[current.envVar] = v;
      setVersion((n) => n + 1);
    }
    setEditing(false);
    setDraft('');
  };

  const validationWarning =
    current.validatePrefix && draft && !draft.startsWith(current.validatePrefix)
      ? `expected to start with "${current.validatePrefix}"`
      : null;

  const hints: ActionHint[] = editing
    ? [
        { key: 'ENTER', label: 'save', color: theme.success },
        { key: 'ESC', label: 'cancel', color: theme.error },
      ]
    : [
        { key: '↑↓', label: 'select', color: theme.info },
        { key: 'ENTER', label: 'edit key', color: theme.success },
        { key: 'ESC', label: 'back', color: theme.error },
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
          Options — AI providers & API keys
        </Text>
        <Text dimColor>
          Edit a provider credential. Saved to {configFilePath()} (mode 0600).
        </Text>

        {/* `key` includes `version` so the list remounts and re-resolves
            displayed values after a save. */}
        <Box key={`providers-${version}`} marginTop={1} flexDirection="column">
          {API_KEY_REGISTRY.map((spec, i) => {
            const isCursor = i === cursor;
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
                    <Text color="yellow"> (required)</Text>
                  ) : null}
                  <Text dimColor>  —  {spec.envVar}</Text>
                </Box>
                <Box>
                  <Text>{'    '}</Text>
                  {resolved ? (
                    <Text color="green">
                      {maskValue(resolved)}
                      {source ? <Text dimColor>  ·  via {source}</Text> : null}
                    </Text>
                  ) : (
                    <Text color="red">(not set)</Text>
                  )}
                  {spec.hint ? <Text dimColor>  ·  {spec.hint}</Text> : null}
                </Box>
                {res.storedOverridesEnv ? (
                  <Box>
                    <Text>{'    '}</Text>
                    <Text color={theme.warning}>
                      ⚠ {spec.envVar} is set but ignored — huu uses the saved key. Unset
                      it (or clear the saved key) to use the env var instead.
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
                New {current.label} key:{' '}
              </Text>
              <TextInput
                value={draft}
                onChange={setDraft}
                onSubmit={handleSubmit}
                mask="*"
              />
            </Box>
            {validationWarning ? (
              <Text color="yellow">⚠ {validationWarning}</Text>
            ) : null}
          </Box>
        ) : null}

        <Box marginTop={1}>
          <ActionBar hints={hints} />
        </Box>
      </Box>
    </Box>
  );
}
