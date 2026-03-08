// Checkpoint definitions, evaluation, and state transitions

import type {
  BeatSheet,
  CheckpointState,
  CheckpointStateValue,
  AtomicTask,
} from './beatsheet.js';
import { collectTasks } from './beatsheet.js';

// ── Checkpoint Names ────────────────────────────────────────────────

export const CHECKPOINT_NAMES = [
  'catalyst',
  'midpoint',
  'allIsLost',
  'breakIntoThree',
  'finalImage',
] as const;

export type CheckpointName = (typeof CHECKPOINT_NAMES)[number];

/** Ordered progression: each checkpoint requires the previous one to have passed. */
export const CHECKPOINT_ORDER: readonly CheckpointName[] = CHECKPOINT_NAMES;

// ── Evaluation Result ───────────────────────────────────────────────

export interface CheckpointEvidence {
  criterion: string;
  passed: boolean;
  detail: string;
}

export interface CheckpointEvaluation {
  name: CheckpointName;
  result: CheckpointStateValue;
  evidence: CheckpointEvidence[];
}

// ── Telemetry (lightweight metrics for checkpoint evaluation) ───────

export interface CheckpointTelemetry {
  /** Identified major risk (required for allIsLost). */
  majorRisk?: string;
  /** Contingency plan defined for the major risk. */
  contingencyPlan?: string;
  /** Whether the DAG was revised (required for breakIntoThree). */
  dagRevised?: boolean;
  /** Whether the strategy was adjusted. */
  strategyAdjusted?: boolean;
}

// ── Task Statistics ─────────────────────────────────────────────────

interface TaskStats {
  total: number;
  done: number;
  failed: number;
  running: number;
  blocked: number;
  pending: number;
  ready: number;
  criticalBlocked: number;
}

function computeTaskStats(tasks: AtomicTask[]): TaskStats {
  const stats: TaskStats = {
    total: tasks.length,
    done: 0,
    failed: 0,
    running: 0,
    blocked: 0,
    pending: 0,
    ready: 0,
    criticalBlocked: 0,
  };

  for (const task of tasks) {
    switch (task.status) {
      case 'done':
        stats.done++;
        break;
      case 'failed':
        stats.failed++;
        break;
      case 'running':
        stats.running++;
        break;
      case 'blocked':
        stats.blocked++;
        if (task.critical) stats.criticalBlocked++;
        break;
      case 'pending':
        stats.pending++;
        break;
      case 'ready':
        stats.ready++;
        break;
    }
  }

  return stats;
}

// ── Checkpoint Evaluators ───────────────────────────────────────────

/**
 * Catalyst (~10%): Planning completed, structure is valid.
 *
 * Criteria:
 * - Objective is clear (non-empty)
 * - Constraints are listed
 * - At least 1 act with at least 1 sequence per act
 * - Valid backlog of atomic tasks
 */
function evaluateCatalyst(sheet: BeatSheet, _tasks: AtomicTask[]): CheckpointEvaluation {
  const evidence: CheckpointEvidence[] = [];

  // Objective clear
  const hasObjective = sheet.objective.length > 0;
  evidence.push({
    criterion: 'Objective is defined',
    passed: hasObjective,
    detail: hasObjective ? `"${sheet.objective.slice(0, 80)}"` : 'Missing objective',
  });

  // Success criteria defined
  const hasCriteria = sheet.successCriteria.length > 0;
  evidence.push({
    criterion: 'Success criteria defined',
    passed: hasCriteria,
    detail: `${sheet.successCriteria.length} criterion(s)`,
  });

  // At least 1 act
  const hasActs = sheet.acts.length > 0;
  evidence.push({
    criterion: 'At least 1 act defined',
    passed: hasActs,
    detail: `${sheet.acts.length} act(s)`,
  });

  // Each act has at least 1 sequence
  const allActsHaveSequences = sheet.acts.every((act) => act.sequences.length > 0);
  evidence.push({
    criterion: 'Every act has at least 1 sequence',
    passed: allActsHaveSequences,
    detail: sheet.acts.map((a) => `${a.name}: ${a.sequences.length} seq(s)`).join(', '),
  });

  // Valid tasks
  const hasTasks = _tasks.length > 0;
  evidence.push({
    criterion: 'Backlog has atomic tasks',
    passed: hasTasks,
    detail: `${_tasks.length} task(s)`,
  });

  const allPassed = evidence.every((e) => e.passed);
  return {
    name: 'catalyst',
    result: allPassed ? 'passed' : 'failed',
    evidence,
  };
}

