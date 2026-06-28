/**
 * Multi-run lifecycle manager for the web server. Holds a `Map<runId, …>` of
 * concurrent runs that all share ONE {@link GlobalScheduler} (a single RAM /
 * concurrency budget): earlier runs have priority, later ones backfill the idle
 * slots of earlier ones, and under memory pressure the scheduler kills the
 * lowest-priority run's newest agent first. `start()` no longer refuses a
 * second run — it assigns a stable runId, registers an Orchestrator with the
 * scheduler, and returns immediately. State is pushed to the server via
 * `onUpdate` (the server throttles + fans out per run); the firehose is tagged
 * with the originating runId.
 *
 * `/simulation` runs are synthetic (no scheduler, no git/LLM) and live in the
 * same map, so the browser can show several at once through the project
 * selector.
 */

import { existsSync, statSync } from 'node:fs';
import { Orchestrator } from '../orchestrator/index.js';
import { GlobalScheduler } from '../orchestrator/global-scheduler.js';
import { SimulationEngine } from '../orchestrator/simulation/engine.js';
import type { SimulationOptions } from '../orchestrator/simulation/engine.js';
import type { AgentOutputChunk } from '../orchestrator/types.js';
import {
  selectBackend,
  type AgentBackendKind,
} from '../orchestrator/backends/registry.js';
import { findSpec, resolveApiKey } from '../lib/api-key.js';
import { backendToProvider } from '../lib/providers.js';
import { generateRunId } from '../lib/run-id.js';
import type {
  AppConfig,
  LlmProvider,
  OrchestratorState,
  Pipeline,
} from '../lib/types.js';
import { getPipelineByName } from './api-data.js';

export type RunPhase = 'idle' | 'running' | 'done' | 'error';

/** Hard cap on simultaneously-tracked runs — a guard against a runaway client. */
const MAX_CONCURRENT_RUNS = 24;

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
   * Optional model for the merge/integration conflict-resolver agent. When
   * non-empty it is applied as `Pipeline.integrationModelId`; empty/absent
   * lets the resolver inherit the run model. The resolver always runs at the
   * model's maximum thinking level (see the pi/azure backend factories).
   */
  conflictResolverModelId?: string;
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

/**
 * The minimal contract the manager drives a run through. Both the real
 * {@link Orchestrator} and the {@link SimulationEngine} satisfy it structurally.
 */
interface RunDriver {
  subscribe(cb: (state: OrchestratorState) => void): () => void;
  subscribeAgentOutput(cb: (chunk: AgentOutputChunk) => void): () => void;
  start(): Promise<{ runId: string; manifest: { errorReason?: string } }>;
}

interface RunEntry {
  snapshot: RunSnapshot;
  /** Live control handle while running; nulled on settle. One of these is set. */
  orch: Orchestrator | null;
  sim: SimulationEngine | null;
}

export class WebRunManager {
  /** One shared budget across every concurrent run. Created+started lazily. */
  private scheduler: GlobalScheduler | null = null;
  private readonly runs = new Map<string, RunEntry>();

  constructor(
    private readonly cwd: string,
    /** Called on every run's state change (server throttles + fans out per runId). */
    private readonly onUpdate: (snap: RunSnapshot) => void,
    /**
     * Called for every coalesced line of streamed agent output, tagged with the
     * originating runId so the server can route the firehose to the right board.
     */
    private readonly onAgentOutput?: (runId: string, chunk: AgentOutputChunk) => void,
  ) {}

  /** Snapshot for a specific run, or (no id) the most-recently-started one. */
  getSnapshot(runId?: string): RunSnapshot {
    if (runId) return this.runs.get(runId)?.snapshot ?? IDLE_SNAPSHOT;
    const entries = [...this.runs.values()];
    return entries.length ? entries[entries.length - 1]!.snapshot : IDLE_SNAPSHOT;
  }

  /** Every tracked run's snapshot, in start order. */
  getSnapshots(): RunSnapshot[] {
    return [...this.runs.values()].map((e) => e.snapshot);
  }

  /** True while any run is still running. */
  isActive(): boolean {
    for (const e of this.runs.values()) if (e.snapshot.phase === 'running') return true;
    return false;
  }

  private activeCount(): number {
    let n = 0;
    for (const e of this.runs.values()) if (e.snapshot.phase === 'running') n++;
    return n;
  }

  private ensureScheduler(): GlobalScheduler {
    if (!this.scheduler) {
      this.scheduler = new GlobalScheduler();
      this.scheduler.start();
    }
    return this.scheduler;
  }

