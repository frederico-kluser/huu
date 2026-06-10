// Per-connection FSM driver for the huu web UI.
//
// One `WebSession` is created per accepted WebSocket connection (see
// `startWebServer`'s `onConnection`). It owns:
//   - the FSM state (mirrors the TUI's `App` component in `src/app.tsx`)
//   - the active agent factory + conflict-resolver pair (mutates when
//     the user picks a different backend)
//   - the per-run Orchestrator + state coalescer (~8Hz, matches the
//     TUI's STATE_FLUSH_INTERVAL_MS=125)
//   - the resolved API key for the active backend
//
// Side-effectful FSM events (selectBackend, missing-keys lookup, etc.)
// are resolved in this layer and only the post-resolution payload is
// dispatched into the pure reducer.

import { pkg } from '../lib/package-info.js';
import {
  initialState,
  reduce,
  type FsmEvent,
  type FsmState,
  type Screen,
} from '../lib/screen-fsm.js';
import {
  findMissingKeysForBackend,
  findSpec,
  resolveApiKey,
  saveApiKey,
} from '../lib/api-key.js';
import {
  selectBackend,
  type AgentBackendKind,
} from '../orchestrator/backends/registry.js';
import type { AgentFactory } from '../orchestrator/types.js';
import { Orchestrator } from '../orchestrator/index.js';
import type {
  AppConfig,
  OrchestratorResult,
  OrchestratorState,
  Pipeline,
} from '../lib/types.js';
import { log as dlog } from '../lib/debug-logger.js';

import type { WebConnection } from './server.js';
import type {
  ClientMessage,
  ServerMessage,
} from './ws-protocol.js';
import { StateCoalescer } from './orchestrator-bridge.js';
import {
  loadPipelineLists,
  savePipeline,
  deletePipeline,
  importPipelineFromJson,
} from './handlers/pipelines.js';
import { scanFileTree } from './handlers/files.js';
import { loadCatalog } from './handlers/models.js';
import { streamAssistant } from './handlers/assistant.js';
import { streamRecon } from './handlers/recon.js';

// Mirrors RunDashboard's STATE_FLUSH_INTERVAL_MS.
const STATE_FLUSH_INTERVAL_MS = 125;

export interface WebSessionDeps {
  cwd: string;
  initialBackend?: AgentBackendKind;
  autoScale?: boolean;
  /**
   * Pre-seed the session with a pipeline loaded by the CLI (`huu run
   * <pipeline.json> --web`). Threaded into `initialState(...)` so the
   * FSM lands the user on the editor (or kicks off auto-start) without
   * an explicit `pipeline.import` round-trip.
   */
  initialPipeline?: Pipeline;
  /**
   * When `true` AND `initialPipeline` is provided, the FSM advances
   * the user straight toward the run screen (mirrors `huu run`).
   */
  autoStart?: boolean;
}

export class WebSession {
  private state: FsmState;
  private factory: AgentFactory;
  private resolverFactory: AgentFactory | undefined;
  private requiresApiKey: boolean;
  private orch: Orchestrator | null = null;
  private coalescer: StateCoalescer | null = null;
  private orchUnsub: (() => void) | null = null;
  private reconAbort: AbortController | null = null;
  private disposed = false;

  constructor(
    private readonly conn: WebConnection,
    private readonly deps: WebSessionDeps,
  ) {
    const initialBackend: AgentBackendKind = deps.initialBackend ?? 'pi';
    const bundle = selectBackend(initialBackend);
    this.factory = bundle.agentFactory;
    this.resolverFactory = bundle.conflictResolverFactory;
    this.requiresApiKey = bundle.requiresApiKey;

    const openrouterSpec = findSpec('openrouter');
    const openrouterResolvedKey = openrouterSpec
      ? resolveApiKey(openrouterSpec)
      : '';

    this.state = initialState({
      initialBackend,
      openrouterResolvedKey,
      requiresApiKey: this.requiresApiKey,
      initialPipeline: deps.initialPipeline,
      autoStart: deps.autoStart,
    });

    conn.onMessage((msg) => {
      void this.handle(msg);
    });

    // Greet immediately so the front-end can synchronize protocol
    // version and render the initial screen without an extra round-trip.
    this.send({
      type: 'hello',
      protocolVersion: 1,
      serverVersion: pkg.version,
    });
    this.send({ type: 'screen', screen: this.state.screen });
  }

