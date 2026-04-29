import React, { useCallback, useEffect, useRef, useState } from 'react';
import pkg from '../package.json' with { type: 'json' };
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { join } from 'node:path';
import { ModelSelectorOverlay } from './ui/components/ModelSelectorOverlay.js';
import { PipelineEditor } from './ui/components/PipelineEditor.js';
import { PipelineIOScreen } from './ui/components/PipelineIOScreen.js';
import { PipelineImportList } from './ui/components/PipelineImportList.js';
import { RunDashboard } from './ui/components/RunDashboard.js';
import { ApiKeyPrompt } from './ui/components/ApiKeyPrompt.js';
import { useTerminalResize } from './ui/hooks/useTerminalResize.js';
import { SystemMetricsBar } from './ui/components/SystemMetricsBar.js';
import { stubAgentFactory } from './orchestrator/stub-agent.js';
import { listAllPipelines } from './lib/pipeline-io.js';
import { resolveOpenRouterApiKey } from './lib/api-key.js';
import { log as dlog, bump as dbump } from './lib/debug-logger.js';
import type { PipelineEntry } from './lib/pipeline-io.js';
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
  | { kind: 'pipeline-import-custom' }
  | { kind: 'pipeline-export' }
  | { kind: 'model-selector' }
  | { kind: 'api-key' }
  | { kind: 'run'; modelId: string; apiKey: string }
  | { kind: 'summary'; result: OrchestratorResult };

const FULL_CLEAR = '\x1b[3J';

