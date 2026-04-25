import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
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

const FULL_CLEAR = '\x1b[2J\x1b[3J\x1b[H';

export function App({
  initialPipeline,
  agentFactory,
  conflictResolverFactory,
  requiresApiKey,
  autoStart,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [screen, setScreen] = useState<Screen>(
    autoStart && initialPipeline ? { kind: 'pipeline-editor' } : { kind: 'welcome' },
  );
  const [pipeline, setPipeline] = useState<Pipeline | null>(initialPipeline ?? null);
  const [modelId, setModelId] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>(process.env.OPENROUTER_API_KEY ?? '');
  const repoRoot = process.cwd();
  const factory = agentFactory ?? stubAgentFactory;

  // Clear the terminal whenever the top-level screen changes. Without this,
  // tall components (file picker, model table) leave ghost rows on screen
  // when the user goes back. Fires on transition only, not on every render.
  const prevScreenKind = useRef<Screen['kind']>(screen.kind);
  useEffect(() => {
    if (prevScreenKind.current !== screen.kind && stdout.isTTY) {
      stdout.write(FULL_CLEAR);
    }
    prevScreenKind.current = screen.kind;
  }, [screen.kind, stdout]);

  useInput(
    (input, key) => {
      if (screen.kind === 'welcome') {
        if (input === 'q' || input === 'Q') exit();
        if (input === 'n' || input === 'N') setScreen({ kind: 'pipeline-editor' });
        if (input === 'i' || input === 'I') setScreen({ kind: 'pipeline-import' });
      } else if (screen.kind === 'summary') {
        if (input === 'q' || input === 'Q') exit();
        if (key.return) setScreen({ kind: 'pipeline-editor' });
      }
    },
    { isActive: screen.kind === 'welcome' || screen.kind === 'summary' },
  );

  if (screen.kind === 'welcome') {
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="cyan">programatic-agent</Text>
          <Text dimColor>Guided pipeline execution — multi-agent kanban with git worktrees</Text>

          <Box marginTop={1} flexDirection="column">
            <Text>  <Text bold color="cyan">[N]</Text>  New pipeline</Text>
            <Text>  <Text bold color="cyan">[I]</Text>  Import pipeline from JSON</Text>
            <Text>  <Text bold color="cyan">[Q]</Text>  Quit</Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>cwd: {repoRoot}</Text>
          </Box>
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
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const committed = r.agents.filter((a) => a.commitSha).length;
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="green">Run finished</Text>

          <Box marginTop={1} flexDirection="column">
            <Box>
              <Box width={24}><Text dimColor>runId:</Text></Box>
              <Text bold>{r.runId}</Text>
            </Box>
            <Box>
              <Box width={24}><Text dimColor>integration branch:</Text></Box>
              <Text bold>{r.manifest.integrationBranch}</Text>
            </Box>
            <Box>
              <Box width={24}><Text dimColor>duration:</Text></Box>
              <Text>{mm}:{ss}</Text>
            </Box>
            <Box>
              <Box width={24}><Text dimColor>agents committed:</Text></Box>
              <Text>{committed} / {r.agents.length}</Text>
            </Box>
            <Box>
              <Box width={24}><Text dimColor>files modified:</Text></Box>
              <Text>{r.filesModified.length}</Text>
            </Box>
            {r.integration.conflicts.length > 0 && (
              <Box>
                <Box width={24}><Text color="red">conflicts:</Text></Box>
                <Text color="red">{r.integration.conflicts.length}</Text>
              </Box>
            )}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>ENTER</Text> back to pipeline editor · <Text bold>Q</Text> quit
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return <Text>?</Text>;
}
