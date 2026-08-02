// Development mode for the web front-end.
//
// Design choice worth naming: this manager does NOT reimplement the kanban.
// Each epoch is an ordinary `Orchestrator` run, so the manager pushes a normal
// `RunSnapshot` into the SAME broadcast sink `WebRunManager` uses — the
// browser's existing board renders an epoch with zero client work. What rides
// its own `{type:'dev'}` frame is only what the board cannot express: the
// goal, the knowledge probe, the epoch chain, and the approval gate.
//
// One session at a time, on purpose: every epoch ends in a merge into the
// user's working branch, and two concurrent sessions on one repo would race
// that merge. Concurrency inside a session is the swarm's job.

import { resolve as resolvePath } from 'node:path';
import { Orchestrator } from '../orchestrator/index.js';
import type { AgentOutputChunk } from '../orchestrator/types.js';
import { selectBackend, type AgentBackendKind } from '../orchestrator/backends/registry.js';
import { findSpec } from '../lib/api-key.js';
import { createKeyPoolHandle, type KeyPoolHandle } from '../lib/api-key-pool.js';
import { generateRunId } from '../lib/run-id.js';
import {
  runDevMode,
  type DevEvent,
  type DevRunPhase,
  type DevStopReason,
  type OrphanAction,
} from '../lib/dev-mode/dev-driver.js';
import type { OrphanBranch } from '../lib/dev-mode/orphan-branches.js';
import { activeMethodologies } from '../lib/dev-mode/methodology-registry.js';
import {
  defaultDevModelPolicy,
  parseDevModelPolicy,
  resolveDevModels,
} from '../lib/dev-mode/dev-model-policy.js';
import type {
  AppConfig,
  DevApprovalMode,
  DevEpochRecord,
  DevMethodology,
  DevModelPolicy,
  DevModelPreset,
  DevPlan,
  DevState,
  LlmProvider,
  OrchestratorState,
} from '../lib/types.js';
import { DEV_MAX_FRONTS } from '../lib/types.js';
import { pickRunKey, type RunSnapshot, type WebRunManager } from './run-manager.js';

/**
 * Lifecycle of a dev session as the browser sees it.
 *
 * `knowledge` is the epoch's Phase A — the cheap two-step retrieval run that
 * answers the blind orchestrator's declared gaps. It is a real huu run with
 * its own kanban, so it needs its own phase: rendering it as `running` made
 * the epoch look like it had started implementing when it had not.
 */
export type DevPhase =
  | 'idle'
  | 'probing'
  | 'bootstrapping'
  | 'knowledge'
  | 'planning'
  | 'awaiting-approval'
  | 'running'
  | 'done'
  | 'error';

export interface DevLogLine {
  level: 'info' | 'warn' | 'error';
  message: string;
  at: number;
}

/** A previous session this one could continue, as offered to the browser. */
export interface DevResumeOffer {
  sessionId: string;
  goal: string;
  epochsDone: number;
  nextEpoch: number;
}

/** An integration branch HEAD never absorbed, as offered to the browser. */
export interface DevOrphanBranch {
  branch: string;
  runId: string;
  ahead: number;
  epoch?: number;
}

