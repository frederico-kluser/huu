// Assistente de configuração inicial:
// 1. Mostra tela de boas-vindas com logo
// 2. Verifica OPENROUTER_API_KEY
// 3. Solicita chave API se ausente (valida formato)
// 4. Mostra configuração de modelos com rankings custo-benefício
// 5. Auto-inicializa projeto se necessário
// 6. Confirma e prossegue

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Logo } from '../components/Logo.js';
import { Divider } from '../components/Divider.js';
import { KeyHint } from '../components/KeyHint.js';
import { Panel } from '../components/Panel.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { ModelSelector } from '../components/ModelSelector.js';
import {
  validateOpenRouterKey,
} from '../../models/openrouter.js';
import {
  AGENT_ROLE_INFO,
} from '../../models/catalog.js';
import type { AgentRole } from '../../models/catalog.js';
import { DEFAULT_AGENT_MODELS } from '../../cli/config.js';
import type { AgentModelConfig } from '../../cli/config.js';

type WizardStep = 'welcome' | 'api-key' | 'models' | 'initializing' | 'done';

interface SetupWizardProps {
  hasApiKey: boolean;
  hasInit: boolean;
  onComplete: (config: SetupResult) => void;
  onSkip?: () => void;
}

export interface SetupResult {
  apiKey: string | null;
  orchestratorModel: string;
  workerModel: string;
  supportModel: string;
  agentModels: AgentModelConfig;
}

// Grupos de agentes por tier para o assistente
const WIZARD_AGENT_GROUPS = [
  {
    tier: 'Crítico',
    tierColor: 'red' as const,
    description: 'Decisões estratégicas, revisão, depuração',
    roles: ['orchestrator', 'reviewer', 'debugger'] as AgentRole[],
  },
  {
    tier: 'Principal',
    tierColor: 'yellow' as const,
    description: 'Planejamento, construção, testes, integração',
    roles: ['planner', 'builder', 'tester', 'merger'] as AgentRole[],
  },
  {
    tier: 'Econômico',
    tierColor: 'green' as const,
    description: 'Pesquisa, refatoração, documentação, contexto',
    roles: ['researcher', 'refactorer', 'doc-writer', 'context-curator'] as AgentRole[],
  },
];

