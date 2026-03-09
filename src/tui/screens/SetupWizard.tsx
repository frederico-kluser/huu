// First-run setup wizard:
// 1. Show welcome screen with logo
// 2. Check for OPENROUTER_API_KEY
// 3. Prompt for API key if missing (validate format)
// 4. Show model configuration with cost-benefit rankings
// 5. Auto-initialize project if needed
// 6. Confirm and proceed

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { Logo } from '../components/Logo.js';
import { Divider } from '../components/Divider.js';
import { KeyHint } from '../components/KeyHint.js';
import { Panel } from '../components/Panel.js';
import { StatusBadge } from '../components/StatusBadge.js';
import {
  validateOpenRouterKey,
} from '../../models/openrouter.js';
import {
  getModelsForRole,
  getDefaultModelForRole,
  formatModelOption,
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

// Agent roles grouped by tier for the wizard
const WIZARD_AGENT_GROUPS = [
  {
    tier: 'Critical',
    tierColor: 'red' as const,
    description: 'Strategic decisions, review, debugging',
    roles: ['orchestrator', 'reviewer', 'debugger'] as AgentRole[],
  },
  {
    tier: 'Principal',
    tierColor: 'yellow' as const,
    description: 'Planning, building, testing, merging',
    roles: ['planner', 'builder', 'tester', 'merger'] as AgentRole[],
  },
  {
    tier: 'Economy',
    tierColor: 'green' as const,
    description: 'Research, refactoring, docs, context',
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
  const [initMessage, setInitMessage] = useState('Creating .huu/ directory...');

  useInput((input, key) => {
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

  useInput((_input, key) => {
    if (key.return) {
      handleWelcomeContinue();
    }
  }, { isActive: step === 'welcome' });

  const handleApiKeySubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    const validation = validateOpenRouterKey(trimmed);
    if (!validation.valid) {
      setApiKeyError(validation.error ?? 'Invalid API key');
      return;
    }
    setApiKeyError('');
    setApiKey(trimmed);
    setStep('models');
  }, []);

  // Get current role being configured
  const currentGroup = WIZARD_AGENT_GROUPS[currentGroupIdx];
  const currentRole = currentGroup?.roles[currentRoleIdx];

  // Get models for current role
  const modelsForRole = currentRole ? getModelsForRole(currentRole) : [];
  const modelOptions = modelsForRole.map((scored) => ({
    label: formatModelOption(scored),
    value: scored.model.id,
  }));

  const handleModelSelect = useCallback((item: { value: string }) => {
    if (!currentRole) return;

    setAgentModels((prev) => ({
      ...prev,
      [currentRole]: item.value,
    }));

    // Move to next role
    const group = WIZARD_AGENT_GROUPS[currentGroupIdx]!;
    if (currentRoleIdx < group.roles.length - 1) {
      setCurrentRoleIdx(currentRoleIdx + 1);
    } else if (currentGroupIdx < WIZARD_AGENT_GROUPS.length - 1) {
      setCurrentGroupIdx(currentGroupIdx + 1);
      setCurrentRoleIdx(0);
    } else {
      // All roles configured, proceed to init
      setStep('initializing');
    }
  }, [currentGroupIdx, currentRoleIdx, currentRole]);

  // Allow skipping model config with 'd' for defaults
  useInput((input) => {
    if (step === 'models' && input === 'd') {
      setAgentModels({ ...DEFAULT_AGENT_MODELS });
      setStep('initializing');
    }
  }, { isActive: step === 'models' });

  // Simulate initialization
  useEffect(() => {
    if (step !== 'initializing') return;

    const steps = [
      { msg: 'Creating .huu/ directory...', delay: 400 },
      { msg: 'Initializing SQLite database (WAL mode)...', delay: 600 },
      { msg: 'Running schema migrations...', delay: 500 },
      { msg: 'Writing configuration...', delay: 300 },
      { msg: 'Project initialized!', delay: 200 },
    ];

    let cancelled = false;
    let timeout: NodeJS.Timeout;

    const runStep = (idx: number) => {
      if (cancelled || idx >= steps.length) {
        if (!cancelled) {
          setInitStatus('done');
          setInitMessage('Project initialized successfully!');
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

  // ── Welcome step ──────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo />

        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Divider />
        </Box>

        <Box marginTop={1} flexDirection="column" gap={1}>
          <Panel title="Welcome" titleColor="cyan" borderColor="cyan">
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Text>
                HUU is a multi-agent orchestrator that decomposes complex tasks
              </Text>
              <Text>
                into a narrative arc and delegates to 11 specialized agents.
              </Text>
              <Text dimColor>
                Powered by OpenRouter — access 100+ models from one API key.
              </Text>

              <Box marginTop={1} flexDirection="column">
                <Box gap={1}>
                  <StatusBadge
                    variant={hasApiKey ? 'success' : 'warning'}
                    label={hasApiKey ? 'API Key found (OPENROUTER_API_KEY)' : 'OpenRouter API Key not found'}
                  />
                </Box>
                <Box gap={1}>
                  <StatusBadge
                    variant={hasInit ? 'success' : 'info'}
                    label={hasInit ? 'Project initialized (.huu/)' : 'Project needs initialization'}
                  />
                </Box>
              </Box>
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1} justifyContent="center">
          <Text color="cyan" bold>Press Enter to continue</Text>
          <Text dimColor>  |  </Text>
          <Text dimColor>Q to quit</Text>
        </Box>
      </Box>
    );
  }

  // ── API Key step ──────────────────────────────────────────────────
  if (step === 'api-key') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider />

        <Box marginTop={1}>
          <Panel title="OpenRouter API Key" titleColor="yellow" borderColor="yellow">
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Text>
                HUU uses OpenRouter to access multiple AI models (Claude, GPT, Gemini, etc).
              </Text>
              <Text dimColor>
                Get your key at: https://openrouter.ai/keys
              </Text>

              <Box marginTop={1}>
                <Text bold color="cyan">{'\u276F'} </Text>
                <TextInput
                  value={apiKey}
                  onChange={(v) => { setApiKey(v); setApiKeyError(''); }}
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
                The key is stored in environment only (not written to disk).
              </Text>
              <Text dimColor>
                Set OPENROUTER_API_KEY in your shell profile for persistence.
              </Text>
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1}>
          <KeyHint bindings={[
            { key: 'Enter', label: 'Submit' },
            { key: 'Esc', label: 'Skip (use env var later)' },
          ]} />
        </Box>
      </Box>
    );
  }

  // ── Model selection step ──────────────────────────────────────────
  if (step === 'models') {
    const totalRoles = WIZARD_AGENT_GROUPS.reduce((sum, g) => sum + g.roles.length, 0);
    let completedRoles = 0;
    for (let i = 0; i < currentGroupIdx; i++) {
      completedRoles += WIZARD_AGENT_GROUPS[i]!.roles.length;
    }
    completedRoles += currentRoleIdx;

    const defaultModelId = currentRole ? getDefaultModelForRole(currentRole) : '';

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider />

        <Box marginTop={1}>
          <Panel
            title={`Model Config: ${currentRole} (${completedRoles + 1}/${totalRoles})`}
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

              <Text dimColor>
                Choose model for <Text bold color="white">{currentRole}</Text> agent:
              </Text>
              <Text dimColor>
                Models ranked by cost-benefit (SWE-Bench score / cost). {'\u2605'} = recommended.
              </Text>

              <Box marginTop={1}>
                <SelectInput
                  items={modelOptions}
                  initialIndex={Math.max(0, modelOptions.findIndex((o) => o.value === defaultModelId))}
                  onSelect={handleModelSelect}
                />
              </Box>

              {/* Show already configured models */}
              {completedRoles > 0 && (
                <Box marginTop={1} flexDirection="column">
                  <Text dimColor bold>Configured:</Text>
                  {WIZARD_AGENT_GROUPS.flatMap((g) => g.roles).slice(0, completedRoles).map((role) => (
                    <Text key={role} dimColor>
                      {'\u2714'} {role}: {agentModels[role as keyof AgentModelConfig]}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          </Panel>
        </Box>

        <Box marginTop={1}>
          <KeyHint bindings={[
            { key: '\u2191\u2193', label: 'Navigate' },
            { key: 'Enter', label: 'Select' },
            { key: 'D', label: 'Use all defaults' },
          ]} />
        </Box>
      </Box>
    );
  }

  // ── Initializing step ─────────────────────────────────────────────
  if (step === 'initializing') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider />

        <Box marginTop={1}>
          <Panel title="Initializing Project" titleColor="green" borderColor="green">
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
                <Text dimColor>Project directory: .huu/</Text>
                <Text dimColor>Database: .huu/huu.db (WAL mode)</Text>
                <Text dimColor>Config: .huu/config.json</Text>
                <Text dimColor>Provider: OpenRouter (multi-model)</Text>
              </Box>

              {/* Summary of model selections */}
              <Box marginTop={1} flexDirection="column">
                <Text bold>Model Configuration:</Text>
                {WIZARD_AGENT_GROUPS.map((group) => (
                  <Box key={group.tier} flexDirection="column" marginTop={1}>
                    <Text color={group.tierColor ?? 'white'} bold>{group.tier} Tier:</Text>
                    {group.roles.map((role) => (
                      <Text key={role} dimColor>
                        {'\u2022'} {role}: {agentModels[role as keyof AgentModelConfig]}
                      </Text>
                    ))}
                  </Box>
                ))}
              </Box>
            </Box>
          </Panel>
        </Box>
      </Box>
    );
  }

  // Done — shouldn't render
  return <Box />;
}