export interface DevSessionSnapshot {
  active: boolean;
  /**
   * The blackboard namespace (`.huu/dev/<sessionId>/`). Assigned before the
   * driver starts and handed to it, so the id the browser is told is the id on
   * disk; a RESUMED session adopts the previous one's id, at which point this
   * changes to it.
   */
  sessionId: string;
  /** True once this session continued a previous one's epoch numbering. */
  resumed: boolean;
  goal: string;
  runDirectory: string;
  approval: DevApprovalMode;
  phase: DevPhase;
  modelId: string;
  /**
   * The EFFECTIVE model id per role — every role resolved against the policy
   * with `modelId` as the fallback, so the browser can show what actually ran
   * rather than what was requested. With no routing asked for, every role
   * reads back as `modelId`.
   */
  models: Record<string, string>;
  /**
   * The methodology flags this session is actually enforcing, by key, in
   * registry order. Same reason `models` is here: the /dev panel reflects
   * localStorage, not the live session, so a resumed or reloaded browser had
   * no way to read back what a RUNNING session was gated on. Empty array when
   * none is on — never omitted, so the client can render "none" rather than
   * having to distinguish absent from empty.
   */
  methodologies: string[];
  backend: AgentBackendKind;
  /** Epoch ceiling, or null when the session runs until the goal is done. */
  maxEpochs: number | null;
  maxFronts: number;
  currentEpoch: number;
  knowledge?: { present: boolean; reason: string; skillCount: number };
  knowledgeBootstrapped: boolean;
  /** The plan being approved or currently running. */
  plan?: DevPlan;
  planWarnings: string[];
  /** True while `approve()` is the only thing the session is waiting on. */
  awaitingApproval: boolean;
  epochs: DevEpochRecord[];
  /**
   * One entry per orchestrator run, in start order. An epoch is TWO runs now
   * (`knowledge` then `work`), plus the epoch-0 `bootstrap` when the knowledge
   * gate fired — so the epoch number alone no longer identifies a run and the
   * phase travels with it.
   */
  runIds: { epoch: number; runId: string; phase: DevRunPhase }[];
  /** True while `resumeSession()` is the only thing the session is waiting on. */
  awaitingResume: boolean;
  /** The offer behind `awaitingResume`; retained after the answer for display. */
  resumeOffer?: DevResumeOffer;
  /** True while `resolveOrphans()` is the only thing the session is waiting on. */
  awaitingOrphans: boolean;
  /** The branches behind `awaitingOrphans`; retained after the answer. */
  orphans?: DevOrphanBranch[];
  logs: DevLogLine[];
  stoppedBecause?: DevStopReason;
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface StartDevParams {
  goal: string;
  backend: AgentBackendKind;
  provider?: LlmProvider;
  modelId: string;
  /** Browser session key. Same precedence as a normal run. Never persisted. */
  apiKey?: string;
  endpoint?: string;
  runDirectory?: string;
  approval?: DevApprovalMode;
  maxEpochs?: number;
  maxFronts?: number;
  skipKnowledgeBootstrap?: boolean;
  concurrency?: number;
  mode?: 'auto' | 'manual' | 'greedy';
  timeoutMinutes?: number;
  /**
   * Named starting point for the routing policy. Resolved HERE, at the
   * surface, never in the driver — that is what keeps heterogeneous routing an
   * opt-in. Non-`pi` backends resolve to `{}`: every preset id is an
   * OpenRouter id.
   */
  modelsPreset?: DevModelPreset;
  /**
   * Explicit per-role routing, layered OVER `modelsPreset`. A role named here
   * wins; a role named nowhere omits `modelId` on the emitted step and falls
   * back to {@link StartDevParams.modelId}, exactly as today.
   */
  models?: DevModelPolicy;
  /**
   * `'auto'` continues a matching previous session without asking; `'never'`
   * always starts fresh. Undefined ASKS — the session parks at the resume gate
   * and the browser answers via `POST /api/dev/resume`.
   */
  resume?: 'auto' | 'never';
  /**
   * The selectable methodologies (the /dev checkboxes), already coerced by the
   * server. Passed through to the driver untouched: undefined — the same
   * byte-identical contract as {@link StartDevParams.models} — compiles
   * exactly the pipeline it compiles today.
   */
  methodology?: DevMethodology;
}

const MAX_LOG_LINES = 300;

export class WebDevManager {
  private session: DevSessionSnapshot | null = null;
  /** Resolver of the promise `runDevMode` parks on at the approval gate. */
  private approvalResolve: ((approved: boolean) => void) | null = null;
  /**
   * Resolver of the RESUME gate — same parked-promise pattern as the approval
   * gate. Both fail CLOSED on abort: resume answers `false` (a fresh session),
   * orphans answer `'ignore'` (nothing is merged behind the user's back).
   */
  private resumeResolve: ((accept: boolean) => void) | null = null;
  /** Resolver of the ORPHAN-BRANCH gate. */
  private orphanResolve: ((action: OrphanAction) => void) | null = null;
  /**
   * Drives the driver's own abort checkpoints AND cuts the live epoch's run.
   * Before this existed, `abort()` only unblocked the approval gate — a path
   * the AUTONOMOUS mode never reaches — so aborting an autonomous session did
   * nothing at all while the UI claimed otherwise.
   */
  private abortController: AbortController | null = null;
  private activeOrchestrator: Orchestrator | null = null;

