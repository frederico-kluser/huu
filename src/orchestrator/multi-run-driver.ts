/**
 * Drive MULTIPLE pipeline runs concurrently under ONE shared RAM/concurrency
 * budget, with LAZY admission. The single implementation behind every multi-run
 * front-end that is not the web: the Ink TUI's `MultiRunDashboard` and the
 * headless {@link runMany}.
 *
 * Admission is LAZY and MONOTONIC: only the highest-priority run starts
 * immediately; each subsequent run is pulled in when the machine demonstrably
 * has spare capacity beyond what the running runs demand (sustained headroom,
 * plus room for the next run's fixed BASELINE cost), or when a running run is
 * bottlenecked in its merge. Once admitted a run is never torn down — if a
 * higher-priority run later reclaims capacity, the lower run simply DRAINS (its
 * grant falls, it stops spawning) rather than being killed, so no work is wasted
 * outside genuine RAM pressure.
 *
 * This is the fix for the "blind admission" pathology of `ROADMAP.md` (9
 * simultaneous audits → SIGKILL): before this module the TUI started every
 * selected run in one `for` loop, which is exactly what the web and `run-many`
 * stopped doing in Fase 1. Slots exist from construction so a front-end can
 * render a `queued` run that owns no Orchestrator and costs no budget.
 *
 * Each spec carries its OWN `cwd`, so this drives N PROJECTS — not N pipelines
 * against one repo.
 */

import {
  AdmissionController,
  computeAdmissionContext,
} from '../lib/admission-controller.js';
import { runBaselineBytes } from '../lib/budget.js';
import { generateRunId } from '../lib/run-id.js';
import type {
  AppConfig,
  OrchestratorResult,
  OrchestratorState,
  Pipeline,
} from '../lib/types.js';
import { GlobalScheduler } from './global-scheduler.js';
import { Orchestrator } from './index.js';
import type { AgentFactory } from './types.js';

/** One unit of work: a pipeline against a repo, with its own agent factory. */
export interface MultiRunSpec {
  pipeline: Pipeline;
  config: AppConfig;
  /** Repo root for THIS run. May differ from every other spec's. */
  cwd: string;
  agentFactory: AgentFactory;
  conflictResolverFactory?: AgentFactory;
  /** Display label. Defaults to `pipeline.name`. */
  label?: string;
}

/**
 * `queued` — accepted, no Orchestrator yet, consuming zero budget.
 * `running` — admitted; includes a run held open in `awaiting_retry`.
 * `done` / `error` — settled.
 */
export type MultiRunPhase = 'queued' | 'running' | 'done' | 'error';

export interface MultiRunSlot {
  /** Position in the spec array. IS the scheduler priority (0 = highest). */
  readonly index: number;
  readonly label: string;
  readonly cwd: string;
  readonly pipeline: Pipeline;
  /** Stable from construction, so a `queued` slot already has an identity. */
  readonly runId: string;
  phase: MultiRunPhase;
  /** Null until admitted. */
  orch: Orchestrator | null;
  /** Latest snapshot; null until the run emits its first state. */
  state: OrchestratorState | null;
  result?: OrchestratorResult;
  error?: string;
}

