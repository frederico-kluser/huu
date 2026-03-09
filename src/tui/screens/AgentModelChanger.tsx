// Tela guiada para trocar o modelo LLM de um agente durante o uso da aplicação.
// Fluxo: selecionar agente (com filtro) → selecionar modelo (com filtro) → confirmar.
// Reutiliza o ModelSelector compartilhado para seleção de modelo.

import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Logo } from '../components/Logo.js';
import { Divider } from '../components/Divider.js';
import { Panel } from '../components/Panel.js';
import { KeyHint } from '../components/KeyHint.js';
import { ModelSelector } from '../components/ModelSelector.js';
import { AGENT_ROLE_INFO, findModelById } from '../../models/catalog.js';
import type { AgentRole } from '../../models/catalog.js';
import { DEFAULT_AGENT_MODELS, AGENT_ROLES } from '../../cli/config.js';
import type { AgentModelConfig } from '../../cli/config.js';

type ChangerStep = 'select-agent' | 'select-model' | 'confirm';

interface AgentModelChangerProps {
  /** Modelos atuais (se undefined, usa os padrões) */
  currentModels?: AgentModelConfig | undefined;
  /** Callback ao salvar alterações */
  onSave: (models: AgentModelConfig) => void;
  /** Callback ao cancelar */
  onCancel: () => void;
}