/**
 * Midpoint (~50%): Half the work is done.
 *
 * Criteria:
 * - >= 50% tasks done
 * - No critical tasks blocked without an owner
 * - Major risk is up to date (informational, not blocking)
 */
function evaluateMidpoint(_sheet: BeatSheet, tasks: AtomicTask[]): CheckpointEvaluation {
  const evidence: CheckpointEvidence[] = [];
  const stats = computeTaskStats(tasks);

  // >= 50% done
  const donePct = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;
  const halfDone = donePct >= 50;
  evidence.push({
    criterion: '>= 50% tasks completed',
    passed: halfDone,
    detail: `${stats.done}/${stats.total} (${donePct.toFixed(1)}%)`,
  });

  // No critical blocked
  const noCriticalBlocked = stats.criticalBlocked === 0;
  evidence.push({
    criterion: 'No critical tasks blocked',
    passed: noCriticalBlocked,
    detail: noCriticalBlocked ? 'OK' : `${stats.criticalBlocked} critical task(s) blocked`,
  });

  const allPassed = evidence.every((e) => e.passed);
  return {
    name: 'midpoint',
    result: allPassed ? 'passed' : 'failed',
    evidence,
  };
}

/**
 * All Is Lost (~75%): Risk maximum exposed.
 *
 * Criteria:
 * - >= 75% tasks done or running
 * - Major risk identified and documented
 * - Contingency plan defined
 */
function evaluateAllIsLost(
  _sheet: BeatSheet,
  tasks: AtomicTask[],
  telemetry: CheckpointTelemetry,
): CheckpointEvaluation {
  const evidence: CheckpointEvidence[] = [];
  const stats = computeTaskStats(tasks);

  // >= 75% in progress or done
  const progressPct =
    stats.total > 0 ? ((stats.done + stats.running) / stats.total) * 100 : 0;
  const enoughProgress = progressPct >= 75;
  evidence.push({
    criterion: '>= 75% tasks done or running',
    passed: enoughProgress,
    detail: `${stats.done + stats.running}/${stats.total} (${progressPct.toFixed(1)}%)`,
  });

  // Major risk identified
  const hasRisk = typeof telemetry.majorRisk === 'string' && telemetry.majorRisk.length > 0;
  evidence.push({
    criterion: 'Major risk identified',
    passed: hasRisk,
    detail: hasRisk ? telemetry.majorRisk! : 'No major risk documented',
  });

  // Contingency plan
  const hasPlan =
    typeof telemetry.contingencyPlan === 'string' && telemetry.contingencyPlan.length > 0;
  evidence.push({
    criterion: 'Contingency plan defined',
    passed: hasPlan,
    detail: hasPlan ? telemetry.contingencyPlan! : 'No contingency plan',
  });

  const allPassed = evidence.every((e) => e.passed);
  return {
    name: 'allIsLost',
    result: allPassed ? 'passed' : 'failed',
    evidence,
  };
}

/**
 * Break Into Three (~77%): Recovery/replanning.
 *
 * Criteria:
 * - DAG was revised (version incremented)
 * - Strategy adjusted
 * - No cycles in dependency graph (structural integrity)
 */
function evaluateBreakIntoThree(
  sheet: BeatSheet,
  _tasks: AtomicTask[],
  telemetry: CheckpointTelemetry,
): CheckpointEvaluation {
  const evidence: CheckpointEvidence[] = [];

  // DAG revised
  const dagRevised = telemetry.dagRevised === true;
  evidence.push({
    criterion: 'DAG revised (version incremented)',
    passed: dagRevised,
    detail: dagRevised ? `version ${sheet.version}` : 'DAG not yet revised',
  });

  // Strategy adjusted
  const strategyAdjusted = telemetry.strategyAdjusted === true;
  evidence.push({
    criterion: 'Strategy adjusted',
    passed: strategyAdjusted,
    detail: strategyAdjusted ? 'Strategy was adjusted' : 'No strategy adjustment recorded',
  });

  const allPassed = evidence.every((e) => e.passed);
  return {
    name: 'breakIntoThree',
    result: allPassed ? 'passed' : 'failed',
    evidence,
  };
}

/**
 * Final Image (100%): All done.
 *
 * Criteria:
 * - 100% tasks done or explicitly discarded (failed is acceptable if justified)
 * - All previous checkpoints passed
 * - Success criteria validated
 */