export interface MultiRunDriverOptions {
  /** Ceiling on runs admitted at once. The dial may impose a lower cap. Default 8. */
  maxAdmitted?: number;
  /** Admission poll cadence in ms. Default 500. */
  admitCheckMs?: number;
  /**
   * Consecutive admission checks that must observe spare capacity before the
   * next run is pulled in (wall-clock hysteresis, so a one-tick blip doesn't
   * admit a run that's immediately drained). Default 3.
   */
  admitHysteresisChecks?: number;
  /**
   * Inject a scheduler (tests, or a UI that owns it). When omitted the driver
   * creates and start()/stop()s its own.
   */
  scheduler?: GlobalScheduler;
  /**
   * Machine-global RAM dial for the scheduler this driver owns. Front-ends pass
   * `effectiveRamPercent()` so the dial persisted from the TUI Options / web ⚙
   * Settings applies; omitted falls back to `HUU_RAM_PERCENT`/default. Ignored
   * when `scheduler` is injected (that scheduler already has its own).
   */
  budgetPercent?: number;
  /**
   * Hold a run open in `awaiting_retry` when it ends with failed cards, so the
   * user can retry individual tasks. Safe in multi-run: a held-open run reports
   * `getDemand() === 0`, so it never starves the scheduler.
   */
  interactiveRetry?: boolean;
  autoScale?: boolean;
  initialConcurrency?: number;
  /** Called whenever any slot's phase changes (low frequency). */
  onSlotsChange?: (slots: readonly MultiRunSlot[]) => void;
  /** Called on every state emission of an admitted run (callers throttle). */
  onRunState?: (index: number, state: OrchestratorState) => void;
  /** Cross-run agent-exit announcements from the scheduler (true multi-run only). */
  onAnnounce?: (line: string) => void;
  /**
   * A run's `start()` rejected (preflight/auth/…). The raw error is handed over
   * so the caller owns the policy — e.g. the TUI aborts the whole batch on a
   * shared-key `AuthError` and routes to the key editor.
   */
  onRunError?: (index: number, err: unknown) => void;
}

export class MultiRunDriver {
  readonly slots: MultiRunSlot[];

  private readonly specs: MultiRunSpec[];
  private readonly opts: MultiRunDriverOptions;
  private readonly scheduler: GlobalScheduler;
  private readonly ownsScheduler: boolean;
  private readonly controller: AdmissionController;
  private readonly admitCheckMs: number;
  private readonly runPromises: Array<Promise<void>> = [];
  private readonly unsubscribes: Array<() => void> = [];

  private admitted = 0;
  private settledCount = 0;
  private admitTimer: ReturnType<typeof setInterval> | null = null;
  private releaseAdmission: (() => void) | null = null;
  private aborted = false;
  private started = false;

  constructor(specs: MultiRunSpec[], options: MultiRunDriverOptions = {}) {
    this.specs = specs;
    this.opts = options;
    this.admitCheckMs = options.admitCheckMs ?? 500;
    this.controller = new AdmissionController({
      maxAdmitted: options.maxAdmitted ?? 8,
      hysteresisChecks: options.admitHysteresisChecks ?? 3,
    });
    this.ownsScheduler = options.scheduler === undefined;
    this.scheduler =
      options.scheduler ??
      new GlobalScheduler({
        ...(options.onAnnounce ? { onAnnounce: options.onAnnounce } : {}),
        ...(options.budgetPercent !== undefined
          ? { budgetPercent: options.budgetPercent }
          : {}),
      });
    this.slots = specs.map((spec, index) => ({
      index,
      label: spec.label ?? spec.pipeline.name,
      cwd: spec.cwd,
      pipeline: spec.pipeline,
      runId: generateRunId(),
      phase: 'queued' as MultiRunPhase,
      orch: null,
      state: null,
    }));
  }

  /**
   * Admit the highest-priority run, then pull in the rest as capacity allows.
   * Resolves once every run has settled (or the batch was aborted); never
   * rejects — a run whose `start()` throws lands in `error`.
   */
  async start(): Promise<readonly MultiRunSlot[]> {
    if (this.started) return this.slots;
    this.started = true;
    if (this.specs.length === 0) return this.slots;

    // Always start (idempotent): an injected scheduler the caller forgot to
    // start would leave the budget AutoScaler disabled, which silently turns OFF
    // both the RAM spawn-gate and the OOM guard.
    this.scheduler.start();

    this.admitOne();

    await new Promise<void>((resolve) => {
      this.releaseAdmission = resolve;
      if (this.admitted >= this.specs.length || this.aborted) {
        this.finishAdmission();
        return;
      }
      this.admitTimer = setInterval(() => this.tickAdmission(), this.admitCheckMs);
      this.admitTimer.unref?.();
    });

    await Promise.all(this.runPromises);
    for (const unsub of this.unsubscribes) unsub();
    if (this.ownsScheduler) this.scheduler.stop();
    return this.slots;
  }

