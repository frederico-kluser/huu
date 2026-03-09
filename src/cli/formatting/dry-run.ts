// Dry-run beat sheet preview rendering
import pc from 'picocolors';
import type {
  BeatSheet,
  AtomicTask,
  ActNode,
  SequenceNode,
} from '../../orchestrator/beatsheet.js';
import {
  collectTasks,
  computeWaves,
} from '../../orchestrator/beatsheet.js';

// ── Agent assignment heuristic ───────────────────────────────────────

function candidateAgent(task: AtomicTask): string {
  const action = task.action.toLowerCase();
  if (action.includes('test') || action.includes('tdd')) return 'tester';
  if (action.includes('review') || action.includes('audit')) return 'reviewer';
  if (action.includes('doc') || action.includes('readme')) return 'doc-writer';
  if (action.includes('refactor') || action.includes('cleanup')) return 'refactorer';
  if (action.includes('debug') || action.includes('investigate'))
    return 'debugger';
  if (action.includes('research') || action.includes('search'))
    return 'researcher';
  if (action.includes('merge') || action.includes('conflict')) return 'merger';
  return 'builder';
}

// ── Human-readable renderer ──────────────────────────────────────────

export function renderDryRunPreview(sheet: BeatSheet): string {
  const lines: string[] = [];
  const tasks = collectTasks(sheet);

  // Header
  lines.push(pc.dim('='.repeat(70)));
  lines.push(pc.bold('DRY-RUN PREVIEW'));
  lines.push(pc.dim('='.repeat(70)));
  lines.push('');

  // Objective
  lines.push(pc.bold('Objective:'));
  lines.push(`  ${sheet.objective}`);
  lines.push('');

  // Success criteria
  if (sheet.successCriteria.length > 0) {
    lines.push(pc.bold('Success Criteria:'));
    for (const c of sheet.successCriteria) {
      lines.push(`  - ${c}`);
    }
    lines.push('');
  }

  // Constraints
  if (sheet.constraints.length > 0) {
    lines.push(pc.bold('Constraints:'));
    for (const c of sheet.constraints) {
      lines.push(`  - ${c}`);
    }
    lines.push('');
  }

  // Acts → Sequences → Tasks (tree view)
  lines.push(pc.bold('Execution Plan:'));
  lines.push('');

  for (const act of sheet.acts) {
    const actIcon =
      act.type === 'setup'
        ? '1'
        : act.type === 'confrontation'
          ? '2'
          : '3';
    lines.push(
      `${pc.cyan(`Act ${actIcon}`)} ${pc.bold(act.name)} ${pc.dim(`(${act.type})`)}`,
    );
    lines.push(`  ${pc.dim('Objective:')} ${act.objective}`);

    for (const seq of act.sequences) {
      lines.push(`  ${pc.blue('|')} ${pc.bold(seq.name)}`);
      lines.push(`  ${pc.blue('|')}   ${pc.dim(seq.objective)}`);

      for (const task of seq.tasks) {
        const critical = task.critical ? pc.red(' [CRITICAL]') : '';
        const effort = pc.dim(`[${task.estimatedEffort}]`);
        const agent = pc.magenta(`→ ${candidateAgent(task)}`);
        const deps =
          task.dependencies.length > 0
            ? pc.dim(` (deps: ${task.dependencies.join(', ')})`)
            : '';

        lines.push(
          `  ${pc.blue('|')}     ${pc.yellow(task.id)} ${task.title} ${effort}${critical}`,
        );
        lines.push(
          `  ${pc.blue('|')}       ${agent}${deps}`,
        );
      }
    }
    lines.push('');
  }

  // Dependency graph / waves
  let waves: string[][] = [];
  try {
    waves = computeWaves(tasks);
  } catch {
    lines.push(pc.yellow('Warning: Could not compute parallel waves (possible cycle in dependencies)'));
    lines.push('');
  }

  if (waves.length > 0) {
    lines.push(pc.bold('Parallel Execution Waves:'));
    for (let i = 0; i < waves.length; i++) {
      const waveItems = waves[i]!
        .map((id) => {
          const t = tasks.find((t) => t.id === id);
          return t ? `${id} (${candidateAgent(t)})` : id;
        })
        .join(', ');
      lines.push(
        `  Wave ${i + 1}: ${pc.cyan(`[${waves[i]!.length} task(s)]`)} ${waveItems}`,
      );
    }
    lines.push('');

    // Estimated parallelism
    const maxParallel = Math.max(...waves.map((w) => w.length));
    lines.push(
      pc.bold('Estimated Parallelism:') +
        ` up to ${maxParallel} concurrent agent(s)`,
    );
    lines.push(
      pc.bold('Total Tasks:') + ` ${tasks.length}`,
    );
    lines.push(
      pc.bold('Total Waves:') + ` ${waves.length}`,
    );
    lines.push('');
  }

  lines.push(pc.dim('='.repeat(70)));
  lines.push(pc.green('No side effects executed.'));
  lines.push(
    pc.dim(
      'Note: Runtime conditions may differ from this preview. This is a planning-only view.',
    ),
  );
  lines.push(pc.dim('='.repeat(70)));

  return lines.join('\n');
}

// ── JSON renderer ────────────────────────────────────────────────────

export interface DryRunJsonOutput {
  objective: string;
  successCriteria: string[];
  constraints: string[];
  acts: Array<{
    id: string;
    type: string;
    name: string;
    objective: string;
    sequences: Array<{
      id: string;
      name: string;
      objective: string;
      tasks: Array<{
        id: string;
        title: string;
        candidateAgent: string;
        effort: string;
        critical: boolean;
        dependencies: string[];
      }>;
    }>;
  }>;
  waves: string[][];
  stats: {
    totalTasks: number;
    totalWaves: number;
    maxParallelism: number;
    criticalTasks: number;
  };
}

export function renderDryRunJson(sheet: BeatSheet): DryRunJsonOutput {
  const tasks = collectTasks(sheet);

  let waves: string[][] = [];
  try {
    waves = computeWaves(tasks);
  } catch {
    // cycles prevent wave computation
  }

  return {
    objective: sheet.objective,
    successCriteria: sheet.successCriteria,
    constraints: sheet.constraints,
    acts: sheet.acts.map((act) => ({
      id: act.id,
      type: act.type,
      name: act.name,
      objective: act.objective,
      sequences: act.sequences.map((seq) => ({
        id: seq.id,
        name: seq.name,
        objective: seq.objective,
        tasks: seq.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          candidateAgent: candidateAgent(task),
          effort: task.estimatedEffort,
          critical: task.critical,
          dependencies: task.dependencies,
        })),
      })),
    })),
    waves,
    stats: {
      totalTasks: tasks.length,
      totalWaves: waves.length,
      maxParallelism:
        waves.length > 0 ? Math.max(...waves.map((w) => w.length)) : 0,
      criticalTasks: tasks.filter((t) => t.critical).length,
    },
  };
}