  /**
   * Resolve config + factory, construct a fresh Orchestrator subordinate to the
   * shared scheduler, and kick the run. Returns its snapshot (runId already
   * assigned). Throws on user-correctable problems (missing key/pipeline/
   * endpoint, or too many concurrent runs) so the server returns a 4xx.
   */
  start(params: StartRunParams): RunSnapshot {
    if (this.activeCount() >= MAX_CONCURRENT_RUNS) {
      throw new Error(`Too many concurrent runs (max ${MAX_CONCURRENT_RUNS}).`);
    }

    const pipeline =
      params.pipeline ??
      (params.pipelineName ? getPipelineByName(this.cwd, params.pipelineName) : null);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${params.pipelineName ?? '(none provided)'}`);
    }

    const effectivePipeline = applyResolverModel(
      applyTimeout(pipeline, params.timeoutMinutes),
      params.conflictResolverModelId,
    );

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

    const runId = generateRunId();
    const mode = params.mode ?? 'auto';
    const orch = new Orchestrator(config, effectivePipeline, runDir, bundle.agentFactory, {
      conflictResolverFactory: bundle.conflictResolverFactory,
      autoScale: mode !== 'manual',
      initialConcurrency: params.concurrency,
      scheduler: this.ensureScheduler(),
      runId,
    });

    if (mode === 'greedy') orch.enableGreedyMode();

    const seed: RunSnapshot = {
      phase: 'running',
      runId,
      pipelineName: effectivePipeline.name,
      backend: params.backend,
      modelId: params.modelId,
      startedAt: Date.now(),
      state: null,
    };
    return this.launch(runId, orch, seed, { orch });
  }

  /**
   * Start a synthetic `/simulation` run. No backend/key/pipeline resolution, no
   * git, no LLM, no scheduler — the {@link SimulationEngine} fabricates the
   * kanban. Tracked in the same map so several can show in the selector.
   */
  startSimulation(opts: SimulationOptions): RunSnapshot {
    if (this.activeCount() >= MAX_CONCURRENT_RUNS) {
      throw new Error(`Too many concurrent runs (max ${MAX_CONCURRENT_RUNS}).`);
    }
    const engine = new SimulationEngine(opts);
    const seed: RunSnapshot = {
      phase: 'running',
      runId: opts.runId,
      pipelineName: engine.pipelineName,
      backend: 'stub',
      modelId: opts.modelIds[0] || 'simulation',
      startedAt: Date.now(),
      state: null,
    };
    return this.launch(opts.runId, engine, seed, { sim: engine });
  }

  /**
   * Subscribe a driver to the snapshot + firehose channels and kick it off
   * fire-and-forget, flipping its phase on settle. Each run owns its own entry
   * so concurrent runs never clobber each other's snapshot.
   */
  private launch(
    runId: string,
    driver: RunDriver,
    seed: RunSnapshot,
    refs: { orch?: Orchestrator; sim?: SimulationEngine },
  ): RunSnapshot {
    const entry: RunEntry = { snapshot: seed, orch: refs.orch ?? null, sim: refs.sim ?? null };
    this.runs.set(runId, entry);

    const unsubscribe = driver.subscribe((state) => {
      entry.snapshot = { ...entry.snapshot, runId: state.runId || runId, state };
      this.onUpdate(entry.snapshot);
    });

    let unsubscribeOutput: (() => void) | null = null;
    if (this.onAgentOutput) {
      const cb = this.onAgentOutput;
      unsubscribeOutput = driver.subscribeAgentOutput((chunk) => cb(runId, chunk));
    }

    driver
      .start()
      .then((result) => {
        entry.snapshot = {
          ...entry.snapshot,
          phase: 'done',
          runId: result.runId || runId,
          finishedAt: Date.now(),
          errorReason: result.manifest.errorReason,
          state: entry.snapshot.state,
        };
      })
      .catch((err: unknown) => {
        entry.snapshot = {
          ...entry.snapshot,
          phase: 'error',
          finishedAt: Date.now(),
          errorReason: err instanceof Error ? err.message : String(err),
          state: entry.snapshot.state,
        };
      })
      .finally(() => {
        unsubscribe();
        unsubscribeOutput?.();
        entry.orch = null;
        entry.sim = null;
        this.onUpdate(entry.snapshot);
      });

    this.onUpdate(entry.snapshot);
    return entry.snapshot;
  }

  /** Hard-stop one run, or (no id) every run + tear the shared scheduler down. */
  abort(runId?: string): void {
    if (runId) {
      const e = this.runs.get(runId);
      e?.orch?.abort();
      e?.sim?.abort();
      return;
    }
    for (const e of this.runs.values()) {
      e.orch?.abort();
      e.sim?.abort();
    }
    this.scheduler?.stop();
    this.scheduler = null;
  }

  /** Pause/resume a /simulation run (no-op for real runs / unknown id). */
  setPaused(runId: string, paused: boolean): void {
    this.runs.get(runId)?.sim?.setPaused(paused);
  }

  /** Pin manual concurrency for one run (also flips it out of auto/greedy). */
  setConcurrency(runId: string, value: number): void {
    const e = this.runs.get(runId);
    e?.orch?.setConcurrency(value);
    e?.sim?.setConcurrency(value);
  }

  /** Nudge one run's concurrency up/down by one. */
  adjust(runId: string, delta: number): void {
    const e = this.runs.get(runId);
    const driver = e?.orch ?? e?.sim;
    if (!driver) return;
    if (delta > 0) driver.increaseConcurrency();
    else if (delta < 0) driver.decreaseConcurrency();
  }

  /** Switch one run's concurrency strategy mid-run. */
  setMode(runId: string, mode: 'auto' | 'manual' | 'greedy'): void {
    const e = this.runs.get(runId);
    const driver = e?.orch ?? e?.sim;
    if (!driver) return;
    if (mode === 'auto') driver.enableAutoScale();
    else if (mode === 'manual') driver.disableAutoScale();
    else driver.enableGreedyMode();
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

/**
 * Pin the merge/integration conflict-resolver model. An empty/whitespace value
 * leaves the pipeline untouched so the resolver inherits the run model
 * (`Pipeline.integrationModelId ?? config.modelId`). The orchestrator already
 * reads `integrationModelId`, so this is the entire wiring needed.
 */
export function applyResolverModel(pipeline: Pipeline, modelId?: string): Pipeline {
  const trimmed = modelId?.trim();
  if (!trimmed) return pipeline;
  return { ...pipeline, integrationModelId: trimmed };
}
