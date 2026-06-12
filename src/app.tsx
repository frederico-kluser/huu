import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pkg } from './lib/package-info.js';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { join } from 'node:path';
import { ModelSelectorOverlay } from './ui/components/ModelSelectorOverlay.js';
import { PipelineAssistant } from './ui/components/PipelineAssistant.js';
import { PipelineEditor } from './ui/components/PipelineEditor.js';
import { PipelineIOScreen } from './ui/components/PipelineIOScreen.js';
import { PipelineImportList } from './ui/components/PipelineImportList.js';
import { PipelineJsonPaste } from './ui/components/PipelineJsonPaste.js';
import { TimeoutPrompt } from './ui/components/TimeoutPrompt.js';
import { RunDashboard } from './ui/components/RunDashboard.js';
import { ApiKeyPrompt } from './ui/components/ApiKeyPrompt.js';
import { BackendSelector } from './ui/components/BackendSelector.js';
import { useTerminalResize } from './ui/hooks/useTerminalResize.js';
import { SystemMetricsBar } from './ui/components/SystemMetricsBar.js';
import { SavedPipelinesManager } from './ui/components/SavedPipelinesManager.js';
import {
  selectBackend,
  type AgentBackendKind,
} from './orchestrator/backends/registry.js';
import { listAllPipelines, savePipelineToMemory, deletePipelineFromMemory } from './lib/pipeline-io.js';
import { listPipelinesInMemory } from './lib/pipeline-memory.js';
import { ensureAllDefaultPipelines } from './lib/pipeline-bootstrap.js';
import {
  findMissingKeysForBackend,
  findSpec,
  resolveApiKey,
  saveApiKey,
  type ApiKeySpec,
} from './lib/api-key.js';
import { log as dlog, bump as dbump } from './lib/debug-logger.js';
import type { PipelineEntry } from './lib/pipeline-io.js';
import type { AgentFactory } from './orchestrator/types.js';
import type { Pipeline } from './lib/types.js';
import {
  allStepsHaveModel,
  initialState,
  reduce,
  type FsmEvent,
  type FsmState,
} from './lib/screen-fsm.js';
import { theme } from './ui/theme.js';

interface AppProps {
  initialPipeline?: Pipeline;
  agentFactory?: AgentFactory;
  /** Optional LLM resolver for merge conflicts. */
  conflictResolverFactory?: AgentFactory;
  /** If true, an API key is required before running (real LLM). */
  requiresApiKey?: boolean;
  /**
   * Backend kind locked from the CLI flag. When provided, the
   * BackendSelector screen is skipped. When undefined, the user is
   * shown the selector before model picking.
   */
  backend?: AgentBackendKind;
  /** When true and initialPipeline is set, jumps straight from welcome → editor. */
  autoStart?: boolean;
  /**
   * Memory-aware dynamic concurrency (default true). False pins the pool
   * at `concurrency`; the memory guard stays active either way.
   */
  autoScale?: boolean;
  /** Initial/pinned concurrency (--concurrency=N). */
  concurrency?: number;
}

const FULL_CLEAR = '\x1b[3J';