export function AgentModelChanger({
  currentModels,
  onSave,
  onCancel,
}: AgentModelChangerProps): React.JSX.Element {
  const models = currentModels ?? { ...DEFAULT_AGENT_MODELS };
  const [step, setStep] = useState<ChangerStep>('select-agent');
  const [selectedRole, setSelectedRole] = useState<AgentRole | null>(null);
  const [newModelId, setNewModelId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [isFilteringAgents, setIsFilteringAgents] = useState(false);
  const [agentIdx, setAgentIdx] = useState(0);

  // Lista de agentes filtrada
  const filteredRoles = useMemo((): AgentRole[] => {
    if (!agentFilter.trim()) return [...AGENT_ROLES] as AgentRole[];
    const lower = agentFilter.toLowerCase();
    return (AGENT_ROLES.filter((role: AgentRole) => {
      const info = AGENT_ROLE_INFO[role];
      return (
        role.toLowerCase().includes(lower) ||
        info.displayName.toLowerCase().includes(lower) ||
        info.description.toLowerCase().includes(lower)
      );
    })) as AgentRole[];
  }, [agentFilter]);

  const handleAgentSelect = useCallback((role: AgentRole) => {
    setSelectedRole(role);
    setStep('select-model');
  }, []);

  const handleModelSelect = useCallback((modelId: string) => {
    setNewModelId(modelId);
    setStep('confirm');
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selectedRole || !newModelId) return;
    const updated = { ...models, [selectedRole]: newModelId };
    onSave(updated);
  }, [selectedRole, newModelId, models, onSave]);

  // Input para etapa de seleção de agente
  useInput((input: string, key: { escape: boolean; return: boolean; upArrow: boolean; downArrow: boolean }) => {
    if (step !== 'select-agent') return;

    if (key.escape) {
      if (isFilteringAgents) {
        setIsFilteringAgents(false);
        setAgentFilter('');
        setAgentIdx(0);
        return;
      }
      onCancel();
      return;
    }

    if (input === '/' && !isFilteringAgents) {
      setIsFilteringAgents(true);
      setAgentFilter('');
      return;
    }

    if (!isFilteringAgents) {
      if (key.upArrow) {
        setAgentIdx((i: number) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setAgentIdx((i: number) => Math.min(filteredRoles.length - 1, i + 1));
        return;
      }
      if (key.return && filteredRoles.length > 0) {
        const role = filteredRoles[agentIdx];
        if (role) handleAgentSelect(role);
        return;
      }
    } else {
      if (key.upArrow) {
        setAgentIdx((i: number) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setAgentIdx((i: number) => Math.min(filteredRoles.length - 1, i + 1));
        return;
      }
      if (key.return && filteredRoles.length > 0) {
        const role = filteredRoles[agentIdx];
        if (role) {
          setIsFilteringAgents(false);
          setAgentFilter('');
          handleAgentSelect(role);
        }
        return;
      }
    }
  }, { isActive: step === 'select-agent' });

  // Input para etapa de confirmação
  useInput((input: string, key: { escape: boolean; return: boolean }) => {
    if (step !== 'confirm') return;

    if (input === 's' || input === 'y') {
      handleConfirm();
      return;
    }
    if (input === 'n' || key.escape) {
      setStep('select-agent');
      setSelectedRole(null);
      setNewModelId(null);
      return;
    }
  }, { isActive: step === 'confirm' });

  // Input para voltar da seleção de modelo
  useInput((_input: string, key: { escape: boolean }) => {
    if (step !== 'select-model') return;

    if (key.escape) {
      setStep('select-agent');
      setSelectedRole(null);
      return;
    }
  }, { isActive: step === 'select-model' });

  // ── Etapa: Selecionar Agente ──────────────────────────────────────
  if (step === 'select-agent') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title="Configuração de Modelos" />

        <Box marginTop={1}>
          <Panel title="Selecione o Agente" titleColor="magenta" borderColor="magenta">
            <Box flexDirection="column" paddingY={1}>
              <Text dimColor>
                Escolha qual agente deseja alterar o modelo de IA:
              </Text>

              <Box marginTop={1} flexDirection="column">
                {filteredRoles.map((role: AgentRole, i: number) => {
                  const info = AGENT_ROLE_INFO[role];
                  const currentModelId = models[role as keyof AgentModelConfig];
                  const modelInfo = findModelById(currentModelId);
                  const isSelected = i === agentIdx;

                  return (
                    <Box key={role} gap={1}>
                      <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                        {isSelected ? '\u276F' : ' '}
                      </Text>
                      <Box width={22}>
                        <Text bold={isSelected} color={isSelected ? 'cyan' : 'white'}>
                          {info.displayName}
                        </Text>
                      </Box>
                      <Text dimColor>
                        {modelInfo?.name ?? currentModelId}
                      </Text>
                    </Box>
                  );
                })}
              </Box>

              {/* Campo de filtro */}
              <Box marginTop={1}>
                {isFilteringAgents ? (
                  <Box>
                    <Text color="yellow" bold>Filtro: </Text>
                    <TextInput
                      value={agentFilter}
                      onChange={(v: string) => { setAgentFilter(v); setAgentIdx(0); }}
                      placeholder="digite para filtrar agentes..."
                    />
                  </Box>
                ) : (
                  <Text dimColor>[/] Filtrar  [{'\u2191\u2193'}] Navegar  [Enter] Selecionar</Text>
                )}
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

  // ── Etapa: Selecionar Modelo ──────────────────────────────────────
  if (step === 'select-model' && selectedRole) {
    const role = selectedRole as AgentRole;
    const roleInfo = AGENT_ROLE_INFO[role];
    const currentModelId = models[role as keyof AgentModelConfig];
    const currentModelInfo = findModelById(currentModelId);

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title="Configuração de Modelos" />

        <Box marginTop={1}>
          <Panel
            title={`Modelo para: ${roleInfo.displayName}`}
            titleColor="magenta"
            borderColor="magenta"
          >
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Box flexDirection="column">
                <Text bold color="white">{roleInfo.displayName}</Text>
                <Text>{roleInfo.description}</Text>
                <Text dimColor>
                  Modelo atual: {currentModelInfo?.name ?? currentModelId}
                </Text>
              </Box>

              <Box marginTop={1}>
                <Text dimColor italic>
                  {'\u{1F4A1}'} {roleInfo.modelRationale}
                </Text>
              </Box>

              <Box marginTop={1}>
                <ModelSelector
                  role={role}
                  onSelect={handleModelSelect}
                  isActive={step === 'select-model'}
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

  // ── Etapa: Confirmar ──────────────────────────────────────────────
  if (step === 'confirm' && selectedRole && newModelId) {
    const confirmRole = selectedRole as AgentRole;
    const roleInfo = AGENT_ROLE_INFO[confirmRole];
    const oldModelId = models[confirmRole as keyof AgentModelConfig];
    const oldModelInfo = findModelById(oldModelId);
    const newModelInfo = findModelById(newModelId);

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider title="Confirmar Alteração" />

        <Box marginTop={1}>
          <Panel title="Confirmar Troca de Modelo" titleColor="green" borderColor="green">
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Box gap={1}>
                <Text bold>Agente:</Text>
                <Text color="cyan">{roleInfo.displayName}</Text>
              </Box>

              <Box gap={1}>
                <Text bold>Modelo anterior:</Text>
                <Text color="red" strikethrough>
                  {oldModelInfo?.name ?? oldModelId}
                </Text>
              </Box>

              <Box gap={1}>
                <Text bold>Novo modelo:</Text>
                <Text color="green" bold>
                  {newModelInfo?.name ?? newModelId}
                </Text>
              </Box>

              <Box marginTop={1}>
                <Text bold>Salvar alteração? </Text>
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

  return <Box />;
}