  /**
   * Abort everything: admitted runs are told to abort, still-queued runs are
   * marked `error` without ever having been built (mirrors the web's
   * "aborted before admission").
   */
  abortAll(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.finishAdmission();
    let changed = false;
    for (const slot of this.slots) {
      if (slot.phase === 'queued') {
        slot.phase = 'error';
        slot.error = 'aborted before admission';
        changed = true;
      } else if (slot.orch && slot.phase === 'running') {
        slot.orch.abort();
      }
    }
    if (changed) this.emitSlots();
  }

  /** The live Orchestrator of an admitted slot — for retryTask/finish. */
  orchestratorAt(index: number): Orchestrator | null {
    return this.slots[index]?.orch ?? null;
  }

  /** Machine-global budget snapshot for an observability surface. */
  budgetTelemetry(): ReturnType<GlobalScheduler['budgetTelemetry']> {
    return this.scheduler.budgetTelemetry();
  }

  /** Retune the machine-global RAM dial at runtime. */
  setBudgetPercent(pct: number): void {
    this.scheduler.setBudgetPercent(pct);
  }

  /** Stop the admission loop and release `start()`'s wait. Idempotent. */
  private finishAdmission(): void {
    if (this.admitTimer) {
      clearInterval(this.admitTimer);
      this.admitTimer = null;
    }
    const release = this.releaseAdmission;
    this.releaseAdmission = null;
    release?.();
  }

  private emitSlots(): void {
    this.opts.onSlotsChange?.(this.slots);
  }

  /**
   * One admission pass. Beyond the scheduler's slot signal this charges the next
   * run's fixed BASELINE against the byte headroom and derives an adaptive live
   * cap, so a small machine admits fewer concurrent runs than the ceiling —
   * the same rule the web applies (`computeAdmissionContext`).
   */
  private tickAdmission(): void {
    if (this.aborted || this.admitted >= this.specs.length) {
      this.finishAdmission();
      return;
    }
    const liveAdmitted = this.admitted - this.settledCount;
    const anyIntegrating = this.slots.some(
      (s) => s.phase === 'running' && s.state?.status === 'integrating',
    );
    const ctx = computeAdmissionContext({
      liveAdmitted,
      pendingCount: this.specs.length - this.admitted,
      anyIntegrating,
      runBaselineBytes: runBaselineBytes(),
      budget: this.scheduler,
    });
    if (this.controller.shouldAdmit(ctx)) this.admitOne();
  }

  /** Build + start the next queued run, flipping its slot to `running`. */
  private admitOne(): void {
    const index = this.admitted++;
    const spec = this.specs[index]!;
    const slot = this.slots[index]!;
    const orch = new Orchestrator(spec.config, spec.pipeline, spec.cwd, spec.agentFactory, {
      conflictResolverFactory: spec.conflictResolverFactory,
      autoScale: this.opts.autoScale,
      initialConcurrency: this.opts.initialConcurrency,
      interactiveRetry: this.opts.interactiveRetry,
      scheduler: this.scheduler,
      // Spec order IS priority (index 0 = highest). Admission is already
      // sequential, but passing it explicitly hardens the guarantee against the
      // racy concurrent registration order inside orch.start().
      priority: index,
      runId: slot.runId,
    });
    slot.orch = orch;
    slot.phase = 'running';
    this.emitSlots();

    this.unsubscribes.push(
      orch.subscribe((state) => {
        slot.state = state;
        this.opts.onRunState?.(index, state);
      }),
    );

    this.runPromises.push(
      orch
        .start()
        .then((result) => {
          slot.result = result;
          slot.phase = result.manifest.status === 'done' ? 'done' : 'error';
          if (slot.phase === 'error') slot.error = result.manifest.errorReason;
        })
        .catch((err: unknown) => {
          slot.phase = 'error';
          slot.error = err instanceof Error ? err.message : String(err);
          this.opts.onRunError?.(index, err);
        })
        .finally(() => {
          this.settledCount++;
          this.emitSlots();
          // A settled run frees its share of the budget: if nothing is left to
          // admit, release start()'s wait immediately instead of idling a tick.
          if (this.admitted >= this.specs.length) this.finishAdmission();
        }),
    );
  }
}