export function App({
  initialPipeline,
  agentFactory,
  conflictResolverFactory,
  requiresApiKey,
  autoStart,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  useTerminalResize();
  const [screen, setScreen] = useState<Screen>(
    autoStart && initialPipeline ? { kind: 'pipeline-editor' } : { kind: 'welcome' },
  );
  const [pipeline, setPipeline] = useState<Pipeline | null>(initialPipeline ?? null);
  const [modelId, setModelId] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>(resolveOpenRouterApiKey());
  const [availablePipelines, setAvailablePipelines] = useState<PipelineEntry[]>([]);
  const [selectedPipelineIndex, setSelectedPipelineIndex] = useState<number>(0);
  const repoRoot = process.cwd();
  const factory = agentFactory ?? stubAgentFactory;

  const screenRef = useRef<Screen>(screen);
  screenRef.current = screen;

  useEffect(() => {
    if (screen.kind === 'welcome' || screen.kind === 'pipeline-import') {
      const entries = listAllPipelines(join(repoRoot, 'pipelines'));
      setAvailablePipelines(entries);
      setSelectedPipelineIndex(0);
    }
  }, [screen.kind, repoRoot]);

  const navigate = useCallback(
    (next: Screen) => {
      dlog('nav', 'navigate', { from: screenRef.current.kind, to: next.kind });
      if (screenRef.current.kind !== next.kind && stdout.isTTY) {
        stdout.write(FULL_CLEAR);
      }
      setScreen(next);
    },
    [stdout],
  );

  useEffect(() => {
    dlog('nav', 'screen_mount', { kind: screen.kind });
    return () => dlog('nav', 'screen_unmount', { kind: screen.kind });
  }, [screen.kind]);

  // Ink's useInput keeps the handler in its effect deps and re-attaches the
  // listener every time the reference changes. SystemMetricsBar re-renders the
  // App every second; without ref-stability that re-attach happens on every
  // tick. Refs feed the latest state into a stable handler instead.
  const availablePipelinesRef = useRef(availablePipelines);
  availablePipelinesRef.current = availablePipelines;
  const selectedPipelineIndexRef = useRef(selectedPipelineIndex);
  selectedPipelineIndexRef.current = selectedPipelineIndex;
  const screenKindRef = useRef(screen.kind);
  screenKindRef.current = screen.kind;

  const handleAppInput = useCallback(
    (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean }) => {
      const kind = screenKindRef.current;
      dbump('input.App');
      dlog('input', 'App.useInput', {
        screen: kind,
        input,
        upArrow: key.upArrow,
        downArrow: key.downArrow,
        return: key.return,
      });
      if (kind === 'welcome') {
        if (input === 'q' || input === 'Q') {
          exit();
          return;
        }
        if (input === 'n' || input === 'N') {
          navigate({ kind: 'pipeline-editor' });
          return;
        }
        if (input === 'i' || input === 'I') {
          navigate({ kind: 'pipeline-import' });
          return;
        }
        if (key.upArrow) {
          setSelectedPipelineIndex((prev) => Math.max(0, prev - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedPipelineIndex((prev) =>
            Math.min(availablePipelinesRef.current.length - 1, prev + 1),
          );
          return;
        }
        if (key.return && availablePipelinesRef.current.length > 0) {
          const selected =
            availablePipelinesRef.current[selectedPipelineIndexRef.current];
          if (selected) {
            setPipeline(selected.pipeline);
            navigate({ kind: 'pipeline-editor' });
          }
          return;
        }
        const num = parseInt(input, 10);
        if (
          !Number.isNaN(num) &&
          num >= 1 &&
          num <= availablePipelinesRef.current.length
        ) {
          setPipeline(availablePipelinesRef.current[num - 1]!.pipeline);
          navigate({ kind: 'pipeline-editor' });
        }
      } else if (kind === 'summary') {
        if (input === 'q' || input === 'Q') {
          exit();
          return;
        }
        if (key.return) navigate({ kind: 'pipeline-editor' });
      }
    },
    [exit, navigate],
  );

  useInput(handleAppInput, {
    isActive: screen.kind === 'welcome' || screen.kind === 'summary',
  });

  let body: React.JSX.Element = <Text>?</Text>;

  if (screen.kind === 'welcome') {
    body = (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="cyan">{pkg.name} v{pkg.version}</Text>
          <Text dimColor>Guided pipeline execution — multi-agent kanban with git worktrees</Text>

          <Box marginTop={1} flexDirection="column">
            <Text>  <Text bold color="cyan">[N]</Text>  New pipeline</Text>
            <Text>  <Text bold color="cyan">[I]</Text>  Import pipeline from list</Text>
            <Text>  <Text bold color="cyan">[Q]</Text>  Quit</Text>
          </Box>

          {availablePipelines.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold>Pipelines available in ./pipelines:</Text>
              {availablePipelines.map((entry, idx) => (
                <Box key={entry.filePath}>
                  <Text>
                    {'  '}
                    <Text bold color={idx === selectedPipelineIndex ? 'green' : 'cyan'}>
                      [{idx + 1}]
                    </Text>{' '}
                    {entry.pipeline.name}
                  </Text>
                </Box>
              ))}
              <Box marginTop={1}>
                <Text dimColor>
                  <Text bold>ENTER</Text> load selected · <Text bold>↑↓</Text> navigate · <Text bold>1-9</Text> jump
                </Text>
              </Box>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>cwd: {repoRoot}</Text>
          </Box>
        </Box>
      </Box>
    );
  } else if (screen.kind === 'pipeline-editor') {
    body = (
      <PipelineEditor
        initialPipeline={pipeline ?? undefined}
        repoRoot={repoRoot}
        onComplete={(p) => {
          setPipeline(p);
          navigate({ kind: 'model-selector' });
        }}
        onImport={() => navigate({ kind: 'pipeline-import' })}
        onExport={(p) => {
          setPipeline(p);
          navigate({ kind: 'pipeline-export' });
        }}
        onCancel={() => navigate({ kind: 'welcome' })}
      />
    );
  } else if (screen.kind === 'pipeline-import') {
    body = (
      <PipelineImportList
        entries={availablePipelines}
        onSelect={(loaded) => {
          setPipeline(loaded);
          navigate({ kind: 'pipeline-editor' });
        }}
        onCustomPath={() => navigate({ kind: 'pipeline-import-custom' })}
        onCancel={() => navigate({ kind: pipeline ? 'pipeline-editor' : 'welcome' })}
      />
    );
  } else if (screen.kind === 'pipeline-import-custom') {
    body = (
      <PipelineIOScreen
        mode="import"
        onComplete={(loaded) => {
          if (loaded) {
            setPipeline(loaded);
            navigate({ kind: 'pipeline-editor' });
          }
        }}
        onCancel={() => navigate({ kind: 'pipeline-import' })}
      />
    );
  } else if (screen.kind === 'pipeline-export') {
    body = (
      <PipelineIOScreen
        mode="export"
        pipeline={pipeline ?? undefined}
        onComplete={() => navigate({ kind: 'pipeline-editor' })}
        onCancel={() => navigate({ kind: 'pipeline-editor' })}
      />
    );
  } else if (screen.kind === 'model-selector') {
    body = (
      <ModelSelectorOverlay
        onSelect={(id) => {
          setModelId(id);
          if (requiresApiKey && !apiKey) {
            navigate({ kind: 'api-key' });
          } else {
            navigate({ kind: 'run', modelId: id, apiKey });
          }
        }}
        onCancel={() => navigate({ kind: 'pipeline-editor' })}
      />
    );
  } else if (screen.kind === 'api-key') {
    body = (
      <ApiKeyPrompt
        onSubmit={(key) => {
          setApiKey(key);
          navigate({ kind: 'run', modelId, apiKey: key });
        }}
        onCancel={() => navigate({ kind: 'model-selector' })}
      />
    );
  } else if (screen.kind === 'run' && pipeline) {
    body = (
      <RunDashboard
        config={{ apiKey: screen.apiKey || 'stub', modelId: screen.modelId }}
        pipeline={pipeline}
        cwd={repoRoot}
        agentFactory={factory}
        conflictResolverFactory={conflictResolverFactory}
        onComplete={(result) => navigate({ kind: 'summary', result })}
        onAbort={() => navigate({ kind: 'pipeline-editor' })}
      />
    );
  } else if (screen.kind === 'summary') {
    const r = screen.result;
    const seconds = Math.floor(r.duration / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const committed = r.agents.filter((a) => a.commitSha).length;
    body = (
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

  return (
    <Box flexDirection="column" width="100%">
      <SystemMetricsBar />
      {body}
    </Box>
  );
}