export function App({
  initialPipeline,
  agentFactory,
  conflictResolverFactory,
  requiresApiKey,
  backend: initialBackend,
  autoStart,
  autoScale,
  concurrency,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  useTerminalResize();

  const openrouterSpec = findSpec('openrouter');
  const copilotSpec = findSpec('copilot');
  const azureApiKeySpec = findSpec('azureApiKey');
  const azureEndpointSpec = findSpec('azureEndpoint');

  const [fsm, setFsm] = useState<FsmState>(() =>
    initialState({
      initialPipeline,
      autoStart,
      initialBackend,
      openrouterResolvedKey: openrouterSpec ? resolveApiKey(openrouterSpec) : '',
      requiresApiKey: requiresApiKey ?? true,
    }),
  );

  const dispatch = useCallback((event: FsmEvent) => {
    dlog('nav', 'dispatch', { type: event.type });
    setFsm((prev) => reduce(prev, event));
  }, []);

  // Auxiliary state that does NOT belong in the FSM: backend factories
  // (the FSM is pure — it doesn't know about AgentFactory), UI-list
  // selection, and the pipeline catalog.
  const [activeFactory, setActiveFactory] = useState<AgentFactory | null>(
    () => agentFactory ?? null,
  );
  const [activeResolverFactory, setActiveResolverFactory] = useState<
    AgentFactory | undefined
  >(() => conflictResolverFactory);
  const [activeRequiresApiKey, setActiveRequiresApiKey] = useState<boolean>(
    requiresApiKey ?? true,
  );
  const [availablePipelines, setAvailablePipelines] = useState<PipelineEntry[]>([]);
  const [selectedPipelineIndex, setSelectedPipelineIndex] = useState<number>(0);
  const [savedPipelines, setSavedPipelines] = useState<PipelineEntry[]>([]);

  const { screen, pipeline, modelId, backendKind, apiKey, pipelineSourceName } = fsm;
  const repoRoot = process.cwd();

  // CLI-provided factory wins. When the user picks via TUI we set
  // `activeFactory` from selectBackend(). The fallback chain is:
  // activeFactory → CLI-injected agentFactory → pi (registry default).
  // Memoize so re-renders don't allocate a new BackendBundle just to
  // read its agentFactory — selectBackend() returns a fresh object.
  const piFallbackBundle = useMemo(() => selectBackend('pi'), []);
  const factory =
    activeFactory ?? agentFactory ?? piFallbackBundle.agentFactory;
  const resolverFactory = activeResolverFactory ?? conflictResolverFactory;

  // Active spec used by the missing-key check. Backend determines which
  // entry of API_KEY_REGISTRY is "the required one"; the others stay
  // optional regardless of their `required` flag.
  const activeSpec: ApiKeySpec | undefined =
    backendKind === 'copilot'
      ? copilotSpec
      : backendKind === 'azure'
        ? azureApiKeySpec
        : openrouterSpec;

  // Backend-aware context passed to TUI helpers (Pipeline Assistant, Smart
  // File Select, Project Recon). Without this, helpers used to hard-code
  // OpenRouter even when the agent backend was Azure/Copilot — leaking
  // charges to the wrong account.
  const helperLlmContext: import('./lib/llm-client-factory.js').LlmClientContext = useMemo(() => {
    if (backendKind === 'azure') {
      return {
        backend: 'azure',
        azureApiKey: azureApiKeySpec ? resolveApiKey(azureApiKeySpec) : '',
        azureEndpoint: azureEndpointSpec ? resolveApiKey(azureEndpointSpec) : '',
      };
    }
    // pi, copilot, stub — helpers fall back to OpenRouter (copilot's agent
    // path uses GitHub subscription, but it has no generic-completion API
    // for the helpers, so they continue on OpenRouter).
    return {
      backend: backendKind,
      openrouterApiKey: openrouterSpec ? resolveApiKey(openrouterSpec) : '',
    };
  }, [backendKind, openrouterSpec, azureApiKeySpec, azureEndpointSpec]);

  // Side effects mirroring the legacy navigate() callback: full-screen
  // clear and dlog when screen.kind changes.
  const prevKindRef = useRef(screen.kind);
  useEffect(() => {
    if (prevKindRef.current !== screen.kind) {
      dlog('nav', 'navigate', { from: prevKindRef.current, to: screen.kind });
      if (stdout.isTTY) stdout.write(FULL_CLEAR);
      prevKindRef.current = screen.kind;
    }
  }, [screen.kind, stdout]);

  // One-shot bootstrap: materialize bundled default pipelines into the
  // user's `pipelines/` directory on first mount (idempotent — never
  // overwrites an existing file). Best-effort: failures are logged and
  // don't block the app.
  useEffect(() => {
    try {
      ensureAllDefaultPipelines(repoRoot, (err, mod) => {
        dlog('bootstrap', 'default_pipeline_failed', {
          name: mod.DEFAULT_PIPELINE_NAME,
          error: err.message,
        });
      });
    } catch (err) {
      dlog('bootstrap', 'ensureAllDefaultPipelines_threw', {
        error: (err as Error).message,
      });
    }
  }, [repoRoot]);

  useEffect(() => {
    if (screen.kind === 'welcome' || screen.kind === 'pipeline-import') {
      const entries = listAllPipelines(join(repoRoot, 'pipelines'));
      setAvailablePipelines(entries);
      setSelectedPipelineIndex(0);
    }
    if (screen.kind === 'welcome' || screen.kind === 'saved-pipelines') {
      const memoryEntries = listPipelinesInMemory().map((e) => ({
        fileName: e.name,
        filePath: `memory://${e.name}`,
        pipeline: e.pipeline,
        source: 'global' as const,
      }));
      setSavedPipelines(memoryEntries);
    }
  }, [screen.kind, repoRoot]);

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
          dispatch({ type: 'welcome.quit' });
          exit();
          return;
        }
        if (input === '?') {
          dispatch({ type: 'welcome.faq' });
          return;
        }
        if (input === 'a' || input === 'A') {
          dispatch({ type: 'welcome.assistant' });
          return;
        }
        if (input === 'n' || input === 'N') {
          dispatch({ type: 'welcome.new' });
          return;
        }
        if (input === 'i' || input === 'I') {
          dispatch({ type: 'welcome.import' });
          return;
        }
        if (input === 'm' || input === 'M') {
          dispatch({ type: 'welcome.saved' });
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
            dispatch({ type: 'welcome.selectPipeline', pipeline: selected.pipeline });
          }
          return;
        }
        const num = parseInt(input, 10);
        if (
          !Number.isNaN(num) &&
          num >= 1 &&
          num <= availablePipelinesRef.current.length
        ) {
          dispatch({
            type: 'welcome.selectPipeline',
            pipeline: availablePipelinesRef.current[num - 1]!.pipeline,
          });
        }
      } else if (kind === 'faq') {
        dispatch({ type: 'faq.back' });
      } else if (kind === 'summary') {
        if (input === 'q' || input === 'Q') {
          dispatch({ type: 'summary.quit' });
          exit();
          return;
        }
        if (key.return) dispatch({ type: 'summary.back' });
      }
    },
    [exit, dispatch],
  );

  useInput(handleAppInput, {
    isActive: screen.kind === 'welcome' || screen.kind === 'summary' || screen.kind === 'faq',
  });

  let body: React.JSX.Element = <Text>?</Text>;

  if (screen.kind === 'welcome') {
    body = (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="cyanBright">{' __                        '}</Text>
          <Text bold color="cyanBright">{'/\\ \\                       '}</Text>
          <Text bold color="cyanBright">{'\\ \\ \\___   __  __  __  __  '}</Text>
          <Text bold color="cyanBright">{' \\ \\  _ `\\/\\ \\/\\ \\/\\ \\/\\ \\ '}</Text>
          <Text bold color="cyanBright">{'  \\ \\ \\ \\ \\ \\ \\_\\ \\ \\ \\_\\ \\'}</Text>
          <Text bold color="cyan">{'   \\ \\_\\ \\_\\ \\____/\\ \\____/'}</Text>
          <Text dimColor color="cyan">{'    \\/_/\\/_/\\/___/  \\/___/ '}</Text>
          <Box marginTop={1}>
            <Text bold color="cyan">{pkg.name} v{pkg.version}</Text>
          </Box>
          <Text dimColor>Guided pipeline execution — multi-agent kanban with git worktrees</Text>

          <Box marginTop={1} flexDirection="column">
            <Text>  <Text bold color={theme.ai}>[A]</Text>  Pipeline Assistant</Text>
            <Text>  <Text bold color="cyan">[N]</Text>  New pipeline</Text>
            <Text>  <Text bold color="cyan">[I]</Text>  Import pipeline from list</Text>
            <Text>  <Text bold color="cyan">[M]</Text>  Saved pipelines</Text>
            <Text>  <Text bold color="cyan">[?]</Text>  FAQ — frequently asked questions</Text>
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
  } else if (screen.kind === 'faq') {
    body = (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="cyanBright">FAQ — {pkg.name} v{pkg.version}</Text>
          <Text dimColor>Short answers to the most common questions.</Text>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">What is huu?</Text>
            <Text>
              {'  '}A TUI that orchestrates pipelines of LLM agents in parallel, each isolated
              {'  '}in its own git worktree, with deterministic merge at the end of every stage.
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">What is a pipeline?</Text>
            <Text>
              {'  '}A sequence of steps. Each step decomposes into N tasks that run in
              {'  '}parallel; the stage only advances after merging the tasks into the integration worktree.
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">Does huu modify my repository?</Text>
            <Text>
              {'  '}No. Every run happens in sibling git worktrees. The current branch stays
              {'  '}intact; the result becomes a new branch that you decide whether to merge.
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">Which LLM backends are supported?</Text>
            <Text>
              {'  '}<Text bold>pi</Text> (OpenRouter — default), <Text bold>copilot</Text> (GitHub subscription),
              {'  '}<Text bold>azure</Text> (Azure AI Foundry), and <Text bold>stub</Text> (LLM-free mock, for smoke tests).
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">Do I need an API key?</Text>
            <Text>
              {'  '}Yes for <Text bold>pi</Text> (OPENROUTER_API_KEY). <Text bold>copilot</Text> uses your
              {'  '}GitHub subscription. <Text bold>azure</Text> needs AZURE_OPENAI_API_KEY + AZURE_OPENAI_BASE_URL.
              {'  '}Keys are requested on demand and saved locally.
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">Why does it run inside Docker?</Text>
            <Text>
              {'  '}Isolation: agents have shell access and touch the filesystem. The wrapper
              {'  '}re-executes the binary inside the container automatically. Use <Text bold>--yolo</Text> to run on the host.
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">How do parallel agents avoid port clashes?</Text>
            <Text>
              {'  '}A native shim (LD_PRELOAD / DYLD_INSERT_LIBRARIES) intercepts bind() and
              {'  '}allocates a free port per agent, injected via <Text bold>.env.huu</Text>.
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">What is the Pipeline Assistant [A]?</Text>
            <Text>
              {'  '}LLM-guided mode: you describe the goal in natural language and the
              {'  '}assistant proposes a pipeline ready to edit and run.
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">Can I see prior runs?</Text>
            <Text>
              {'  '}Yes. Pipelines saved in <Text bold>./pipelines</Text> appear on the home screen.
              {'  '}Use <Text bold>[M]</Text> to open the saved-pipelines manager.
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">Is there a web mode?</Text>
            <Text>
              {'  '}Yes. Run <Text bold>huu --web --yolo</Text> and open the front-end in your browser.
              {'  '}Same orchestration, different UI.
            </Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>ENTER</Text> / <Text bold>Esc</Text> / any key — go back
            </Text>
          </Box>
        </Box>
      </Box>
    );
  } else if (screen.kind === 'pipeline-assistant') {
    body = (
      <PipelineAssistant
        apiKey={apiKey || 'stub'}
        llmContext={helperLlmContext}
        onComplete={(p) => dispatch({ type: 'assistant.complete', pipeline: p })}
        onCancel={() => dispatch({ type: 'assistant.cancel' })}
      />
    );
  } else if (screen.kind === 'pipeline-editor') {
    body = (
      <PipelineEditor
        initialPipeline={pipeline ?? undefined}
        sourceName={pipelineSourceName ?? undefined}
        repoRoot={repoRoot}
        apiKey={apiKey || 'stub'}
        llmContext={helperLlmContext}
        onComplete={(p) => {
          // When every step already specifies its own model, skip the
          // global model selector — it would never be used as a fallback.
          if (allStepsHaveModel(p) && initialBackend) {
            // Resolve api-key gate inputs OUTSIDE the reducer so the
            // FSM remains pure. Mirrors legacy navigateToRunSkippingModel.
            // The 'stub' branch short-circuits inside the FSM, so we
            // only consult the api-key registry for real backends.
            const missing =
              backendKind === 'stub' ? [] : findMissingKeysForBackend(backendKind);
            const resolved = activeSpec ? resolveApiKey(activeSpec) : apiKey;
            dispatch({
              type: 'runDirect',
              pipeline: p,
              modelId: p.steps[0]!.modelId!,
              requiresApiKey: activeRequiresApiKey,
              backendKind,
              missingKeys: missing,
              resolvedApiKey: resolved,
            });
            return;
          }
          dispatch({
            type: 'editor.complete',
            pipeline: p,
            initialBackendSet: !!initialBackend,
          });
        }}
        onImport={() => dispatch({ type: 'editor.import' })}
        onExport={(p) => dispatch({ type: 'editor.export', pipeline: p })}
        onCancel={() => dispatch({ type: 'editor.cancel' })}
      />
    );
  } else if (screen.kind === 'backend-selector') {
    body = (
      <BackendSelector
        onSelect={(kind) => {
          const bundle = selectBackend(kind);
          setActiveFactory(() => bundle.agentFactory);
          setActiveResolverFactory(() => bundle.conflictResolverFactory);
          setActiveRequiresApiKey(bundle.requiresApiKey);
          // Skip model selector when every step already has its own model.
          if (allStepsHaveModel(pipeline)) {
            const missing = kind === 'stub' ? [] : findMissingKeysForBackend(kind);
            const spec =
              kind === 'copilot'
                ? copilotSpec
                : kind === 'azure'
                  ? azureApiKeySpec
                  : openrouterSpec;
            const resolved = spec ? resolveApiKey(spec) : apiKey;
            dispatch({
              type: 'runDirect',
              modelId: pipeline!.steps[0]!.modelId!,
              backendKind: kind,
              requiresApiKey: bundle.requiresApiKey,
              missingKeys: missing,
              resolvedApiKey: resolved,
            });
            return;
          }
          dispatch({
            type: 'backend.select',
            backendKind: kind,
            requiresApiKey: bundle.requiresApiKey,
            skipModelSelector: false,
          });
        }}
        onCancel={() => dispatch({ type: 'backend.cancel' })}
      />
    );
  } else if (screen.kind === 'pipeline-import') {
    body = (
      <PipelineImportList
        entries={availablePipelines}
        onSelect={(loaded) =>
          dispatch({ type: 'import.selectFromList', pipeline: loaded })
        }
        onPasteJson={() => dispatch({ type: 'import.paste' })}
        onCustomPath={() => dispatch({ type: 'import.customPath' })}
        onCancel={() => dispatch({ type: 'import.cancel' })}
      />
    );
  } else if (screen.kind === 'pipeline-import-paste') {
    body = (
      <PipelineJsonPaste
        onComplete={(loaded) =>
          dispatch({ type: 'importPaste.complete', pipeline: loaded })
        }
        onCancel={() => dispatch({ type: 'importPaste.cancel' })}
      />
    );
  } else if (screen.kind === 'pipeline-import-custom') {
    body = (
      <PipelineIOScreen
        mode="import"
        onComplete={(loaded) =>
          dispatch({ type: 'importCustom.complete', pipeline: loaded })
        }
        onCancel={() => dispatch({ type: 'importCustom.cancel' })}
      />
    );
  } else if (screen.kind === 'pipeline-export') {
    body = (
      <PipelineIOScreen
        mode="export"
        pipeline={pipeline ?? undefined}
        onComplete={() => dispatch({ type: 'export.complete' })}
        onCancel={() => dispatch({ type: 'export.cancel' })}
      />
    );
  } else if (screen.kind === 'saved-pipelines') {
    body = (
      <SavedPipelinesManager
        entries={savedPipelines}
        onSelect={(loaded) => dispatch({ type: 'saved.select', pipeline: loaded })}
        onDelete={(name) => {
          deletePipelineFromMemory(name);
          setSavedPipelines((prev) => prev.filter((e) => e.pipeline.name !== name));
        }}
        onCancel={() => dispatch({ type: 'saved.cancel' })}
      />
    );
  } else if (screen.kind === 'model-selector') {
    body = (
      <ModelSelectorOverlay
        backend={screen.backendKind}
        onSelect={(id) => {
          // findMissingKeysForBackend gates on the backend's primary
          // spec only. AA used to be universal-required and prompted
          // here, but that fired AFTER pipeline+backend+model picking —
          // a foot-gun. AA is now optional (set ARTIFICIAL_ANALYSIS_API_KEY
          // before launching huu) and the model selector degrades
          // gracefully when missing. Re-resolve at decision time so
          // keys persisted earlier in the same session are picked up.
          const missing =
            screen.backendKind === 'stub' ? [] : findMissingKeysForBackend(screen.backendKind);
          const resolved = activeSpec ? resolveApiKey(activeSpec) : apiKey;
          dispatch({
            type: 'modelSelector.select',
            modelId: id,
            requiresApiKey: activeRequiresApiKey,
            backendKind: screen.backendKind,
            missingKeys: missing,
            resolvedApiKey: resolved,
          });
        }}
        onCancel={() =>
          dispatch({
            type: 'modelSelector.cancel',
            initialBackendSet: !!initialBackend,
          })
        }
      />
    );
  } else if (screen.kind === 'api-key') {
    body = (
      <ApiKeyPrompt
        specs={screen.missing}
        onSubmit={(values, saveGlobally) => {
          // Persist (when allowed) and propagate into process.env so the
          // rest of the app — including downstream resolveApiKey() calls
          // and any code that reads process.env directly — sees the new
          // values without further plumbing.
          for (const [name, value] of Object.entries(values)) {
            const spec = findSpec(name);
            if (!spec) continue;
            process.env[spec.envVar] = value;
            if (saveGlobally) saveApiKey(spec, value);
          }
          const next = activeSpec ? resolveApiKey(activeSpec) : '';
          dispatch({ type: 'apiKey.submit', resolvedApiKey: next });
        }}
        onCancel={() => dispatch({ type: 'apiKey.cancel' })}
      />
    );
  } else if (screen.kind === 'timeout-prompt') {
    body = (
      <TimeoutPrompt
        onSubmit={(minutes) => dispatch({ type: 'timeout.submit', minutes })}
        onCancel={() => dispatch({ type: 'timeout.cancel' })}
      />
    );
  } else if (screen.kind === 'run' && pipeline) {
    body = (
      <RunDashboard
        config={{
          apiKey: screen.apiKey || 'stub',
          modelId: screen.modelId,
          backend: backendKind,
          // For Azure backend, resolve the endpoint from the registry.
          // process.env was updated by the ApiKeyPrompt submit handler,
          // so resolveApiKey picks it up without additional plumbing.
          endpoint:
            backendKind === 'azure' && azureEndpointSpec
              ? resolveApiKey(azureEndpointSpec) || undefined
              : undefined,
        }}
        pipeline={pipeline}
        cwd={repoRoot}
        agentFactory={factory}
        conflictResolverFactory={resolverFactory}
        autoScale={autoScale}
        initialConcurrency={concurrency}
        onComplete={(result) => dispatch({ type: 'run.complete', result })}
        onAbort={() => dispatch({ type: 'run.abort' })}
      />
    );
  } else if (screen.kind === 'summary') {
    const r = screen.result;
    const seconds = Math.floor(r.duration / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const committed = r.agents.filter((a) => a.commitSha).length;
    // Honest verdict colors: red = the RUN failed (manifest carries the
    // actionable reason); yellow = run completed but some agents errored;
    // green = clean.
    const failedAgents = r.agents.filter((a) => a.state === 'error');
    const runFailed = r.manifest.status === 'error';
    const verdictColor = runFailed ? 'red' : failedAgents.length > 0 ? 'yellow' : 'green';
    const verdictText = runFailed
      ? 'Run failed'
      : failedAgents.length > 0
        ? `Run finished — ${failedAgents.length} agent${failedAgents.length === 1 ? '' : 's'} failed`
        : 'Run finished';
    body = (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor={verdictColor} paddingX={1} flexDirection="column" width="100%">
          <Text bold color={verdictColor}>{verdictText}</Text>

          {runFailed && r.manifest.errorReason && (
            <Box marginTop={1} flexDirection="column">
              <Text color="red" wrap="wrap">⚠ {r.manifest.errorReason}</Text>
            </Box>
          )}
          {!runFailed && failedAgents.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text color="yellow" wrap="wrap">
                ⚠ first failure ({failedAgents[0]!.errorKind ?? 'failed'}): {failedAgents[0]!.error ?? 'unknown'}
              </Text>
              <Text dimColor wrap="wrap">full agent logs: .huu/ run logs · per-card details on the dashboard (ENTER on a card)</Text>
            </Box>
          )}

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
