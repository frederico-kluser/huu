import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ModelSelectorOverlay } from './ui/components/ModelSelectorOverlay.js';
import { PipelineEditor } from './ui/components/PipelineEditor.js';
import { PipelineIOScreen } from './ui/components/PipelineIOScreen.js';
import { RunDashboard } from './ui/components/RunDashboard.js';
import { ApiKeyPrompt } from './ui/components/ApiKeyPrompt.js';
import { stubAgentFactory } from './orchestrator/stub-agent.js';
import type { AgentFactory } from './orchestrator/types.js';
import type { OrchestratorResult, Pipeline } from './lib/types.js';

interface AppProps {
  initialPipeline?: Pipeline;
  agentFactory?: AgentFactory;
  /** Optional LLM resolver for merge conflicts. */
  conflictResolverFactory?: AgentFactory;
  /** If true, an API key is required before running (real LLM). */
  requiresApiKey?: boolean;
  /** When true and initialPipeline is set, jumps straight from welcome → editor. */
  autoStart?: boolean;
}

type Screen =
  | { kind: 'welcome' }
  | { kind: 'pipeline-editor' }
  | { kind: 'pipeline-import' }
  | { kind: 'pipeline-export' }
  | { kind: 'model-selector' }
  | { kind: 'api-key' }
  | { kind: 'run'; modelId: string; apiKey: string }
  | { kind: 'summary'; result: OrchestratorResult };

export function App({
  initialPipeline,
  agentFactory,
  conflictResolverFactory,
  requiresApiKey,
  autoStart,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>(
    autoStart && initialPipeline ? { kind: 'pipeline-editor' } : { kind: 'welcome' },
  );
  const [pipeline, setPipeline] = useState<Pipeline | null>(initialPipeline ?? null);
  const [modelId, setModelId] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>(process.env.OPENROUTER_API_KEY ?? '');
  const repoRoot = process.cwd();
  const factory = agentFactory ?? stubAgentFactory;

  useInput(
    (input, key) => {
      if (screen.kind === 'welcome') {
        if (input === 'q') exit();
        if (input === 'n') setScreen({ kind: 'pipeline-editor' });
        if (input === 'i') setScreen({ kind: 'pipeline-import' });
      } else if (screen.kind === 'summary') {
        if (input === 'q') exit();
        if (key.return) setScreen({ kind: 'pipeline-editor' });
      }
    },
    { isActive: screen.kind === 'welcome' || screen.kind === 'summary' },
  );

  if (screen.kind === 'welcome') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">programatic-agent</Text>
        <Text dimColor>TUI de execucao guiada com kanban</Text>
        <Box marginTop={1} flexDirection="column">
          <Text><Text bold color="cyan">n</Text>  Nova pipeline</Text>
          <Text><Text bold color="cyan">i</Text>  Importar pipeline (JSON)</Text>
          <Text><Text bold color="cyan">q</Text>  Sair</Text>
        </Box>
      </Box>
    );
  }

  if (screen.kind === 'pipeline-editor') {
    return (
      <PipelineEditor
        initialPipeline={pipeline ?? undefined}
        repoRoot={repoRoot}
        onComplete={(p) => {
          setPipeline(p);
          setScreen({ kind: 'model-selector' });
        }}
        onImport={() => setScreen({ kind: 'pipeline-import' })}
        onExport={(p) => {
          setPipeline(p);
          setScreen({ kind: 'pipeline-export' });
        }}
        onCancel={() => setScreen({ kind: 'welcome' })}
      />
    );
  }

  if (screen.kind === 'pipeline-import') {
    return (
      <PipelineIOScreen
        mode="import"
        onComplete={(loaded) => {
          if (loaded) {
            setPipeline(loaded);
            setScreen({ kind: 'pipeline-editor' });
          }
        }}
        onCancel={() => setScreen({ kind: pipeline ? 'pipeline-editor' : 'welcome' })}
      />
    );
  }

  if (screen.kind === 'pipeline-export') {
    return (
      <PipelineIOScreen
        mode="export"
        pipeline={pipeline ?? undefined}
        onComplete={() => setScreen({ kind: 'pipeline-editor' })}
        onCancel={() => setScreen({ kind: 'pipeline-editor' })}
      />
    );
  }

  if (screen.kind === 'model-selector') {
    return (
      <ModelSelectorOverlay
        onSelect={(id) => {
          setModelId(id);
          if (requiresApiKey && !apiKey) {
            setScreen({ kind: 'api-key' });
          } else {
            setScreen({ kind: 'run', modelId: id, apiKey });
          }
        }}
        onCancel={() => setScreen({ kind: 'pipeline-editor' })}
      />
    );
  }

  if (screen.kind === 'api-key') {
    return (
      <ApiKeyPrompt
        onSubmit={(key) => {
          setApiKey(key);
          setScreen({ kind: 'run', modelId, apiKey: key });
        }}
        onCancel={() => setScreen({ kind: 'model-selector' })}
      />
    );
  }

  if (screen.kind === 'run' && pipeline) {
    return (
      <RunDashboard
        config={{ apiKey: screen.apiKey || 'stub', modelId: screen.modelId }}
        pipeline={pipeline}
        cwd={repoRoot}
        agentFactory={factory}
        conflictResolverFactory={conflictResolverFactory}
        onComplete={(result) => setScreen({ kind: 'summary', result })}
        onAbort={() => setScreen({ kind: 'pipeline-editor' })}
      />
    );
  }

  if (screen.kind === 'summary') {
    const r = screen.result;
    const seconds = Math.floor(r.duration / 1000);
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
        <Text bold color="green">Run concluida</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>runId: <Text bold>{r.runId}</Text></Text>
          <Text>integrationBranch: <Text bold>{r.manifest.integrationBranch}</Text></Text>
          <Text>duracao: {seconds}s</Text>
          <Text>agents com commit: {r.agents.filter((a) => a.commitSha).length}/{r.agents.length}</Text>
          <Text>arquivos modificados: {r.filesModified.length}</Text>
          {r.integration.conflicts.length > 0 && (
            <Text color="red">conflitos: {r.integration.conflicts.length}</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter volta ao editor · q sair</Text>
        </Box>
      </Box>
    );
  }

  return <Text>?</Text>;
}
