/**
 * Headless multi-run entry point: run N pipeline specs concurrently under one
 * shared RAM/concurrency budget with lazy admission, and resolve with a flat
 * result per spec.
 *
 * The scheduling itself lives in {@link MultiRunDriver}
 * (`src/orchestrator/multi-run-driver.ts`) — shared with the Ink TUI's
 * `MultiRunDashboard`, so the headless and interactive paths admit runs by the
 * SAME rule. This module is only the result-shaping wrapper around it.
 */

import type { AppConfig, OrchestratorResult, OrchestratorState, Pipeline } from './types.js';
import type { AgentFactory } from '../orchestrator/types.js';
import type { GlobalScheduler } from '../orchestrator/global-scheduler.js';
import { MultiRunDriver } from '../orchestrator/multi-run-driver.js';

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
  /** Present when start() threw (preflight/auth/etc.) or the run failed. */
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
   * omitted, the driver creates and start()/stop()s its own.
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
  if (specs.length === 0) return [];

  const driver = new MultiRunDriver(specs, {
    maxAdmitted: options.maxAdmitted,
    admitCheckMs: options.admitCheckMs,
    admitHysteresisChecks: options.admitHysteresisChecks,
    scheduler: options.scheduler,
    onRunState: options.onRunState
      ? (index, state) => {
          const label = specs[index]?.label ?? specs[index]?.pipeline.name ?? '';
          options.onRunState?.(label, index, state);
        }
      : undefined,
  });

  const slots = await driver.start();
  return slots.map((slot) => ({
    label: slot.label,
    // A run that never produced a manifest (start() threw) reports no runId —
    // the slot's pre-assigned id was never stamped onto anything on disk.
    runId: slot.result?.manifest.runId ?? '',
    status: slot.phase === 'done' ? 'done' : 'error',
    ...(slot.result !== undefined ? { result: slot.result } : {}),
    ...(slot.error !== undefined ? { error: slot.error } : {}),
  }));
}
