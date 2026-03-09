// Tela interativa de configuração usando Ink
// Substitui config baseada em readline por TUI adequada

import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { Logo } from '../components/Logo.js';
import { Divider } from '../components/Divider.js';
import { Panel } from '../components/Panel.js';
import { KeyHint } from '../components/KeyHint.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { ModelSelector } from '../components/ModelSelector.js';
import { AGENT_ROLE_INFO } from '../../models/catalog.js';
import type { AgentRole } from '../../models/catalog.js';
import type { HuuConfig } from '../../cli/config.js';
import { CONFIGURABLE_KEYS, getConfigValue, setConfigValue, AGENT_ROLES } from '../../cli/config.js';

type ConfigStep = 'overview' | 'editing' | 'editing-model' | 'confirm' | 'saved';

interface ConfigScreenProps {
  config: HuuConfig;
  onSave: (config: HuuConfig) => void;
  onCancel: () => void;
}

interface ConfigField {
  key: string;
  label: string;
  value: string | number;
  type: 'number' | 'select' | 'model';
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

/** Extrai o papel do agente de uma chave de configuração como 'orchestrator.agentModels.builder' */
function extractAgentRole(configKey: string): AgentRole | null {
  const prefix = 'orchestrator.agentModels.';
  if (!configKey.startsWith(prefix)) return null;
  const role = configKey.slice(prefix.length);
  if (AGENT_ROLES.includes(role as AgentRole)) return role as AgentRole;
  return null;
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

    // Se o campo é um modelo de agente, abre o ModelSelector
    if (field.type === 'model') {
      setStep('editing-model');
      return;
    }

    setEditValue(String(field.value));
    setEditError('');
    setStep('editing');
  }, [fields, selectedIndex]);

  useInput((input: string, key: { escape: boolean; return: boolean; upArrow: boolean; downArrow: boolean }) => {
    if (step === 'overview') {
      if (key.escape || input === 'q') {
        onCancel();
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i: number) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i: number) => Math.min(fields.length - 1, i + 1));
        return;
      }
      if (key.return) {
        handleFieldSelect();
        return;
      }
      if (input === 's') {
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
      if (input === 'y' || input === 's') {
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

  // ── Visão geral ────────────────────────────────────────────────────
  if (step === 'overview') {
    const hasChanges = fields.some(
      (f, i) => String(f.value) !== String(originalFields[i]?.value),
    );

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title="Configuração" />

        <Box marginTop={1}>
          <Panel
            title="Configurações"
            titleColor="cyan"
            borderColor="cyan"
            rightLabel={hasChanges ? 'alterações não salvas' : undefined}
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
                      <Text dimColor> (antes: {String(originalFields[i]?.value)})</Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1}>
          <KeyHint bindings={[
            { key: '\u2191\u2193', label: 'Navegar' },
            { key: 'Enter', label: 'Editar' },
            ...(hasChanges ? [{ key: 'S', label: 'Salvar' }] : []),
            { key: 'Esc', label: 'Cancelar' },
          ]} />
        </Box>
      </Box>
    );
  }

  // ── Editando modelo de agente (com ModelSelector) ─────────────────
  if (step === 'editing-model') {
    const field = fields[selectedIndex];
    if (!field) {
      setStep('overview');
      return <Box />;
    }

    const agentRole = extractAgentRole(field.key);
    if (!agentRole) {
      setStep('overview');
      return <Box />;
    }

    const roleInfo = AGENT_ROLE_INFO[agentRole];

    const handleModelSelected = (modelId: string) => {
      const updated = JSON.parse(JSON.stringify(editingConfig)) as HuuConfig;
      setConfigValue(
        updated,
        field.key as Parameters<typeof setConfigValue>[1],
        modelId,
      );
      setEditingConfig(updated);
      setStep('overview');
    };

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title={`Editar: ${roleInfo.displayName}`} />

        <Box marginTop={1}>
          <Panel title={roleInfo.displayName} titleColor="yellow" borderColor="yellow">
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Text>{roleInfo.description}</Text>
              <Text dimColor italic>
                {'\u{1F4A1}'} {roleInfo.modelRationale}
              </Text>
              <Text dimColor>
                Modelo atual: {String(field.value)}
              </Text>

              <Box marginTop={1}>
                <ModelSelector
                  role={agentRole}
                  onSelect={handleModelSelected}
                  isActive={step === 'editing-model'}
                />
              </Box>
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1}>
          <KeyHint bindings={[
            { key: 'Esc', label: 'Voltar' },
          ]} />
        </Box>
      </Box>
    );
  }

  // ── Editando um campo ─────────────────────────────────────────────
  if (step === 'editing') {
    const field = fields[selectedIndex];
    if (!field) {
      setStep('overview');
      return <Box />;
    }

    if (field.type === 'select' && field.options) {
      const items = field.options.map((opt) => ({
        label: opt + (opt === String(field.value) ? ' (atual)' : ''),
        value: opt,
      }));

      return (
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Logo compact />
          <Divider title={`Editar: ${field.label}`} />

          <Box marginTop={1}>
            <Panel title={field.label} titleColor="yellow" borderColor="yellow">
              <Box flexDirection="column" paddingY={1}>
                <SelectInput
                  items={items}
                  initialIndex={field.options.indexOf(String(field.value))}
                  onSelect={(item: { value: string }) => {
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
              { key: '\u2191\u2193', label: 'Navegar' },
              { key: 'Enter', label: 'Selecionar' },
            ]} />
          </Box>
        </Box>
      );
    }

    // Input numérico
    const handleNumberSubmit = (value: string) => {
      const num = Number(value);
      if (isNaN(num)) {
        setEditError('Deve ser um número');
        return;
      }
      if (field.min !== undefined && num < field.min) {
        setEditError(`Deve ser >= ${field.min}`);
        return;
      }
      if (field.max !== undefined && num > field.max) {
        setEditError(`Deve ser <= ${field.max}`);
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
        <Divider title={`Editar: ${field.label}`} />

        <Box marginTop={1}>
          <Panel title={field.label} titleColor="yellow" borderColor="yellow">
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Text dimColor>
                Intervalo: {field.min ?? 0} - {field.max ?? 100} (atual: {String(field.value)})
              </Text>

              <Box>
                <Text bold color="cyan">{'\u276F'} </Text>
                <TextInput
                  value={editValue}
                  onChange={(v: string) => { setEditValue(v); setEditError(''); }}
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
            { key: 'Enter', label: 'Confirmar' },
            { key: 'Esc', label: 'Cancelar' },
          ]} />
        </Box>
      </Box>
    );
  }

  // ── Confirmar ──────────────────────────────────────────────────────
  if (step === 'confirm') {
    const changes = fields
      .map((f, i) => ({ field: f, original: originalFields[i] }))
      .filter(({ field, original }) => String(field.value) !== String(original?.value));

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title="Salvar Configuração" />

        <Box marginTop={1}>
          <Panel title="Confirmar Alterações" titleColor="green" borderColor="green">
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
                <Text bold>Salvar alterações? </Text>
                <Text color="green">[S/Y] Sim</Text>
                <Text dimColor> / </Text>
                <Text color="red">[N] Não</Text>
              </Box>
            </Box>
          </Panel>
        </Box>
      </Box>
    );
  }

  // ── Salvo ──────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Logo compact />
      <Divider />
      <Box marginTop={1}>
        <StatusBadge variant="success" label="Configuração salva com sucesso!" bold />
      </Box>
    </Box>
  );
}
