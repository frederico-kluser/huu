// Interactive configuration screen using Ink
// Replaces readline-based config with proper TUI

import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { Logo } from '../components/Logo.js';
import { Divider } from '../components/Divider.js';
import { Panel } from '../components/Panel.js';
import { KeyHint } from '../components/KeyHint.js';
import { StatusBadge } from '../components/StatusBadge.js';
import type { HuuConfig } from '../../cli/config.js';
import { CONFIGURABLE_KEYS, getConfigValue, setConfigValue } from '../../cli/config.js';

type ConfigStep = 'overview' | 'editing' | 'confirm' | 'saved';

interface ConfigScreenProps {
  config: HuuConfig;
  onSave: (config: HuuConfig) => void;
  onCancel: () => void;
}

interface ConfigField {
  key: string;
  label: string;
  value: string | number;
  type: 'number' | 'select';
  options?: string[] | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

function getFields(config: HuuConfig): ConfigField[] {
  return CONFIGURABLE_KEYS.map((k) => ({
    key: k.key,
    label: k.label,
    value: getConfigValue(config, k.key),
    type: k.type,
    options: k.options,
    min: k.min,
    max: k.max,
  }));
}

export function ConfigScreen({
  config,
  onSave,
  onCancel,
}: ConfigScreenProps): React.JSX.Element {
  const { exit } = useApp();
  const [step, setStep] = useState<ConfigStep>('overview');
  const [editingConfig, setEditingConfig] = useState<HuuConfig>(
    JSON.parse(JSON.stringify(config)) as HuuConfig,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState('');

  const fields = getFields(editingConfig);
  const originalFields = getFields(config);

  const handleFieldSelect = useCallback(() => {
    const field = fields[selectedIndex];
    if (!field) return;
    setEditValue(String(field.value));
    setEditError('');
    setStep('editing');
  }, [fields, selectedIndex]);

  useInput((input, key) => {
    if (step === 'overview') {
      if (key.escape || input === 'q') {
        onCancel();
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(fields.length - 1, i + 1));
        return;
      }
      if (key.return) {
        handleFieldSelect();
        return;
      }
      if (input === 's') {
        // Check if there are changes
        const hasChanges = fields.some(
          (f, i) => String(f.value) !== String(originalFields[i]?.value),
        );
        if (hasChanges) {
          setStep('confirm');
        }
        return;
      }
    }

    if (step === 'confirm') {
      if (input === 'y') {
        onSave(editingConfig);
        setStep('saved');
        return;
      }
      if (input === 'n' || key.escape) {
        setStep('overview');
        return;
      }
    }
  }, { isActive: step === 'overview' || step === 'confirm' });

  // ── Overview ──────────────────────────────────────────────────────
  if (step === 'overview') {
    const hasChanges = fields.some(
      (f, i) => String(f.value) !== String(originalFields[i]?.value),
    );

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title="Configuration" />

        <Box marginTop={1}>
          <Panel
            title="Settings"
            titleColor="cyan"
            borderColor="cyan"
            rightLabel={hasChanges ? 'unsaved changes' : undefined}
          >
            <Box flexDirection="column" paddingY={1}>
              {fields.map((field, i) => {
                const isSelected = i === selectedIndex;
                const isChanged = String(field.value) !== String(originalFields[i]?.value);

                return (
                  <Box key={field.key} gap={1}>
                    <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                      {isSelected ? '\u276F' : ' '}
                    </Text>
                    <Box width={30}>
                      <Text bold={isSelected} color={isSelected ? 'cyan' : 'white'}>
                        {field.label}
                      </Text>
                    </Box>
                    <Text color={isChanged ? 'green' : 'white'}>
                      {String(field.value)}
                    </Text>
                    {isChanged && (
                      <Text dimColor> (was: {String(originalFields[i]?.value)})</Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1}>
          <KeyHint bindings={[
            { key: '\u2191\u2193', label: 'Navigate' },
            { key: 'Enter', label: 'Edit' },
            ...(hasChanges ? [{ key: 'S', label: 'Save' }] : []),
            { key: 'Esc', label: 'Cancel' },
          ]} />
        </Box>
      </Box>
    );
  }

  // ── Editing a field ───────────────────────────────────────────────
  if (step === 'editing') {
    const field = fields[selectedIndex];
    if (!field) {
      setStep('overview');
      return <Box />;
    }

    if (field.type === 'select' && field.options) {
      const items = field.options.map((opt) => ({
        label: opt + (opt === String(field.value) ? ' (current)' : ''),
        value: opt,
      }));

      return (
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Logo compact />
          <Divider title={`Edit: ${field.label}`} />

          <Box marginTop={1}>
            <Panel title={field.label} titleColor="yellow" borderColor="yellow">
              <Box flexDirection="column" paddingY={1}>
                <SelectInput
                  items={items}
                  initialIndex={field.options.indexOf(String(field.value))}
                  onSelect={(item) => {
                    const updated = JSON.parse(JSON.stringify(editingConfig)) as HuuConfig;
                    setConfigValue(
                      updated,
                      field.key as Parameters<typeof setConfigValue>[1],
                      item.value,
                    );
                    setEditingConfig(updated);
                    setStep('overview');
                  }}
                />
              </Box>
            </Panel>
          </Box>

          <Box marginTop={1}>
            <KeyHint bindings={[
              { key: '\u2191\u2193', label: 'Navigate' },
              { key: 'Enter', label: 'Select' },
            ]} />
          </Box>
        </Box>
      );
    }

    // Number input
    const handleNumberSubmit = (value: string) => {
      const num = Number(value);
      if (isNaN(num)) {
        setEditError('Must be a number');
        return;
      }
      if (field.min !== undefined && num < field.min) {
        setEditError(`Must be >= ${field.min}`);
        return;
      }
      if (field.max !== undefined && num > field.max) {
        setEditError(`Must be <= ${field.max}`);
        return;
      }

      const updated = JSON.parse(JSON.stringify(editingConfig)) as HuuConfig;
      setConfigValue(
        updated,
        field.key as Parameters<typeof setConfigValue>[1],
        num,
      );
      setEditingConfig(updated);
      setStep('overview');
    };

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title={`Edit: ${field.label}`} />

        <Box marginTop={1}>
          <Panel title={field.label} titleColor="yellow" borderColor="yellow">
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Text dimColor>
                Range: {field.min ?? 0} - {field.max ?? 100} (current: {String(field.value)})
              </Text>

              <Box>
                <Text bold color="cyan">{'\u276F'} </Text>
                <TextInput
                  value={editValue}
                  onChange={(v) => { setEditValue(v); setEditError(''); }}
                  onSubmit={handleNumberSubmit}
                  placeholder={String(field.value)}
                />
              </Box>

              {editError && (
                <Text color="red">{'\u2716'} {editError}</Text>
              )}
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1}>
          <KeyHint bindings={[
            { key: 'Enter', label: 'Confirm' },
            { key: 'Esc', label: 'Cancel' },
          ]} />
        </Box>
      </Box>
    );
  }

  // ── Confirm ───────────────────────────────────────────────────────
  if (step === 'confirm') {
    const changes = fields
      .map((f, i) => ({ field: f, original: originalFields[i] }))
      .filter(({ field, original }) => String(field.value) !== String(original?.value));

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title="Save Configuration" />

        <Box marginTop={1}>
          <Panel title="Confirm Changes" titleColor="green" borderColor="green">
            <Box flexDirection="column" gap={1} paddingY={1}>
              {changes.map(({ field, original }) => (
                <Box key={field.key} gap={1}>
                  <Text bold>{field.label}:</Text>
                  <Text color="red" strikethrough>{String(original?.value)}</Text>
                  <Text dimColor>{'\u2192'}</Text>
                  <Text color="green" bold>{String(field.value)}</Text>
                </Box>
              ))}

              <Box marginTop={1}>
                <Text bold>Save changes? </Text>
                <Text color="green">[Y]es</Text>
                <Text dimColor> / </Text>
                <Text color="red">[N]o</Text>
              </Box>
            </Box>
          </Panel>
        </Box>
      </Box>
    );
  }

  // ── Saved ─────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Logo compact />
      <Divider />
      <Box marginTop={1}>
        <StatusBadge variant="success" label="Configuration saved successfully!" bold />
      </Box>
    </Box>
  );
}