  constructor(
    private readonly cwd: string,
    private readonly runs: WebRunManager,
    /** Session-level frame sink (`{type:'dev'}`). */
    private readonly onDev: (snapshot: DevSessionSnapshot) => void,
    /** Per-epoch kanban sink — the SAME one normal runs use. */
    private readonly onRun: (snapshot: RunSnapshot) => void,
    private readonly onAgentOutput?: (runId: string, chunk: AgentOutputChunk) => void,
  ) {}

  /** Current session, or null when none has ever run in this server session. */
  snapshot(): DevSessionSnapshot | null {
    return this.session;
  }

  isActive(): boolean {
    return this.session?.active === true;
  }

  private emit(): void {
    if (!this.session) return;
    try {
      this.onDev({ ...this.session, epochs: [...this.session.epochs], logs: [...this.session.logs] });
    } catch {
      /* a broadcast failure must never take the session down */
    }
  }

  private log(level: DevLogLine['level'], message: string): void {
    if (!this.session) return;
    this.session.logs.push({ level, message, at: Date.now() });
    if (this.session.logs.length > MAX_LOG_LINES) {
      this.session.logs.splice(0, this.session.logs.length - MAX_LOG_LINES);
    }
  }

  /**
   * Start a session. Throws (mapped to 4xx by the server) on a bad request or
   * when a session is already running.
   */
  start(params: StartDevParams): { sessionId: string } {
    if (this.isActive()) {
      throw new Error('a development session is already running — abort it before starting another');
    }
    const goal = params.goal?.trim();
    if (!goal) throw new Error('goal is required');
    if (!params.modelId?.trim()) throw new Error('modelId is required');

    const bundle = selectBackend(params.backend);
    const runDirectory = params.runDirectory ? resolvePath(params.runDirectory) : this.cwd;

    let apiKey = '';
    let apiKeySource: AppConfig['apiKeySource'];
    let keyPool: KeyPoolHandle | undefined;
    if (bundle.requiresApiKey) {
      const specName = params.backend === 'azure' ? 'azureApiKey' : 'openrouter';
      const spec = findSpec(specName);
      const picked = pickRunKey(params.apiKey, this.runs.getWebKey(specName), spec);
      apiKey = picked.value;
      apiKeySource = picked.source;
      if (!apiKey) {
        throw new Error(
          `no API key available for ${params.backend === 'azure' ? 'Azure AI Foundry' : 'OpenRouter'} — add one in ⚙ Settings`,
        );
      }
      // Rotation is opt-in BY CONSTRUCTION: `createKeyPoolHandle` returns a
      // SINGLETON whenever the resolved key is not a member of the persisted
      // pool. A browser session key (or a Docker secret mount, which outranks
      // the store) therefore never gets silently swapped for another one — the
      // handle only rotates when the run is demonstrably using a key the pool
      // owns.
      if (spec) keyPool = createKeyPoolHandle(spec, apiKey);
    }

    let endpoint = params.endpoint?.trim() || undefined;
    if (params.backend === 'azure') {
      endpoint = endpoint ?? (this.runs.getWebKey('azureEndpoint') || undefined);
      if (!endpoint) throw new Error('the Azure provider requires an endpoint URL');
    }

    const config: AppConfig = {
      apiKey: apiKey || 'stub',
      modelId: params.modelId,
      backend: params.backend,
      provider: params.provider ?? (params.backend === 'azure' ? 'azure' : 'openrouter'),
      endpoint,
      apiKeySource,
    };

    const sessionId = generateRunId();
    // The web surface offers NO epoch ceiling: a session runs until the planner
    // reports the goal complete or the user aborts (only the driver's safety
    // backstop bounds it). An explicit value is still honored if one is posted.
    const maxEpochs = params.maxEpochs === undefined ? null : Math.max(1, params.maxEpochs);
    const maxFronts = Math.min(Math.max(1, params.maxFronts ?? DEV_MAX_FRONTS), DEV_MAX_FRONTS);
    const approval: DevApprovalMode = params.approval === 'each-epoch' ? 'each-epoch' : 'autonomous';

    // Preset FIRST, explicit roles OVER it — a user who picks `hetero` and then
    // pins one slot gets the preset everywhere else. A policy that ends up
    // empty is passed as UNDEFINED, not as `{}`: that is what keeps a request
    // carrying none of the new fields compiling the exact pipeline it compiles
    // today, field for field. The explicit half is re-parsed rather than
    // trusted — `start()` is the manager's public entry point, and a malformed
    // role must degrade to "no routing for that role" whoever assembled it.
    const policy: DevModelPolicy = {
      ...(params.modelsPreset ? defaultDevModelPolicy(params.backend, params.modelsPreset) : {}),
      ...parseDevModelPolicy(params.models),
    };
    const routed = Object.keys(policy).length > 0;
    const models = resolveDevModels(routed ? policy : undefined, params.modelId);

    this.abortController = new AbortController();
    this.session = {
      active: true,
      sessionId,
      resumed: false,
      goal,
      runDirectory,
      approval,
      phase: 'probing',
      modelId: params.modelId,
      models,
      methodologies: activeMethodologies(params.methodology).map((d) => d.key),
      backend: params.backend,
      maxEpochs,
      maxFronts,
      currentEpoch: 0,
      knowledgeBootstrapped: false,
      planWarnings: [],
      awaitingApproval: false,
      epochs: [],
      runIds: [],
      awaitingResume: false,
      awaitingOrphans: false,
      logs: [],
      startedAt: Date.now(),
    };
    this.emit();

    const timeoutMs = params.timeoutMinutes ? Math.round(params.timeoutMinutes * 60_000) : undefined;

    void runDevMode({
      dev: {
        goal,
        approval,
        maxEpochs: maxEpochs ?? undefined,
        maxFronts,
        skipKnowledgeBootstrap: params.skipKnowledgeBootstrap,
        // Omitted entirely when nothing was routed — see `routed` above.
        ...(routed ? { models: policy } : {}),
        // Omitted entirely when no methodology checkbox came through — the
        // same byte-identical contract as `models` just above.
        ...(params.methodology ? { methodology: params.methodology } : {}),
      },
      config,
      cwd: runDirectory,
      agentFactory: bundle.agentFactory,
      conflictResolverFactory: bundle.conflictResolverFactory,
      concurrency: params.mode === 'manual' ? params.concurrency : undefined,
      autoScale: params.mode !== 'manual',
      cardTimeoutMs: timeoutMs,
      singleFileCardTimeoutMs: timeoutMs,
      // Hand the driver the id the browser was just told, so the blackboard
      // namespace and the session the UI tracks are the same string.
      sessionId,
      ...(params.resume ? { resume: params.resume } : {}),
      signal: this.abortController.signal,
      onEvent: (event) => this.handleEvent(event),
      onApprove: (plan, epoch, warnings) => this.gate(plan, epoch, warnings),
      onResumeOffer: (previous, nextEpoch) => this.resumeGate(previous, nextEpoch),
      onOrphanBranches: (orphans) => this.orphanGate(orphans),
      orchestratorFactory: (pipeline, epoch, phase) => {
        const runId = generateRunId();
        const orch = new Orchestrator(config, pipeline, runDirectory, bundle.agentFactory, {
          conflictResolverFactory: bundle.conflictResolverFactory,
          autoScale: params.mode !== 'manual',
          initialConcurrency: params.mode === 'manual' ? params.concurrency : undefined,
          runId,
          keyPool,
        });
        // MAX mode now travels through the handle's `setGreedy` seam instead of
        // being called inline: the DRIVER floods the knowledge bootstrap, and a
        // user who asked for MAX still gets it on every run of the session.
        const setGreedy = (): void => orch.enableGreedyMode();
        if (params.mode === 'greedy') setGreedy();
        this.activeOrchestrator = orch;
        if (this.session) {
          this.session.runIds.push({ epoch, runId, phase });
          this.session.phase =
            phase === 'bootstrap' ? 'bootstrapping' : phase === 'knowledge' ? 'knowledge' : 'running';
          this.emit();
        }

        const startedAt = Date.now();
        const pushRun = (state: OrchestratorState | null, phase: RunSnapshot['phase']): void => {
          this.onRun({
            phase,
            runId,
            pipelineName: pipeline.name,
            runDirectory,
            backend: params.backend,
            modelId: params.modelId,
            startedAt,
            state,
          });
        };

        return {
          subscribe: (listener) => {
            const un = orch.subscribe((state) => {
              // Feed BOTH the dev-mode driver and the normal kanban sink.
              listener(state);
              pushRun(state, state.status === 'done' ? 'done' : state.status === 'error' ? 'error' : 'running');
            });
            const unOut = this.onAgentOutput
              ? orch.subscribeAgentOutput((chunk) => this.onAgentOutput!(runId, chunk))
              : () => undefined;
            return () => {
              un();
              unOut();
            };
          },
          start: async () => {
            const result = await orch.start();
            pushRun(orch.getState(), result.manifest.status === 'done' ? 'done' : 'error');
            return result;
          },
          abort: () => orch.abort(),
          setGreedy,
        };
      },
    })
      .then((result) => {
        if (!this.session) return;
        this.session.active = false;
        this.session.awaitingApproval = false;
        this.session.awaitingResume = false;
        this.session.awaitingOrphans = false;
        // Authoritative, because only the driver knows whether the resume gate
        // ended up adopting the previous session's namespace.
        this.session.sessionId = result.sessionId;
        this.session.resumed = result.resumed;
        this.session.phase =
          result.stoppedBecause === 'goal-complete' ||
          result.stoppedBecause === 'max-epochs' ||
          result.stoppedBecause === 'aborted' ||
          result.stoppedBecause === 'plan-rejected'
            ? 'done'
            : 'error';
        this.session.stoppedBecause = result.stoppedBecause;
        this.session.detail = result.detail;
        this.session.knowledgeBootstrapped = result.knowledgeBootstrapped;
        this.session.finishedAt = Date.now();
        this.emit();
      })
      .catch((err: unknown) => {
        if (!this.session) return;
        this.session.active = false;
        this.session.awaitingApproval = false;
        this.session.awaitingResume = false;
        this.session.awaitingOrphans = false;
        this.session.phase = 'error';
        this.session.detail = err instanceof Error ? err.message : String(err);
        this.session.finishedAt = Date.now();
        this.log('error', this.session.detail);
        this.emit();
      })
      .finally(() => {
        this.activeOrchestrator = null;
        this.approvalResolve = null;
        this.resumeResolve = null;
        this.orphanResolve = null;
        this.abortController = null;
      });

    return { sessionId };
  }

