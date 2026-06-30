/**
 * Drive MULTIPLE pipeline runs concurrently under ONE shared RAM/concurrency
 * budget — the headless counterpart of {@link runHeadless}. All runs share a
 * single {@link GlobalScheduler}: earlier specs are higher priority, later ones
 * backfill the idle slots of the earlier ones (e.g. while a higher-priority run
 * is merging), and under memory pressure the scheduler kills the LOWEST-priority
 * run's newest agent first.
 *
 * Admission is LAZY and MONOTONIC: only the highest-priority run starts
 * immediately; each subsequent run is pulled in when the machine demonstrably
 * has spare capacity beyond what the running runs demand (sustained headroom),
 * or when a running run is bottlenecked in its merge. Once admitted a run is
 * never torn down — if a higher-priority run later reclaims capacity, the lower
 * run simply DRAINS (its grant falls, it stops spawning) rather than being
 * killed, so no work is wasted outside genuine RAM pressure.
 */

import type { AppConfig, OrchestratorState, OrchestratorResult, Pipeline } from './types.js';
import type { AgentFactory } from '../orchestrator/types.js';
import { Orchestrator } from '../orchestrator/index.js';
import { GlobalScheduler } from '../orchestrator/global-scheduler.js';
import { AdmissionController } from './admission-controller.js';

export interface RunSpec {
  pipeline: Pipeline;
  config: AppConfig;
  /** Repo root for this run. May be the same repo as another spec or different. */
  cwd: string;
  agentFactory: AgentFactory;
  conflictResolverFactory?: AgentFactory;
  /** Display label for results/logs. Defaults to `pipeline.name`. */
  label?: string;
}

export interface RunManyResult {
  label: string;
  runId: string;
  status: 'done' | 'error';
  /** Present on a clean run; the orchestrator's full result. */
  result?: OrchestratorResult;
  /** Present when start() threw (preflight/auth/etc.). */
  error?: string;
}

export interface RunManyOptions {
  /** Max runs admitted (started) at once. Default 8. */
  maxAdmitted?: number;
  /** Admission poll cadence in ms. Default 500. */
  admitCheckMs?: number;
  /**
   * Consecutive admission checks that must observe spare machine capacity
   * before the next run is pulled in (wall-clock hysteresis, so a one-tick
   * blip doesn't admit a run that's immediately drained). Default 3.
   */
  admitHysteresisChecks?: number;
  /** Observe each admitted run's state (e.g. to mirror to a UI). */
  onRunState?: (label: string, index: number, state: OrchestratorState) => void;
  /**
   * Inject a scheduler (tests / a UI manager that owns the scheduler). When
   * omitted, runMany creates and start()/stop()s its own.
   */
  scheduler?: GlobalScheduler;
}

/**
 * Run `specs` (in priority order, index 0 = highest) concurrently under one
 * shared budget. Resolves once every run has settled; never rejects — a run
 * that throws is reported with `status: 'error'`. Results preserve `specs`
 * order regardless of completion order.
 */
export async function runMany(
  specs: RunSpec[],
  options: RunManyOptions = {},
): Promise<RunManyResult[]> {
  const {
    maxAdmitted = 8,
    admitCheckMs = 500,
    admitHysteresisChecks = 3,
  } = options;

  const results: RunManyResult[] = new Array(specs.length);
  if (specs.length === 0) return results;

  const scheduler = options.scheduler ?? new GlobalScheduler();
  const ownsScheduler = options.scheduler === undefined;
  // Always start (idempotent): an injected scheduler that the caller forgot to
  // start would otherwise leave the budget AutoScaler disabled — which silently
  // turns OFF the RAM spawn-gate AND the OOM guard (shouldSpawn→true,
  // shouldDestroy→false when not enabled). Only stop() the one we own.
  scheduler.start();

  const runPromises: Array<Promise<void>> = [];
  const unsubscribes: Array<() => void> = [];
  const statusByIndex = new Map<number, OrchestratorState['status']>();
  let admitted = 0;
  const controller = new AdmissionController({
    maxAdmitted,
    hysteresisChecks: admitHysteresisChecks,
  });

  const admitOne = (): void => {
    const i = admitted++;
    const spec = specs[i]!;
    const label = spec.label ?? spec.pipeline.name;
    const orch = new Orchestrator(spec.config, spec.pipeline, spec.cwd, spec.agentFactory, {
      conflictResolverFactory: spec.conflictResolverFactory,
      scheduler,
    });
    unsubscribes.push(
      orch.subscribe((state) => {
        statusByIndex.set(i, state.status);
        options.onRunState?.(label, i, state);
      }),
    );
    runPromises.push(
      orch
        .start()
        .then((result) => {
          results[i] = {
            label,
            runId: result.manifest.runId,
            status: result.manifest.status === 'done' ? 'done' : 'error',
            result,
          };
        })
        .catch((err) => {
          results[i] = {
            label,
            runId: '',
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
        }),
    );
  };

  // Highest-priority run starts immediately.
  admitOne();

  // Admission loop: pull in the next queued run when there is sustained spare
  // machine capacity, or when a running run is bottlenecked in its merge.
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (admitted >= specs.length) {
        clearInterval(timer);
        resolve();
        return;
      }
      const finished = results.reduce((n, r) => (r ? n + 1 : n), 0);
      const liveAdmitted = admitted - finished;
      // A run merging (status 'integrating') has its pool drained, so the box is
      // idle even though it's "busy" — the case the user cares about most.
      const anyIntegrating = [...statusByIndex.values()].some((s) => s === 'integrating');
      if (
        controller.shouldAdmit({
          liveAdmitted,
          pendingCount: specs.length - admitted,
          schedulerRemaining: scheduler.remaining,
          anyIntegrating,
        })
      ) {
        admitOne();
      }
    }, admitCheckMs);
    timer.unref?.();
  });

  await Promise.all(runPromises);
  for (const unsub of unsubscribes) unsub();
  if (ownsScheduler) scheduler.stop();
  return results;
}
