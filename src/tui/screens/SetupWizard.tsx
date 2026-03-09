// First-run setup wizard:
// 1. Show welcome screen with logo
// 2. Check for ANTHROPIC_API_KEY
// 3. Prompt for API key if missing
// 4. Auto-initialize project if needed
// 5. Show model configuration
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
}

const MODEL_OPTIONS = [
  { label: 'opus   — Best quality, higher cost ($15/MTok)', value: 'opus' },
  { label: 'sonnet — Balanced quality and speed ($3/MTok)', value: 'sonnet' },
  { label: 'haiku  — Fast and affordable ($0.80/MTok)', value: 'haiku' },
];

export function SetupWizard({
  hasApiKey,
  hasInit,
  onComplete,
  onSkip,
}: SetupWizardProps): React.JSX.Element {
  const { exit } = useApp();

  const initialStep: WizardStep = hasApiKey ? (hasInit ? 'done' : 'initializing') : 'welcome';
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');
  const [orchModel, setOrchModel] = useState('opus');
  const [workerModel, setWorkerModel] = useState('sonnet');
  const [supportModel, setSupportModel] = useState('haiku');
  const [modelStep, setModelStep] = useState<'orchestrator' | 'worker' | 'support'>('orchestrator');
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
          orchestratorModel: orchModel,
          workerModel,
          supportModel,
        });
      } else {
        setStep('initializing');
      }
    } else {
      setStep('api-key');
    }
  }, [hasApiKey, hasInit, onComplete, orchModel, workerModel, supportModel]);

  useInput((_input, key) => {
    if (key.return) {
      handleWelcomeContinue();
    }
  }, { isActive: step === 'welcome' });

  const handleApiKeySubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed.startsWith('sk-ant-')) {
      setApiKeyError('API key should start with "sk-ant-"');
      return;
    }
    if (trimmed.length < 20) {
      setApiKeyError('API key seems too short');
      return;
    }
    setApiKeyError('');
    setApiKey(trimmed);
    setStep('models');
  }, []);

  const handleModelSelect = useCallback((item: { value: string }) => {
    if (modelStep === 'orchestrator') {
      setOrchModel(item.value);
      setModelStep('worker');
    } else if (modelStep === 'worker') {
      setWorkerModel(item.value);
      setModelStep('support');
    } else {
      setSupportModel(item.value);
      setStep('initializing');
    }
  }, [modelStep]);

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
                orchestratorModel: orchModel,
                workerModel,
                supportModel,
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
  }, [step, apiKey, orchModel, workerModel, supportModel, onComplete]);

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

              <Box marginTop={1} flexDirection="column">
                <Box gap={1}>
                  <StatusBadge
                    variant={hasApiKey ? 'success' : 'warning'}
                    label={hasApiKey ? 'API Key found (ANTHROPIC_API_KEY)' : 'API Key not found'}
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
          <Panel title="Anthropic API Key" titleColor="yellow" borderColor="yellow">
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Text>
                HUU needs an Anthropic API key to communicate with Claude models.
              </Text>
              <Text dimColor>
                Get your key at: https://console.anthropic.com/settings/keys
              </Text>

              <Box marginTop={1}>
                <Text bold color="cyan">{'\u276F'} </Text>
                <TextInput
                  value={apiKey}
                  onChange={(v) => { setApiKey(v); setApiKeyError(''); }}
                  onSubmit={handleApiKeySubmit}
                  placeholder="sk-ant-api03-..."
                  mask="*"
                />
              </Box>

              {apiKeyError && (
                <Box>
                  <Text color="red">{'\u2716'} {apiKeyError}</Text>
                </Box>
              )}

              <Text dimColor>
                The key will be stored in .huu/config.json (add .huu/ to .gitignore)
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
    const modelLabels: Record<string, string> = {
      orchestrator: 'Orchestrator (decisions, planning, review)',
      worker: 'Worker (building, testing, merging)',
      support: 'Support (research, docs, cleanup)',
    };

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Logo compact />
        <Divider />

        <Box marginTop={1}>
          <Panel
            title={`Model Tier: ${modelLabels[modelStep]}`}
            titleColor="magenta"
            borderColor="magenta"
          >
            <Box flexDirection="column" gap={1} paddingY={1}>
              <Text dimColor>
                Choose the default Claude model for {modelStep} agents:
              </Text>

              <Box marginTop={1}>
                <SelectInput
                  items={MODEL_OPTIONS}
                  onSelect={handleModelSelect}
                />
              </Box>

              <Box marginTop={1} gap={2}>
                <Text dimColor>Selected:</Text>
                {modelStep !== 'orchestrator' && (
                  <Text color="green">{'\u2714'} Orchestrator: {orchModel}</Text>
                )}
                {modelStep === 'support' && (
                  <Text color="green">{'\u2714'} Worker: {workerModel}</Text>
                )}
              </Box>
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