  /**
   * Resolve the approval gate. Returns false when nothing was waiting, so the
   * server can answer 409 instead of silently accepting a stale click.
   */
  approve(approved: boolean): boolean {
    if (!this.approvalResolve || !this.session?.awaitingApproval) return false;
    const resolve = this.approvalResolve;
    this.approvalResolve = null;
    this.session.awaitingApproval = false;
    this.session.phase = approved ? 'running' : 'done';
    this.log('info', approved ? 'plano aprovado pelo usuário' : 'plano rejeitado pelo usuário');
    this.emit();
    resolve(approved && this.abortController?.signal.aborted !== true);
    return true;
  }

  /**
   * Answer the resume gate. Returns false when nothing was waiting, so the
   * server can answer 409 instead of silently accepting a stale click.
   */
  resumeSession(accept: boolean): boolean {
    if (!this.resumeResolve || !this.session?.awaitingResume) return false;
    const resolve = this.resumeResolve;
    this.resumeResolve = null;
    this.session.awaitingResume = false;
    const offer = this.session.resumeOffer;
    if (accept && offer) {
      // Adopt the namespace NOW rather than at the end of the session: the
      // browser is about to watch epochs land under that directory.
      this.session.resumed = true;
      if (offer.sessionId) this.session.sessionId = offer.sessionId;
    }
    this.log(
      'info',
      accept && offer
        ? `retomando a sessão ${offer.sessionId} na época ${offer.nextEpoch}`
        : 'começando uma sessão nova (a anterior não será retomada)',
    );
    this.emit();
    resolve(accept && this.abortController?.signal.aborted !== true);
    return true;
  }