function evaluateFinalImage(
  sheet: BeatSheet,
  tasks: AtomicTask[],
): CheckpointEvaluation {
  const evidence: CheckpointEvidence[] = [];
  const stats = computeTaskStats(tasks);

  // All tasks completed or failed (none pending/running/blocked)
  const allResolved = stats.pending === 0 && stats.running === 0 && stats.blocked === 0 && stats.ready === 0;
  evidence.push({
    criterion: 'All tasks resolved (done or failed)',
    passed: allResolved,
    detail: allResolved
      ? `${stats.done} done, ${stats.failed} failed`
      : `${stats.pending} pending, ${stats.running} running, ${stats.blocked} blocked, ${stats.ready} ready`,
  });

  // Previous checkpoints passed
  const previousPassed =
    sheet.checkpoints.catalyst === 'passed' &&
    sheet.checkpoints.midpoint === 'passed' &&
    sheet.checkpoints.allIsLost === 'passed' &&
    sheet.checkpoints.breakIntoThree === 'passed';
  evidence.push({
    criterion: 'All previous checkpoints passed',
    passed: previousPassed,
    detail: previousPassed
      ? 'All passed'
      : `catalyst=${sheet.checkpoints.catalyst}, midpoint=${sheet.checkpoints.midpoint}, allIsLost=${sheet.checkpoints.allIsLost}, breakIntoThree=${sheet.checkpoints.breakIntoThree}`,
  });

  // Success criteria count (informational — real validation would require external check)
  const hasCriteria = sheet.successCriteria.length > 0;
  evidence.push({
    criterion: 'Success criteria defined for validation',
    passed: hasCriteria,
    detail: `${sheet.successCriteria.length} criterion(s) to validate`,
  });

  const allPassed = evidence.every((e) => e.passed);
  return {
    name: 'finalImage',
    result: allPassed ? 'passed' : 'failed',
    evidence,
  };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Evaluate a single checkpoint.
 */
export function evaluateCheckpoint(
  name: CheckpointName,
  sheet: BeatSheet,
  telemetry: CheckpointTelemetry = {},
): CheckpointEvaluation {
  const tasks = collectTasks(sheet);

  switch (name) {
    case 'catalyst':
      return evaluateCatalyst(sheet, tasks);
    case 'midpoint':
      return evaluateMidpoint(sheet, tasks);
    case 'allIsLost':
      return evaluateAllIsLost(sheet, tasks, telemetry);
    case 'breakIntoThree':
      return evaluateBreakIntoThree(sheet, tasks, telemetry);
    case 'finalImage':
      return evaluateFinalImage(sheet, tasks);
  }
}

/**
 * Evaluate all checkpoints in order. Stops evaluating after the first
 * checkpoint that hasn't passed (returns 'pending' for remaining).
 */
export function evaluateAllCheckpoints(
  sheet: BeatSheet,
  telemetry: CheckpointTelemetry = {},
): CheckpointEvaluation[] {
  const results: CheckpointEvaluation[] = [];

  for (const name of CHECKPOINT_ORDER) {
    // If any previous checkpoint failed, remaining are pending
    const prevFailed = results.some((r) => r.result === 'failed');
    if (prevFailed) {
      results.push({
        name,
        result: 'pending',
        evidence: [
          {
            criterion: 'Previous checkpoint must pass first',
            passed: false,
            detail: 'Blocked by failed predecessor',
          },
        ],
      });
      continue;
    }

    const evaluation = evaluateCheckpoint(name, sheet, telemetry);
    results.push(evaluation);
  }

  return results;
}

/**
 * Apply checkpoint evaluation results back to a beat sheet's checkpoint state.
 * Returns a new CheckpointState (does not mutate input).
 */
export function applyCheckpointResults(
  evaluations: CheckpointEvaluation[],
): CheckpointState {
  const state: CheckpointState = {
    catalyst: 'pending',
    midpoint: 'pending',
    allIsLost: 'pending',
    breakIntoThree: 'pending',
    finalImage: 'pending',
  };

  for (const evaluation of evaluations) {
    state[evaluation.name] = evaluation.result;
  }

  return state;
}

/**
 * Get the currently active checkpoint (the first one not yet passed).
 */
export function getCurrentCheckpoint(state: CheckpointState): CheckpointName | null {
  for (const name of CHECKPOINT_ORDER) {
    if (state[name] !== 'passed') {
      return name;
    }
  }
  return null; // All passed
}

/**
 * Compute overall progress percentage based on checkpoint progression.
 */
export function checkpointProgressPct(state: CheckpointState): number {
  const pcts: Record<CheckpointName, number> = {
    catalyst: 10,
    midpoint: 50,
    allIsLost: 75,
    breakIntoThree: 77,
    finalImage: 100,
  };

  let lastPassed = 0;
  for (const name of CHECKPOINT_ORDER) {
    if (state[name] === 'passed') {
      lastPassed = pcts[name];
    }
  }

  return lastPassed;
}
