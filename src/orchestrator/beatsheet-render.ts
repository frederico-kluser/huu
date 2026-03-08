// Beat Sheet structured text rendering for CLI output

import type {
  BeatSheet,
  AtomicTask,
  CheckpointState,
  BeatTaskStatus,
} from './beatsheet.js';
import { collectTasks } from './beatsheet.js';
import type { CheckpointName } from './checkpoints.js';
import { CHECKPOINT_ORDER } from './checkpoints.js';

// ── Status Icons ────────────────────────────────────────────────────

const STATUS_LABEL: Record<BeatTaskStatus, string> = {
  pending: 'pending',
  ready: 'ready',
  running: 'running',
  blocked: 'BLOCKED',
  done: 'done',
  failed: 'FAILED',
};

// ── Render Options ──────────────────────────────────────────────────

export interface RenderOptions {
  /** Show individual tasks (default: true). */
  showTasks?: boolean;
  /** Maximum tasks to show per sequence before truncating (default: unlimited). */
  maxTasksPerSequence?: number;
  /** Show blocked dependency details (default: true). */
  showBlockedDeps?: boolean;
}

// ── Main Renderer ───────────────────────────────────────────────────

/**
 * Render a beat sheet as structured text for CLI display.
 * Deterministic output: same input always produces same output.
 */
export function renderBeatSheet(sheet: BeatSheet, options: RenderOptions = {}): string {
  const showTasks = options.showTasks !== false;
  const maxTasks = options.maxTasksPerSequence;
  const showBlockedDeps = options.showBlockedDeps !== false;

  const allTasks = collectTasks(sheet);
  const doneTaskIds = new Set(
    allTasks.filter((t) => t.status === 'done').map((t) => t.id),
  );

  const lines: string[] = [];

  // Header
  lines.push(`Beat Sheet: ${sheet.objective}`);
  lines.push(`  Version: ${sheet.version} | Tasks: ${countByStatus(allTasks)}`);
  lines.push('');

  // Acts
  for (const act of sheet.acts) {
    const actTasks = allTasks.filter((t) => t.actId === act.id);
    const actDone = actTasks.filter((t) => t.status === 'done').length;
    const actStatus = summarizeGroupStatus(actTasks);
    lines.push(`  Act ${act.type} — ${act.name} (${actStatus} ${actDone}/${actTasks.length})`);

    // Sequences
    for (const seq of act.sequences) {
      const seqDone = seq.tasks.filter((t) => t.status === 'done').length;
      const seqStatus = summarizeGroupStatus(seq.tasks);
      lines.push(`    Sequence ${seq.id} — ${seq.name} (${seqStatus} ${seqDone}/${seq.tasks.length})`);

      // Tasks
      if (showTasks) {
        const tasksToShow =
          maxTasks !== undefined && maxTasks < seq.tasks.length
            ? seq.tasks.slice(0, maxTasks)
            : seq.tasks;

        for (const task of tasksToShow) {
          const label = STATUS_LABEL[task.status];
          const critical = task.critical ? ' *critical*' : '';
          let line = `      [${label}] ${task.id}: ${task.title}${critical}`;

          // Show blocked deps
          if (
            showBlockedDeps &&
            (task.status === 'blocked' || task.status === 'pending') &&
            task.dependencies.length > 0
          ) {
            const unmetDeps = task.dependencies.filter((d) => !doneTaskIds.has(d));
            if (unmetDeps.length > 0) {
              line += ` deps=[${unmetDeps.join(', ')}]`;
            }
          }

          lines.push(line);
        }

        if (maxTasks !== undefined && maxTasks < seq.tasks.length) {
          lines.push(`      ... and ${seq.tasks.length - maxTasks} more task(s)`);
        }
      }
    }
  }

  // Checkpoints
  lines.push('');
  lines.push(`  Checkpoints: ${renderCheckpoints(sheet.checkpoints)}`);

  // Success criteria
  if (sheet.successCriteria.length > 0) {
    lines.push('');
    lines.push('  Success Criteria:');
    for (const criterion of sheet.successCriteria) {
      lines.push(`    - ${criterion}`);
    }
  }

  return lines.join('\n');
}

/**
 * Render a compact single-line summary of a beat sheet.
 */
export function renderBeatSheetSummary(sheet: BeatSheet): string {
  const allTasks = collectTasks(sheet);
  const done = allTasks.filter((t) => t.status === 'done').length;
  const failed = allTasks.filter((t) => t.status === 'failed').length;
  const running = allTasks.filter((t) => t.status === 'running').length;
  const blocked = allTasks.filter((t) => t.status === 'blocked').length;
  const total = allTasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const parts = [`${done}/${total} done (${pct}%)`];
  if (running > 0) parts.push(`${running} running`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  if (failed > 0) parts.push(`${failed} failed`);

  return `[v${sheet.version}] ${sheet.objective} — ${parts.join(', ')}`;
}

// ── Helpers ─────────────────────────────────────────────────────────

function countByStatus(tasks: AtomicTask[]): string {
  const counts = new Map<BeatTaskStatus, number>();
  for (const task of tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const status of ['done', 'running', 'ready', 'pending', 'blocked', 'failed'] as BeatTaskStatus[]) {
    const count = counts.get(status);
    if (count !== undefined && count > 0) {
      parts.push(`${count} ${status}`);
    }
  }

  return parts.join(', ');
}

function summarizeGroupStatus(tasks: AtomicTask[]): string {
  if (tasks.length === 0) return 'empty';
  if (tasks.every((t) => t.status === 'done')) return 'done';
  if (tasks.some((t) => t.status === 'running')) return 'running';
  if (tasks.some((t) => t.status === 'blocked')) return 'blocked';
  if (tasks.some((t) => t.status === 'failed')) return 'failed';
  if (tasks.some((t) => t.status === 'ready')) return 'ready';
  return 'pending';
}

function renderCheckpoints(checkpoints: CheckpointState): string {
  const parts: string[] = [];
  for (const name of CHECKPOINT_ORDER) {
    parts.push(`${name}=${checkpoints[name as CheckpointName]}`);
  }
  return parts.join(' ');
}