  /**
   * Answer the orphan-branch gate. Returns false when nothing was waiting.
   */
  resolveOrphans(action: OrphanAction): boolean {
    if (!this.orphanResolve || !this.session?.awaitingOrphans) return false;
    const resolve = this.orphanResolve;
    this.orphanResolve = null;
    this.session.awaitingOrphans = false;
    const count = this.session.orphans?.length ?? 0;
    this.log(
      'info',
      action === 'land'
        ? `aterrissando ${count} branch(es) de integração órfã(s)`
        : `deixando ${count} branch(es) de integração órfã(s) intocada(s)`,
    );
    this.emit();
    // Fail CLOSED: an abort that races the answer must never trigger a merge.
    resolve(this.abortController?.signal.aborted === true ? 'ignore' : action);
    return true;
  }

  /**
   * Abort the session. Signals the driver (which checks at every boundary and
   * cuts the live run), declines EVERY pending gate, and stops the bootstrap
   * phase too — the bootstrap Orchestrator is built inside the driver, so only
   * the signal can reach it.
   *
   * Every gate fails CLOSED here: no plan is approved, no previous session is
   * adopted, and no orphan branch is merged on the way out.
   */
  abort(): boolean {
    if (!this.isActive()) return false;
    this.log('warn', 'sessão abortada pelo usuário');
    this.abortController?.abort();
    this.activeOrchestrator?.abort();
    this.resumeSession(false);
    this.resolveOrphans('ignore');
    this.approve(false);
    this.emit();
    return true;
  }

