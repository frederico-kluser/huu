import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import {
  API_KEY_REGISTRY,
  configFilePath,
  loadStoredApiKey,
  resolveApiKey,
  saveApiKey,
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
 * Best-effort label for where the value came from. We don't re-read the
 * secret/file paths here (resolveApiKey already did); env and the global
 * store are the cases the user can act on, so those are named precisely and
 * everything else falls back to a generic "env/secret".
 */
function describeSource(spec: ApiKeySpec): string {
  if ((process.env[spec.envVar] ?? '').trim()) return `${spec.envVar} (env)`;
  if (loadStoredApiKey(spec)) return 'saved globally';
  return 'env/secret';
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
            const resolved = resolveApiKey(spec);
            const source = describeSource(spec);
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