  /** Public test helper. Returns a defensive copy of the current state. */
  getState(): FsmState {
    return this.state;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    dlog('web', 'session_dispose');
    if (this.orchUnsub) {
      this.orchUnsub();
      this.orchUnsub = null;
    }
    if (this.coalescer) {
      this.coalescer.dispose();
      this.coalescer = null;
    }
    if (this.orch) {
      try {
        this.orch.abort();
      } catch (err) {
        dlog('web', 'dispose_abort_failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
      this.orch = null;
    }
    if (this.reconAbort) {
      this.reconAbort.abort();
      this.reconAbort = null;
    }
  }

  // ── internal helpers ────────────────────────────────────────────────

  private send(msg: ServerMessage): void {
    try {
      this.conn.send(msg);
    } catch (err) {
      dlog('web', 'send_failed', {
        type: msg.type,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private sendError(message: string, code?: string): void {
    const payload: ServerMessage = code
      ? { type: 'error', message, code }
      : { type: 'error', message };
    this.send(payload);
  }

  private dispatch(event: FsmEvent): void {
    const prev = this.state.screen.kind;
    const next = reduce(this.state, event);
    if (next === undefined) {
      // Should be impossible given the FSM is exhaustive, but guard
      // anyway so a future event type with no case doesn't crash the
      // connection.
      this.sendError('reducer returned undefined', 'FSM_BAD_EVENT');
      return;
    }
    this.state = next;
    if (next.screen.kind !== prev || screensDiffer(this.state.screen, next.screen)) {
      this.send({ type: 'screen', screen: next.screen });
    }
  }

  /**
   * Centralized message dispatcher. Each branch wraps its body in
   * try/catch so a single bad payload (e.g. a malformed JSON import)
   * can't tear down the connection — we surface the error and keep
   * serving the client.
   */
  private async handle(msg: ClientMessage): Promise<void> {
    if (this.disposed) return;
    try {
      switch (msg.type) {
        case 'nav':
          return this.handleNav(msg.event);
        case 'pipeline.requestList':
          return this.sendPipelineLists();
        case 'pipeline.save':
          savePipeline(msg.name, msg.pipeline);
          return this.sendPipelineLists();
        case 'pipeline.delete':
          deletePipeline(msg.name);
          return this.sendPipelineLists();
        case 'pipeline.import': {
          const pipeline = importPipelineFromJson(msg.json);
          // Mirror the TUI's "paste JSON" flow: feed the parsed
          // pipeline into the FSM via `importPaste.complete`, which
          // lands the user on the editor with the new pipeline.
          this.dispatch({ type: 'importPaste.complete', pipeline });
          return;
        }
        case 'pipeline.export':
          // The front-end already holds the pipeline JSON; persisting
          // server-side download URLs is out of scope for the
          // back-end skeleton. The client saves the JSON locally.
          // TODO(web-export): if a future client wants a server-side
          // download URL, add an `exports` endpoint + opaque token.
          this.sendError('export handled client-side', 'NOT_IMPLEMENTED');
          return;
        case 'backend.select':
          return this.handleBackendSelect(msg.backendKind);
        case 'model.requestCatalog': {
          const catalog = loadCatalog(this.deps.cwd, msg.backend);
          this.send({ type: 'models', backend: msg.backend, catalog });
          return;
        }
        case 'model.select':
          return this.handleModelSelect(msg.modelId);
        case 'apiKey.submit':
          return this.handleApiKeySubmit(msg.values, msg.saveGlobally);
        case 'files.scan': {
          const tree = scanFileTree(msg.root);
          this.send({ type: 'files', root: msg.root, tree });
          return;
        }
        case 'assistant.prompt':
          return this.handleAssistantPrompt(msg.prompt);
        case 'recon.start':
          return this.handleReconStart();
        case 'run.start':
          return this.handleRunStart(msg.modelId, msg.apiKey);
        case 'run.abort':
          return this.handleRunAbort();
        case 'run.setConcurrency':
          return this.handleSetConcurrency(msg.concurrency);
        case 'ping':
          // Silent keepalive — the transport heartbeat (ws ping/pong)
          // already drives liveness. We deliberately do NOT echo the
          // current state here; the client polling `ping` shouldn't
          // pay for a full state snapshot.
          return;
        default: {
          const exhaustive: never = msg;
          dlog('web', 'unknown_client_message', { msg: exhaustive });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dlog('web', 'handler_error', { type: msg.type, message });
      this.sendError(message, 'HANDLER_ERROR');
    }
  }

  // ── per-message handlers ────────────────────────────────────────────

  private handleNav(event: FsmEvent): void {
    // The protocol now ships the real `FsmEvent` union (see
    // ws-protocol.ts), so we forward straight to the reducer. Unknown
    // event types would have been rejected at the `isClientMessage`
    // guard inside `wireConnection`; anything that reaches us is at
    // least structurally a known event shape.
    this.dispatch(event);
  }

  private sendPipelineLists(): void {
    const lists = loadPipelineLists(this.deps.cwd);
    this.send({ type: 'pipelines', ...lists });
  }

  private handleBackendSelect(kind: AgentBackendKind): void {
    const bundle = selectBackend(kind);
    this.factory = bundle.agentFactory;
    this.resolverFactory = bundle.conflictResolverFactory;
    this.requiresApiKey = bundle.requiresApiKey;

    // Mirrors app.tsx's BackendSelector onSelect: when every step
    // already has a per-step modelId we skip the model selector.
    const allHaveModel =
      this.state.pipeline !== null &&
      this.state.pipeline.steps.length > 0 &&
      this.state.pipeline.steps.every((s) => !!s.modelId);
    const firstStepModelId = allHaveModel
      ? this.state.pipeline!.steps[0]!.modelId
      : undefined;

    this.dispatch({
      type: 'backend.select',
      backendKind: kind,
      requiresApiKey: bundle.requiresApiKey,
      skipModelSelector: allHaveModel,
      firstStepModelId,
    });
  }

  private handleModelSelect(modelId: string): void {
    const backendKind = this.state.backendKind;
    // `findMissingKeysForBackend` only accepts 'pi' | 'copilot'; for
    // 'stub' we shortcut with no missing keys + no resolved value
    // (the FSM will route past the api-key gate when backend==='stub').
    let missingKeys: ReturnType<typeof findMissingKeysForBackend> = [];
    let resolvedApiKey = this.state.apiKey;
    if (backendKind !== 'stub') {
      missingKeys = findMissingKeysForBackend(backendKind);
      if (missingKeys.length === 0) {
        const specName = backendKind === 'copilot' ? 'copilot' : 'openrouter';
        const spec = findSpec(specName);
        if (spec) resolvedApiKey = resolveApiKey(spec);
      }
    }
    this.dispatch({
      type: 'modelSelector.select',
      modelId,
      requiresApiKey: this.requiresApiKey,
      backendKind,
      missingKeys,
      resolvedApiKey,
    });
  }

  private handleApiKeySubmit(
    values: Record<string, string>,
    saveGlobally: boolean,
  ): void {
    // Mirrors app.tsx's ApiKeyPrompt onSubmit:
    //  - propagate every value into process.env so downstream
    //    resolveApiKey() calls (incl. inside the orchestrator) see it
    //  - optionally persist via saveApiKey() so future runs skip the
    //    prompt entirely
    for (const [name, value] of Object.entries(values)) {
      const spec = findSpec(name);
      if (!spec) continue;
      process.env[spec.envVar] = value;
      if (saveGlobally) saveApiKey(spec, value);
    }
    // Re-resolve via the active backend's spec to get the final
    // post-submit value (which might come from the global store, a
    // mounted secret file, or the just-set env var).
    const backendKind = this.state.backendKind;
    const specName = backendKind === 'copilot' ? 'copilot' : 'openrouter';
    const spec = findSpec(specName);
    const resolvedApiKey = spec ? resolveApiKey(spec) : '';
    this.dispatch({ type: 'apiKey.submit', resolvedApiKey });
  }

  /**
   * Build a backend-aware LlmClientContext for helper LLM calls (assistant,
   * recon). When backend === 'azure', this routes helpers through the user's
   * Azure endpoint instead of OpenRouter, preventing wrong-account charges.
   */
  private buildHelperLlmContext(): import('../lib/llm-client-factory.js').LlmClientContext {
    const backendKind = this.state.backendKind;
    if (backendKind === 'azure') {
      const azureKey = findSpec('azureApiKey');
      const azureEndpoint = findSpec('azureEndpoint');
      return {
        backend: 'azure',
        azureApiKey: azureKey ? resolveApiKey(azureKey) : '',
        azureEndpoint: azureEndpoint ? resolveApiKey(azureEndpoint) : '',
      };
    }
    const openrouter = findSpec('openrouter');
    return {
      backend: backendKind,
      openrouterApiKey: openrouter ? resolveApiKey(openrouter) : '',
    };
  }

  private async handleAssistantPrompt(prompt: string): Promise<void> {
    try {
      const pipeline = await streamAssistant({
        apiKey: this.state.apiKey || 'stub',
        prompt,
        cwd: this.deps.cwd,
        onChunk: (chunk) => this.send({ type: 'assistant.chunk', chunk }),
        llmContext: this.buildHelperLlmContext(),
      });
      this.send({ type: 'assistant.done', pipeline });
      // Advance the FSM so a subsequent `screen` message reflects the
      // editor view the user expects after pipeline generation.
      this.dispatch({ type: 'assistant.complete', pipeline });
    } catch (err) {
      this.sendError(
        err instanceof Error ? err.message : String(err),
        'ASSISTANT_ERROR',
      );
    }
  }

  private async handleReconStart(): Promise<void> {
    if (this.reconAbort) {
      this.reconAbort.abort();
    }
    this.reconAbort = new AbortController();
    try {
      const result = await streamRecon({
        apiKey: this.state.apiKey || 'stub',
        repoRoot: this.deps.cwd,
        onChunk: (chunk) => this.send({ type: 'recon.chunk', chunk }),
        signal: this.reconAbort.signal,
        llmContext: this.buildHelperLlmContext(),
      });
      this.send({ type: 'recon.done', result });
    } catch (err) {
      this.sendError(
        err instanceof Error ? err.message : String(err),
        'RECON_ERROR',
      );
    } finally {
      this.reconAbort = null;
    }
  }

  private async handleRunStart(modelId: string, apiKey: string): Promise<void> {
    if (!modelId) {
      this.sendError('run.start requires modelId', 'BAD_REQUEST');
      return;
    }
    // Stub backend can run without an API key; everything else needs one.
    if (!apiKey && this.state.backendKind !== 'stub') {
      this.sendError('run.start requires apiKey', 'BAD_REQUEST');
      return;
    }
    const pipeline: Pipeline | null = this.state.pipeline;
    if (!pipeline) {
      this.sendError('run.start with no pipeline loaded', 'BAD_REQUEST');
      return;
    }
    if (this.orch) {
      this.sendError('run already in progress', 'CONFLICT');
      return;
    }

    const config: AppConfig = {
      apiKey: apiKey || 'stub',
      modelId,
      backend: this.state.backendKind,
    };
    const orch = new Orchestrator(config, pipeline, this.deps.cwd, this.factory, {
      conflictResolverFactory: this.resolverFactory,
      autoScale: this.deps.autoScale,
    });
    this.orch = orch;

    const coalescer = new StateCoalescer(
      STATE_FLUSH_INTERVAL_MS,
      (state: OrchestratorState) => {
        this.send({ type: 'state', state });
      },
    );
    this.coalescer = coalescer;

    let firstEmit = true;
    this.orchUnsub = orch.subscribe((s: OrchestratorState) => {
      const isTerminal = s.status === 'done' || s.status === 'error';
      coalescer.push(s);
      if (firstEmit || isTerminal) {
        firstEmit = false;
        coalescer.flush();
      }
    });

    orch
      .start()
      .then((result: OrchestratorResult) => {
        // Final state may still be pending in the coalescer; flush so
        // the client receives it before the result.
        coalescer.flush();
        this.send({ type: 'result', result });
        this.dispatch({ type: 'run.complete', result });
      })
      .catch((err: unknown) => {
        this.sendError(
          err instanceof Error ? err.message : String(err),
          'RUN_ERROR',
        );
      })
      .finally(() => {
        if (this.orchUnsub) {
          this.orchUnsub();
          this.orchUnsub = null;
        }
        coalescer.dispose();
        if (this.coalescer === coalescer) this.coalescer = null;
        if (this.orch === orch) this.orch = null;
      });
  }

  private handleRunAbort(): void {
    if (this.orch) {
      try {
        this.orch.abort();
      } catch (err) {
        dlog('web', 'abort_failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Advance the FSM regardless — the user wants out of the run screen.
    this.dispatch({ type: 'run.abort' });
  }

  private handleSetConcurrency(value: number): void {
    if (!Number.isFinite(value) || value < 1) {
      this.sendError('concurrency must be a positive integer', 'BAD_REQUEST');
      return;
    }
    if (!this.orch) {
      this.sendError('no run in progress', 'NO_RUN');
      return;
    }
    this.orch.setConcurrency(Math.floor(value));
  }
}

function screensDiffer(a: Screen, b: Screen): boolean {
  // Cheap deep equality for the discriminated-union screens. Stringify
  // is OK here because the payloads are small and well-typed.
  return JSON.stringify(a) !== JSON.stringify(b);
}