export function SetupWizard({
  hasApiKey,
  hasInit,
  onComplete,
}: SetupWizardProps): React.JSX.Element {
  const { exit } = useApp();

  const initialStep: WizardStep = hasApiKey ? (hasInit ? 'done' : 'models') : 'welcome';
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');
  const [agentModels, setAgentModels] = useState<AgentModelConfig>({ ...DEFAULT_AGENT_MODELS });
  const [currentGroupIdx, setCurrentGroupIdx] = useState(0);
  const [currentRoleIdx, setCurrentRoleIdx] = useState(0);
  const [initStatus, setInitStatus] = useState<'running' | 'done' | 'error'>('running');
  const [initMessage, setInitMessage] = useState('Criando diretório .huu/...');

  useInput((input: string, key: { escape: boolean }) => {
    if (key.escape || input === 'q') {
      exit();
    }
  }, { isActive: step === 'welcome' });

  const handleWelcomeContinue = useCallback(() => {
    if (hasApiKey) {
      if (hasInit) {
        onComplete({
          apiKey: null,
          orchestratorModel: 'opus',
          workerModel: 'sonnet',
          supportModel: 'haiku',
          agentModels,
        });
      } else {
        setStep('models');
      }
    } else {
      setStep('api-key');
    }
  }, [hasApiKey, hasInit, onComplete, agentModels]);

  useInput((_input: string, key: { return: boolean }) => {
    if (key.return) {
      handleWelcomeContinue();
    }
  }, { isActive: step === 'welcome' });

  const handleApiKeySubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    const validation = validateOpenRouterKey(trimmed);
    if (!validation.valid) {
      setApiKeyError(validation.error ?? 'Chave API inválida');
      return;
    }
    setApiKeyError('');
    setApiKey(trimmed);
    setStep('models');
  }, []);

  // Papel atual sendo configurado
  const currentGroup = WIZARD_AGENT_GROUPS[currentGroupIdx];
  const currentRole = currentGroup?.roles[currentRoleIdx];

  const handleModelSelect = useCallback((modelId: string) => {
    if (!currentRole) return;

    setAgentModels((prev: AgentModelConfig) => ({
      ...prev,
      [currentRole]: modelId,
    }));

    // Avança para o próximo papel
    const group = WIZARD_AGENT_GROUPS[currentGroupIdx]!;
    if (currentRoleIdx < group.roles.length - 1) {
      setCurrentRoleIdx(currentRoleIdx + 1);
    } else if (currentGroupIdx < WIZARD_AGENT_GROUPS.length - 1) {
      setCurrentGroupIdx(currentGroupIdx + 1);
      setCurrentRoleIdx(0);
    } else {
      // Todos os papéis configurados, prossegue para inicialização
      setStep('initializing');
    }
  }, [currentGroupIdx, currentRoleIdx, currentRole]);

  // Permite pular configuração de modelos com '!' para usar padrões
  useInput((input: string) => {
    if (step === 'models' && input === '!') {
      setAgentModels({ ...DEFAULT_AGENT_MODELS });
      setStep('initializing');
    }
  }, { isActive: step === 'models' });

  // Simula inicialização
  useEffect(() => {
    if (step !== 'initializing') return;

    const steps = [
      { msg: 'Criando diretório .huu/...', delay: 400 },
      { msg: 'Inicializando banco SQLite (modo WAL)...', delay: 600 },
      { msg: 'Executando migrações de schema...', delay: 500 },
      { msg: 'Gravando configuração...', delay: 300 },
      { msg: 'Projeto inicializado!', delay: 200 },
    ];

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const runStep = (idx: number) => {
      if (cancelled || idx >= steps.length) {
        if (!cancelled) {
          setInitStatus('done');
          setInitMessage('Projeto inicializado com sucesso!');
          setTimeout(() => {
            if (!cancelled) {
              onComplete({
                apiKey: apiKey || null,
                orchestratorModel: 'opus',
                workerModel: 'sonnet',
                supportModel: 'haiku',
                agentModels,
              });
            }
          }, 800);
        }
        return;
      }

      setInitMessage(steps[idx]!.msg);
      timeout = setTimeout(() => runStep(idx + 1), steps[idx]!.delay);
    };

    runStep(0);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [step, apiKey, agentModels, onComplete]);

  // ── Etapa Boas-vindas ──────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo />

        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Divider />
        </Box>

        <Box marginTop={1} flexDirection="column" gap={1}>
          <Panel title="Bem-vindo" titleColor="cyan" borderColor="cyan">
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Text>
                HUU é um orquestrador multi-agente que decompõe tarefas complexas
              </Text>
              <Text>
                em um arco narrativo e delega para 11 agentes especializados.
              </Text>
              <Text dimColor>
                Alimentado por OpenRouter — acesse 100+ modelos com uma única chave API.
              </Text>

              <Box marginTop={1} flexDirection="column">
                <Box gap={1}>
                  <StatusBadge
                    variant={hasApiKey ? 'success' : 'warning'}
                    label={hasApiKey ? 'Chave API encontrada (OPENROUTER_API_KEY)' : 'Chave API OpenRouter não encontrada'}
                  />
                </Box>
                <Box gap={1}>
                  <StatusBadge
                    variant={hasInit ? 'success' : 'info'}
                    label={hasInit ? 'Projeto inicializado (.huu/)' : 'Projeto precisa de inicialização'}
                  />
                </Box>
              </Box>
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1} justifyContent="center">
          <Text color="cyan" bold>Pressione Enter para continuar</Text>
          <Text dimColor>  |  </Text>
          <Text dimColor>Q para sair</Text>
        </Box>
      </Box>
    );
  }

  // ── Etapa Chave API ────────────────────────────────────────────────
  if (step === 'api-key') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider />

        <Box marginTop={1}>
          <Panel title="Chave API OpenRouter" titleColor="yellow" borderColor="yellow">
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Text>
                HUU usa OpenRouter para acessar múltiplos modelos de IA (Claude, GPT, Gemini, etc).
              </Text>
              <Text dimColor>
                Obtenha sua chave em: https://openrouter.ai/keys
              </Text>

              <Box marginTop={1}>
                <Text bold color="cyan">{'\u276F'} </Text>
                <TextInput
                  value={apiKey}
                  onChange={(v: string) => { setApiKey(v); setApiKeyError(''); }}
                  onSubmit={handleApiKeySubmit}
                  placeholder="sk-or-v1-..."
                  mask="*"
                />
              </Box>

              {apiKeyError && (
                <Box>
                  <Text color="red">{'\u2716'} {apiKeyError}</Text>
                </Box>
              )}

              <Text dimColor>
                A chave é armazenada apenas em variável de ambiente (não é gravada em disco).
              </Text>
              <Text dimColor>
                Defina OPENROUTER_API_KEY no perfil do seu shell para persistência.
              </Text>
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1}>
          <KeyHint bindings={[
            { key: 'Enter', label: 'Enviar' },
            { key: 'Esc', label: 'Pular (usar variável de ambiente depois)' },
          ]} />
        </Box>
      </Box>
    );
  }

  // ── Etapa Seleção de Modelos ──────────────────────────────────────
  if (step === 'models') {
    const totalRoles = WIZARD_AGENT_GROUPS.reduce((sum, g) => sum + g.roles.length, 0);
    let completedRoles = 0;
    for (let i = 0; i < currentGroupIdx; i++) {
      completedRoles += WIZARD_AGENT_GROUPS[i]!.roles.length;
    }
    completedRoles += currentRoleIdx;

    const roleInfo = currentRole ? AGENT_ROLE_INFO[currentRole] : null;

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider />

        <Box marginTop={1}>
          <Panel
            title={`Configuração de Modelo: ${roleInfo?.displayName ?? currentRole} (${completedRoles + 1}/${totalRoles})`}
            titleColor="magenta"
            borderColor="magenta"
          >
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Box gap={2}>
                <Text color={currentGroup?.tierColor ?? 'white'} bold>
                  Tier: {currentGroup?.tier}
                </Text>
                <Text dimColor>
                  {currentGroup?.description}
                </Text>
              </Box>

              {/* Explicação do papel do agente */}
              {roleInfo && (
                <Box flexDirection="column">
                  <Text bold color="white">
                    {roleInfo.displayName}
                  </Text>
                  <Text>
                    {roleInfo.description}
                  </Text>
                  <Box marginTop={1}>
                    <Text dimColor italic>
                      {'\u{1F4A1}'} {roleInfo.modelRationale}
                    </Text>
                  </Box>
                </Box>
              )}

              {/* Seletor de modelo compartilhado */}
              {currentRole && (
                <Box marginTop={1}>
                  <ModelSelector
                    role={currentRole}
                    onSelect={handleModelSelect}
                    isActive={step === 'models'}
                  />
                </Box>
              )}

              {/* Modelos já configurados */}
              {completedRoles > 0 && (
                <Box marginTop={1} flexDirection="column">
                  <Text dimColor bold>Configurados:</Text>
                  {WIZARD_AGENT_GROUPS.flatMap((g) => g.roles).slice(0, completedRoles).map((role) => {
                    const info = AGENT_ROLE_INFO[role];
                    return (
                      <Text key={role} dimColor>
                        {'\u2714'} {info?.displayName ?? role}: {agentModels[role as keyof AgentModelConfig]}
                      </Text>
                    );
                  })}
                </Box>
              )}
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1}>
          <KeyHint bindings={[
            { key: '!', label: 'Usar todos os padrões' },
          ]} />
        </Box>
      </Box>
    );
  }

  // ── Etapa Inicialização ───────────────────────────────────────────
  if (step === 'initializing') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider />

        <Box marginTop={1}>
          <Panel title="Inicializando Projeto" titleColor="green" borderColor="green">
            <Box flexDirection="column" gap={1} paddingY={1}>
              {initStatus === 'running' ? (
                <Box gap={1}>
                  <Text color="green"><Spinner type="dots" /></Text>
                  <Text>{initMessage}</Text>
                </Box>
              ) : initStatus === 'done' ? (
                <StatusBadge variant="success" label={initMessage} bold />
              ) : (
                <StatusBadge variant="error" label={initMessage} />
              )}

              <Box marginTop={1} flexDirection="column">
                <Text dimColor>Diretório do projeto: .huu/</Text>
                <Text dimColor>Banco de dados: .huu/huu.db (modo WAL)</Text>
                <Text dimColor>Configuração: .huu/config.json</Text>
                <Text dimColor>Provedor: OpenRouter (multi-modelo)</Text>
              </Box>

              {/* Resumo das seleções de modelo */}
              <Box marginTop={1} flexDirection="column">
                <Text bold>Configuração de Modelos:</Text>
                {WIZARD_AGENT_GROUPS.map((group) => (
                  <Box key={group.tier} flexDirection="column" marginTop={1}>
                    <Text color={group.tierColor ?? 'white'} bold>Tier {group.tier}:</Text>
                    {group.roles.map((role) => {
                      const info = AGENT_ROLE_INFO[role];
                      return (
                        <Text key={role} dimColor>
                          {'\u2022'} {info?.displayName ?? role}: {agentModels[role as keyof AgentModelConfig]}
                        </Text>
                      );
                    })}
                  </Box>
                ))}
              </Box>
            </Box>
          </Panel>
        </Box>
      </Box>
    );
  }

  // Concluído — não deve renderizar
  return <Box />;
}
