// Scheduler — dependency-aware task assignment with scoring and fairness
//
// Responsible for:
// - Computing the ready set from the beat sheet DAG
// - Scoring task-agent pairs for optimal assignment
// - Enforcing concurrency caps (global + per-role)
// - Aging to prevent starvation of low-priority tasks

import type { AtomicTask } from './beatsheet.js';
import { computeReadySet } from './beatsheet.js';
import type { AgentDefinition } from '../agents/types.js';
import type { AgentSlot, OrchestratorConfig } from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────

export interface TaskAssignment {
  task: AtomicTask;
  agent: AgentDefinition;
  score: number;
}

export interface SchedulerContext {
  allTasks: AtomicTask[];
  doneTaskIds: Set<string>;
  runningTaskIds: Set<string>;
  activeSlots: Map<string, AgentSlot>;
  availableAgents: AgentDefinition[];
  config: OrchestratorConfig;
  /** Timestamps when tasks became ready (for aging). task.id → epochMs */
  readySince: Map<string, number>;
  /** Retry counts per task. task.id → count */
  retryCounts: Map<string, number>;
  now: number;
}

// ── Role mapping ─────────────────────────────────────────────────────

/**
 * Map a task to the best-fitting agent role.
 * This is a heuristic based on task title/action keywords.
 * As more agents are added in 2.3, this will expand.
 */
const ROLE_KEYWORDS: Record<string, string[]> = {
  implementation: ['implement', 'create', 'build', 'add', 'write', 'develop', 'setup', 'scaffold', 'configure', 'install'],
  planning: ['plan', 'decompose', 'break down', 'design', 'architect', 'scope', 'estimate'],
  testing: ['test', 'verify', 'validate', 'assert', 'check', 'coverage'],
  review: ['review', 'audit', 'inspect', 'lint'],
  research: ['research', 'investigate', 'explore', 'analyze'],
  refactoring: ['refactor', 'clean', 'optimize', 'simplify', 'restructure'],
  debugging: ['debug', 'fix', 'diagnose', 'troubleshoot', 'trace'],
  documentation: ['doc', 'readme', 'comment', 'annotate', 'document'],
  merging: ['merge', 'resolve', 'conflict', 'integrate'],
  curation: ['curate', 'memory', 'knowledge', 'context', 'summarize'],
};

export function inferTaskRole(task: AtomicTask): string {
  const text = `${task.title} ${task.action}`.toLowerCase();
  let bestRole = 'implementation'; // default
  let bestScore = 0;

  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  return bestRole;
}

// ── Scoring ──────────────────────────────────────────────────────────

/**
 * Deterministic score for a task-agent pair.
 * Higher score = better match.
 */
export function scoreAssignment(
  task: AtomicTask,
  agent: AgentDefinition,
  ctx: SchedulerContext,
): number {
  const taskRole = inferTaskRole(task);
  const roleMatch = agent.role === taskRole ? 1 : 0;

  // Priority weight: critical tasks score higher
  const priorityWeight = task.critical ? 1 : 0;

  // Aging: minutes since task became ready
  const readyAt = ctx.readySince.get(task.id) ?? ctx.now;
  const agingMinutes = Math.floor((ctx.now - readyAt) / 60_000);

  // Retry penalty
  const retryCount = ctx.retryCounts.get(task.id) ?? 0;

  // Agent current load
  let agentCurrentLoad = 0;
  for (const slot of ctx.activeSlots.values()) {
    if (slot.agentName === agent.name) agentCurrentLoad++;
  }

  // Effort bonus: prefer small tasks to keep throughput high
  const effortBonus =
    task.estimatedEffort === 'small' ? 10 :
    task.estimatedEffort === 'medium' ? 5 : 0;

  return (
    roleMatch * 100 +
    priorityWeight * 30 +
    agingMinutes * 2 +
    effortBonus -
    retryCount * 10 -
    agentCurrentLoad * 5
  );
}

// ── Capacity checks ──────────────────────────────────────────────────