  private gate(plan: DevPlan, epoch: number, warnings: string[]): Promise<boolean> {
    if (!this.session || this.abortController?.signal.aborted) return Promise.resolve(false);
    this.session.phase = 'awaiting-approval';
    this.session.awaitingApproval = true;
    this.session.plan = plan;
    this.session.planWarnings = warnings;
    this.session.currentEpoch = epoch;
    this.emit();
    return new Promise<boolean>((resolve) => {
      this.approvalResolve = resolve;
    });
  }

  /**
   * The resume gate. Fires once, before the knowledge gate, when a previous
   * session carried the SAME goal and never reported it complete — and only
   * when the caller did not already decide with `resume: 'auto'|'never'`.
   *
   * `phase` deliberately does NOT change: this is a question asked during
   * `probing`, and the browser drives its prompt off `awaitingResume`.
   */
  private resumeGate(previous: DevState, nextEpoch: number): Promise<boolean> {
    if (!this.session || this.abortController?.signal.aborted) return Promise.resolve(false);
    this.session.awaitingResume = true;
    this.session.resumeOffer = {
      sessionId: previous.sessionId ?? '',
      goal: previous.goal,
      epochsDone: previous.epochs.length,
      nextEpoch,
    };
    this.emit();
    return new Promise<boolean>((resolve) => {
      this.resumeResolve = resolve;
    });
  }

  /**
   * The orphan-branch gate: integration branches HEAD never absorbed. Genuinely
   * lost work that `git status` cannot show, so it is a question, not a log
   * line — but it must never block, hence the abort-safe `'ignore'` default.
   */
  private orphanGate(orphans: OrphanBranch[]): Promise<OrphanAction> {
    if (!this.session || this.abortController?.signal.aborted) {
      return Promise.resolve<OrphanAction>('ignore');
    }
    this.session.awaitingOrphans = true;
    this.session.orphans = orphans.map((o) => ({
      branch: o.branch,
      runId: o.runId,
      ahead: o.ahead,
      ...(o.epoch === undefined ? {} : { epoch: o.epoch }),
    }));
    this.emit();
    return new Promise<OrphanAction>((resolve) => {
      this.orphanResolve = resolve;
    });
  }

  private handleEvent(event: DevEvent): void {
    const s = this.session;
    if (!s) return;

    switch (event.type) {
      case 'knowledge':
        s.knowledge = {
          present: event.status.present,
          reason: event.status.reason,
          skillCount: event.status.skillCount,
        };
        break;
      case 'bootstrap-start':
        s.phase = 'bootstrapping';
        this.log('info', `bootstrap de knowledge com pi (${event.model})`);
        break;
      case 'bootstrap-progress':
        // progress events are too noisy for the web log
        break;
      case 'bootstrap-done':
        s.knowledgeBootstrapped = event.ok;
        this.log(event.ok ? 'info' : 'error', `bootstrap ${event.ok ? 'concluído' : 'falhou'}`);
        break;
      case 'planning':
        s.phase = 'planning';
        s.currentEpoch = event.epoch;
        s.plan = undefined;
        s.planWarnings = [];
        break;
      case 'planned':
        s.plan = event.plan;
        s.planWarnings = event.warnings;
        this.log('info', `época ${event.epoch}: ${event.plan.fronts.map((f) => f.id).join(', ')}`);
        break;
      case 'epoch-start':
        s.phase = 'running';
        s.currentEpoch = event.epoch;
        break;
      case 'epoch-done':
        s.epochs.push(event.record);
        break;
      case 'stopped':
        s.stoppedBecause = event.reason;
        s.detail = event.detail;
        break;
      case 'log':
        this.log(event.level, event.message);
        break;
    }
    this.emit();
  }
}
