/**
 * Single-run lifecycle wrapper around the {@link Orchestrator} for the web
 * server. Mirrors what `RunDashboard.tsx` does for the TUI and what
 * `headless-run.ts` does for `huu auto`: build the AppConfig, construct one
 * Orchestrator, subscribe for live state, and drive start/abort/concurrency.
 *
 * The Orchestrator is single-run-per-instance, so this manager creates a
 * fresh one on every `start()` and refuses to start a second while one is
 * live (the server maps that to HTTP 409). State is pushed to the server via
 * the `onUpdate` callback; the server owns throttling + SSE fan-out.
 */

import { existsSync, statSync } from 'node:fs';
import { Orchestrator } from '../orchestrator/index.js';
import type { AgentOutputChunk } from '../orchestrator/types.js';
import {
  selectBackend,
  type AgentBackendKind,
} from '../orchestrator/backends/registry.js';
import { findSpec, resolveApiKey } from '../lib/api-key.js';
import { backendToProvider } from '../lib/providers.js';
import type {
  AppConfig,
  LlmProvider,
  OrchestratorState,
  Pipeline,
} from '../lib/types.js';
import { getPipelineByName } from './api-data.js';

export type RunPhase = 'idle' | 'running' | 'done' | 'error';

export interface StartRunParams {
  /** Pipeline name to resolve from disk/memory. Ignored when `pipeline` set. */
  pipelineName?: string;
  /** A concrete pipeline (e.g. preloaded via `huu run x.json --web`). */
  pipeline?: Pipeline;
  backend: AgentBackendKind;
  /** User-facing provider (openrouter|azure). Carried into AppConfig for display. */
  provider?: LlmProvider;
  modelId: string;
  /**
   * Per-run API key supplied by the browser (validated client-side, kept in
   * session memory, sent with the request). Takes precedence over the
   * env/mount/disk resolver and is NEVER persisted. Absent for CLI/headless
   * callers, which fall back to the resolver.
   */
  apiKey?: string;
  /** Manual concurrency seed (used when mode === 'manual'). */
  concurrency?: number;
  /** Concurrency strategy. Defaults to 'auto' (memory-aware). */
  mode?: 'auto' | 'manual' | 'greedy';
  /** Azure only — endpoint URL override. */
  endpoint?: string;
  /**
   * Directory to run in. Defaults to the server's cwd. Lets the web folder
   * picker target a different project without restarting the server.
   */
  runDirectory?: string;
  /** Per-card timeout in minutes (sets both card timeouts, like the TUI). */
  timeoutMinutes?: number;
}

export interface RunSnapshot {
  phase: RunPhase;
  runId: string;
  pipelineName: string;
  backend: AgentBackendKind;
  modelId: string;
  startedAt: number;
  finishedAt?: number;
  errorReason?: string;
  state: OrchestratorState | null;
}

const IDLE_SNAPSHOT: RunSnapshot = {
  phase: 'idle',
  runId: '',
  pipelineName: '',
  backend: 'pi',
  modelId: '',
  startedAt: 0,
  state: null,
};

export class WebRunManager {
  private orch: Orchestrator | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeOutput: (() => void) | null = null;
  private snapshot: RunSnapshot = IDLE_SNAPSHOT;

  constructor(
    private readonly cwd: string,
    /** Called on every orchestrator state change (server throttles + fans out). */
    private readonly onUpdate: (snap: RunSnapshot) => void,
    /**
     * Called for every coalesced line of streamed agent output (the raw
     * firehose). Optional — CLI/headless callers don't mirror it. The web
     * server relays each chunk to connected browsers as an `agent-stream`
     * SSE frame so the developer console shows what the agent is producing.
     */
    private readonly onAgentOutput?: (chunk: AgentOutputChunk) => void,
  ) {}

  getSnapshot(): RunSnapshot {
    return this.snapshot;
  }

  isActive(): boolean {
    return this.snapshot.phase === 'running';
  }

  /**
   * Resolve config + factory, construct a fresh Orchestrator, and kick the
   * run. Returns the snapshot (with a transient runId until the orchestrator
   * assigns one). Throws on user-correctable problems (active run, missing
   * key/pipeline/endpoint) so the server can return a 4xx with the message.
   */
  start(params: StartRunParams): RunSnapshot {
    if (this.isActive()) {
      throw new Error('A run is already in progress.');
    }

    const pipeline =
      params.pipeline ??
      (params.pipelineName
        ? getPipelineByName(this.cwd, params.pipelineName)
        : null);
    if (!pipeline) {
      throw new Error(
        `Pipeline not found: ${params.pipelineName ?? '(none provided)'}`,
      );
    }

    const effectivePipeline = applyTimeout(pipeline, params.timeoutMinutes);

    // Resolve the run directory: an explicit pick from the folder picker, or
    // the server's cwd. Validate up front so a typo fails as a 4xx instead of
    // surfacing deep in preflight.
    const runDir = params.runDirectory?.trim() || this.cwd;
    if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
      throw new Error(`Run directory does not exist: ${runDir}`);
    }