export function hasCapacity(ctx: SchedulerContext): boolean {
  return ctx.activeSlots.size < ctx.config.maxConcurrentAgents;
}

export function hasRoleCapacity(
  agentRole: string,
  ctx: SchedulerContext,
): boolean {
  const cap = ctx.config.roleCaps[agentRole];
  if (cap === undefined) return true; // no cap defined → unlimited

  let roleCount = 0;
  for (const slot of ctx.activeSlots.values()) {
    // Match by agent name since we don't store role in slot
    if (slot.agentName === agentRole) roleCount++;
  }

  // Also match by role from available agents
  const agentsWithRole = ctx.availableAgents.filter(a => a.role === agentRole);
  roleCount = 0;
  for (const slot of ctx.activeSlots.values()) {
    if (agentsWithRole.some(a => a.name === slot.agentName)) roleCount++;
  }

  return roleCount < cap;
}

// ── Scheduling ───────────────────────────────────────────────────────

/**
 * Compute assignments for the current tick.
 * Returns an ordered list of task-agent assignments to execute.
 *
 * Invariants:
 * - Never assigns a task with unmet dependencies
 * - Never exceeds maxConcurrentAgents
 * - Deterministic: same inputs produce same outputs
 */
export function schedule(ctx: SchedulerContext): TaskAssignment[] {
  // 1. Compute ready set (pending tasks with all deps done)
  const readyTasks = computeReadySet(ctx.allTasks, ctx.doneTaskIds);

  // 2. Filter out already running tasks
  const assignableTasks = readyTasks.filter(
    (t) => !ctx.runningTaskIds.has(t.id),
  );

  if (assignableTasks.length === 0) return [];

  // 3. Compute all possible task-agent pairs with scores
  const candidates: TaskAssignment[] = [];

  for (const task of assignableTasks) {
    const taskRole = inferTaskRole(task);

    // Find compatible agents (role match preferred, but any agent can be fallback)
    const matchingAgents = ctx.availableAgents.filter(
      (a) => a.role === taskRole,
    );
    const fallbackAgents = matchingAgents.length > 0
      ? matchingAgents
      : ctx.availableAgents;

    for (const agent of fallbackAgents) {
      const score = scoreAssignment(task, agent, ctx);
      candidates.push({ task, agent, score });
    }
  }

  // 4. Sort by score descending (deterministic tiebreak by task.id then agent.name)
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.task.id !== b.task.id) return a.task.id.localeCompare(b.task.id);
    return a.agent.name.localeCompare(b.agent.name);
  });

  // 5. Greedily assign respecting capacity
  const assignments: TaskAssignment[] = [];
  const assignedTaskIds = new Set<string>();
  let slotsUsed = ctx.activeSlots.size;

  for (const candidate of candidates) {
    if (slotsUsed >= ctx.config.maxConcurrentAgents) break;
    if (assignedTaskIds.has(candidate.task.id)) continue;
    if (!hasRoleCapacity(candidate.agent.role, ctx)) continue;

    assignments.push(candidate);
    assignedTaskIds.add(candidate.task.id);
    slotsUsed++;
  }

  return assignments;
}

/**
 * Update the readySince map: track when tasks first became ready.
 */
export function updateReadySince(
  allTasks: AtomicTask[],
  doneTaskIds: Set<string>,
  runningTaskIds: Set<string>,
  readySince: Map<string, number>,
  now: number,
): void {
  const readyTasks = computeReadySet(allTasks, doneTaskIds);
  const readyIds = new Set(readyTasks.map((t) => t.id));

  // Add newly ready tasks
  for (const id of readyIds) {
    if (!readySince.has(id) && !runningTaskIds.has(id)) {
      readySince.set(id, now);
    }
  }

  // Remove tasks that are no longer ready (done, running, etc.)
  for (const id of readySince.keys()) {
    if (!readyIds.has(id) || runningTaskIds.has(id)) {
      readySince.delete(id);
    }
  }
}