    const bundle = selectBackend(params.backend);

    let apiKey = 'stub';
    let endpoint: string | undefined;
    if (bundle.requiresApiKey) {
      const specName = bundle.apiKeySpecName;
      const spec = specName ? findSpec(specName) : undefined;
      // Browser-supplied key (in memory, validated) wins; otherwise resolve
      // from env/mount/disk for the CLI path. Either way nothing is saved.
      apiKey = params.apiKey?.trim() || (spec ? resolveApiKey(spec) : '');
      if (!apiKey) {
        throw new Error(
          `${bundle.label} needs an API key. Paste one in the launch form first.`,
        );
      }
      if (params.backend === 'azure') {
        const endpointSpec = findSpec('azureEndpoint');
        endpoint =
          params.endpoint?.trim() ||
          (endpointSpec ? resolveApiKey(endpointSpec) : '') ||
          undefined;
        if (!endpoint) {
          throw new Error(
            'Azure needs an endpoint URL. Add AZURE_OPENAI_BASE_URL under Settings → Keys.',
          );
        }
      }
    }

    const config: AppConfig = {
      apiKey: apiKey || 'stub',
      modelId: params.modelId,
      backend: params.backend,
      provider: params.provider ?? backendToProvider(params.backend),
      endpoint,
    };

    const mode = params.mode ?? 'auto';
    const orch = new Orchestrator(
      config,
      effectivePipeline,
      runDir,
      bundle.agentFactory,
      {
        conflictResolverFactory: bundle.conflictResolverFactory,
        autoScale: mode !== 'manual',
        initialConcurrency: params.concurrency,
      },
    );
    this.orch = orch;

    if (mode === 'greedy') orch.enableGreedyMode();

    this.snapshot = {
      phase: 'running',
      runId: '',
      pipelineName: effectivePipeline.name,
      backend: params.backend,
      modelId: params.modelId,
      startedAt: Date.now(),
      state: null,
    };

    this.unsubscribe = orch.subscribe((state) => {
      // Keep the freshest runId the orchestrator assigns.
      this.snapshot = {
        ...this.snapshot,
        runId: state.runId || this.snapshot.runId,
        state,
      };
      this.onUpdate(this.snapshot);
    });

    if (this.onAgentOutput) {
      this.unsubscribeOutput = orch.subscribeAgentOutput(this.onAgentOutput);
    }

    // Fire-and-forget: the run resolves asynchronously; we flip phase on
    // settle and emit a final snapshot so the browser shows the summary.
    orch
      .start()
      .then((result) => {
        this.snapshot = {
          ...this.snapshot,
          phase: 'done',
          runId: result.runId || this.snapshot.runId,
          finishedAt: Date.now(),
          errorReason: result.manifest.errorReason,
          state: this.snapshot.state,
        };
      })
      .catch((err: unknown) => {
        this.snapshot = {
          ...this.snapshot,
          phase: 'error',
          finishedAt: Date.now(),
          errorReason: err instanceof Error ? err.message : String(err),
          state: this.snapshot.state,
        };
      })
      .finally(() => {
        if (this.unsubscribe) {
          this.unsubscribe();
          this.unsubscribe = null;
        }
        if (this.unsubscribeOutput) {
          this.unsubscribeOutput();
          this.unsubscribeOutput = null;
        }
        this.orch = null;
        this.onUpdate(this.snapshot);
      });

    this.onUpdate(this.snapshot);
    return this.snapshot;
  }

  /** Hard-stop the active run. No-op when idle. */
  abort(): void {
    this.orch?.abort();
  }

  /** Pin manual concurrency at `value` (also flips out of auto/greedy). */
  setConcurrency(value: number): void {
    this.orch?.setConcurrency(value);
  }

  /** Nudge concurrency up/down by one. */
  adjust(delta: number): void {
    if (!this.orch) return;
    if (delta > 0) this.orch.increaseConcurrency();
    else if (delta < 0) this.orch.decreaseConcurrency();
  }

  /** Switch concurrency strategy mid-run. */
  setMode(mode: 'auto' | 'manual' | 'greedy'): void {
    if (!this.orch) return;
    if (mode === 'auto') this.orch.enableAutoScale();
    else if (mode === 'manual') this.orch.disableAutoScale();
    else this.orch.enableGreedyMode();
  }
}

/**
 * Apply a per-card timeout (minutes) to a pipeline, matching the TUI's
 * TimeoutPrompt: both the multi-file and single-file card timeouts are set.
 * Returns the original pipeline untouched when no timeout is requested.
 */
function applyTimeout(pipeline: Pipeline, minutes?: number): Pipeline {
  if (!minutes || minutes <= 0) return pipeline;
  const ms = Math.floor(minutes * 60_000);
  return { ...pipeline, cardTimeoutMs: ms, singleFileCardTimeoutMs: ms };
}
