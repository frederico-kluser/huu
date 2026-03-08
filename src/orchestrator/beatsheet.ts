// Beat Sheet Engine — data model, validators, DAG, and decomposition prompt

// ── Beat Sheet Status ───────────────────────────────────────────────

export const BEAT_TASK_STATUSES = [
  'pending',
  'ready',
  'running',
  'blocked',
  'done',
  'failed',
] as const;

export type BeatTaskStatus = (typeof BEAT_TASK_STATUSES)[number];

export const ACT_TYPES = ['setup', 'confrontation', 'resolution'] as const;
export type ActType = (typeof ACT_TYPES)[number];

export const EFFORT_LEVELS = ['small', 'medium', 'large'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const CHECKPOINT_STATES = ['pending', 'passed', 'failed'] as const;
export type CheckpointStateValue = (typeof CHECKPOINT_STATES)[number];

// ── Beat Sheet Interfaces ───────────────────────────────────────────

export interface CheckpointState {
  catalyst: CheckpointStateValue;
  midpoint: CheckpointStateValue;
  allIsLost: CheckpointStateValue;
  breakIntoThree: CheckpointStateValue;
  finalImage: CheckpointStateValue;
}

export interface AtomicTask {
  id: string;
  actId: string;
  sequenceId: string;
  title: string;
  precondition: string;
  action: string;
  postcondition: string;
  verification: string;
  dependencies: string[];
  critical: boolean;
  estimatedEffort: EffortLevel;
  status: BeatTaskStatus;
}

export interface SequenceNode {
  id: string;
  actId: string;
  name: string;
  objective: string;
  tasks: AtomicTask[];
}

export interface ActNode {
  id: string;
  type: ActType;
  name: string;
  objective: string;
  sequences: SequenceNode[];
}

export interface BeatSheet {
  id: string;
  objective: string;
  successCriteria: string[];
  constraints: string[];
  acts: ActNode[];
  checkpoints: CheckpointState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Validation ──────────────────────────────────────────────────────

export class BeatSheetValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[],
  ) {
    super(message);
    this.name = 'BeatSheetValidationError';
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBeatSheet(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (input === null || typeof input !== 'object') {
    return { valid: false, errors: ['Input must be a non-null object'] };
  }

  const sheet = input as Record<string, unknown>;

  // Root-level fields
  if (typeof sheet['id'] !== 'string' || sheet['id'] === '') {
    errors.push('id: must be a non-empty string');
  }
  if (typeof sheet['objective'] !== 'string' || sheet['objective'] === '') {
    errors.push('objective: must be a non-empty string');
  }
  if (!Array.isArray(sheet['successCriteria']) || sheet['successCriteria'].length === 0) {
    errors.push('successCriteria: must be a non-empty array');
  } else {
    for (let i = 0; i < sheet['successCriteria'].length; i++) {
      if (typeof sheet['successCriteria'][i] !== 'string' || sheet['successCriteria'][i] === '') {
        errors.push(`successCriteria[${i}]: must be a non-empty string`);
      }
    }
  }
  if (!Array.isArray(sheet['constraints'])) {
    errors.push('constraints: must be an array');
  }
  if (typeof sheet['version'] !== 'number' || sheet['version'] < 1) {
    errors.push('version: must be a positive integer');
  }

  // Acts
  if (!Array.isArray(sheet['acts']) || sheet['acts'].length === 0) {
    errors.push('acts: must have at least 1 act');
    return { valid: false, errors };
  }

  const allTaskIds = new Set<string>();
  const allIds = new Set<string>();
  const tasks: AtomicTask[] = [];

  for (let ai = 0; ai < sheet['acts'].length; ai++) {
    const act = sheet['acts'][ai] as Record<string, unknown>;
    const actPrefix = `acts[${ai}]`;

    if (typeof act['id'] !== 'string' || act['id'] === '') {
      errors.push(`${actPrefix}.id: must be a non-empty string`);
    } else if (allIds.has(act['id'] as string)) {
      errors.push(`${actPrefix}.id: duplicate id "${act['id']}"`);
    } else {
      allIds.add(act['id'] as string);
    }

    if (!ACT_TYPES.includes(act['type'] as ActType)) {
      errors.push(`${actPrefix}.type: must be one of ${ACT_TYPES.join(', ')}`);
    }
    if (typeof act['name'] !== 'string' || act['name'] === '') {
      errors.push(`${actPrefix}.name: must be a non-empty string`);
    }
    if (typeof act['objective'] !== 'string' || act['objective'] === '') {
      errors.push(`${actPrefix}.objective: must be a non-empty string`);
    }

    // Sequences
    if (!Array.isArray(act['sequences']) || act['sequences'].length === 0) {
      errors.push(`${actPrefix}.sequences: must have at least 1 sequence`);
      continue;
    }

    for (let si = 0; si < act['sequences'].length; si++) {
      const seq = act['sequences'][si] as Record<string, unknown>;
      const seqPrefix = `${actPrefix}.sequences[${si}]`;

      if (typeof seq['id'] !== 'string' || seq['id'] === '') {
        errors.push(`${seqPrefix}.id: must be a non-empty string`);
      } else if (allIds.has(seq['id'] as string)) {
        errors.push(`${seqPrefix}.id: duplicate id "${seq['id']}"`);
      } else {
        allIds.add(seq['id'] as string);
      }

      if (typeof seq['name'] !== 'string' || seq['name'] === '') {
        errors.push(`${seqPrefix}.name: must be a non-empty string`);
      }
      if (typeof seq['objective'] !== 'string' || seq['objective'] === '') {
        errors.push(`${seqPrefix}.objective: must be a non-empty string`);
      }

      // Tasks
      if (!Array.isArray(seq['tasks']) || seq['tasks'].length === 0) {
        errors.push(`${seqPrefix}.tasks: must have at least 1 task`);
        continue;
      }

      for (let ti = 0; ti < seq['tasks'].length; ti++) {
        const task = seq['tasks'][ti] as Record<string, unknown>;
        const taskPrefix = `${seqPrefix}.tasks[${ti}]`;

        if (typeof task['id'] !== 'string' || task['id'] === '') {
          errors.push(`${taskPrefix}.id: must be a non-empty string`);
        } else if (allTaskIds.has(task['id'] as string)) {
          errors.push(`${taskPrefix}.id: duplicate task id "${task['id']}"`);
        } else {
          allTaskIds.add(task['id'] as string);
        }

        for (const field of ['title', 'precondition', 'action', 'postcondition', 'verification'] as const) {
          if (typeof task[field] !== 'string' || task[field] === '') {
            errors.push(`${taskPrefix}.${field}: must be a non-empty string`);
          }
        }

        if (!Array.isArray(task['dependencies'])) {
          errors.push(`${taskPrefix}.dependencies: must be an array`);
        }

        if (typeof task['critical'] !== 'boolean') {
          errors.push(`${taskPrefix}.critical: must be a boolean`);
        }

        if (!EFFORT_LEVELS.includes(task['estimatedEffort'] as EffortLevel)) {
          errors.push(`${taskPrefix}.estimatedEffort: must be one of ${EFFORT_LEVELS.join(', ')}`);
        }

        if (!BEAT_TASK_STATUSES.includes(task['status'] as BeatTaskStatus)) {
          errors.push(`${taskPrefix}.status: must be one of ${BEAT_TASK_STATUSES.join(', ')}`);
        }

        tasks.push(task as unknown as AtomicTask);
      }
    }
  }

  // Validate dependency references
  for (const task of tasks) {
    if (Array.isArray(task.dependencies)) {
      for (const dep of task.dependencies) {
        if (!allTaskIds.has(dep)) {
          errors.push(`task "${task.id}": dependency "${dep}" references unknown task`);
        }
        if (dep === task.id) {
          errors.push(`task "${task.id}": self-dependency is not allowed`);
        }
      }
    }
  }

  // Validate checkpoints
  if (sheet['checkpoints'] !== undefined && sheet['checkpoints'] !== null) {
    const cp = sheet['checkpoints'] as Record<string, unknown>;
    for (const name of ['catalyst', 'midpoint', 'allIsLost', 'breakIntoThree', 'finalImage'] as const) {
      if (!CHECKPOINT_STATES.includes(cp[name] as CheckpointStateValue)) {
        errors.push(`checkpoints.${name}: must be one of ${CHECKPOINT_STATES.join(', ')}`);
      }
    }
  } else {
    errors.push('checkpoints: must be defined');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a beat sheet and throw if invalid.
 */
export function assertValidBeatSheet(input: unknown): asserts input is BeatSheet {
  const result = validateBeatSheet(input);
  if (!result.valid) {
    throw new BeatSheetValidationError(
      `Invalid beat sheet: ${result.errors.length} error(s)`,
      result.errors,
    );
  }
}

// ── Normalization ───────────────────────────────────────────────────

const DEFAULT_CHECKPOINTS: CheckpointState = {
  catalyst: 'pending',
  midpoint: 'pending',
  allIsLost: 'pending',
  breakIntoThree: 'pending',
  finalImage: 'pending',
};

/**
 * Normalize a raw beat sheet input: fill in defaults for optional fields.
 * Does NOT validate — call validateBeatSheet first.
 */
export function normalizeBeatSheet(input: Record<string, unknown>): BeatSheet {
  const now = new Date().toISOString();
  const sheet = {
    ...input,
    constraints: Array.isArray(input['constraints']) ? input['constraints'] : [],
    checkpoints: input['checkpoints'] ?? { ...DEFAULT_CHECKPOINTS },
    version: typeof input['version'] === 'number' ? input['version'] : 1,
    createdAt: typeof input['createdAt'] === 'string' ? input['createdAt'] : now,
    updatedAt: now,
  } as Record<string, unknown>;

  // Normalize tasks
  if (Array.isArray(sheet['acts'])) {
    for (const act of sheet['acts'] as ActNode[]) {
      for (const seq of act.sequences) {
        seq.actId = act.id;
        for (const task of seq.tasks) {
          task.actId = act.id;
          task.sequenceId = seq.id;
          task.dependencies = task.dependencies ?? [];
          task.critical = task.critical ?? false;
          task.estimatedEffort = task.estimatedEffort ?? 'medium';
          task.status = task.status ?? 'pending';
        }
      }
    }
  }

  return sheet as unknown as BeatSheet;
}

// ── DAG: Dependency Graph ───────────────────────────────────────────

export class CycleDetectedError extends Error {
  constructor(
    message: string,
    public readonly cycle: string[],
  ) {
    super(message);
    this.name = 'CycleDetectedError';
  }
}

/**
 * Collect all atomic tasks from a beat sheet.
 */
export function collectTasks(sheet: BeatSheet): AtomicTask[] {
  const tasks: AtomicTask[] = [];
  for (const act of sheet.acts) {
    for (const seq of act.sequences) {
      for (const task of seq.tasks) {
        tasks.push(task);
      }
    }
  }
  return tasks;
}

/**
 * Build an adjacency list from tasks: taskId → set of tasks that depend on it (successors).
 */
export function buildAdjacencyList(tasks: AtomicTask[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const task of tasks) {
    if (!adj.has(task.id)) {
      adj.set(task.id, []);
    }
    for (const dep of task.dependencies) {
      const successors = adj.get(dep);
      if (successors) {
        successors.push(task.id);
      } else {
        adj.set(dep, [task.id]);
      }
    }
  }
  return adj;
}

/**
 * Detect cycles in the task dependency graph using DFS.
 * Returns the cycle path if one is found, or null if acyclic.
 */
export function detectCycle(tasks: AtomicTask[]): string[] | null {
  const taskMap = new Map<string, AtomicTask>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const t of tasks) {
    color.set(t.id, WHITE);
  }

  for (const t of tasks) {
    if (color.get(t.id) === WHITE) {
      const cycle = dfsVisit(t.id, taskMap, color, parent);
      if (cycle) return cycle;
    }
  }

  return null;
}

function dfsVisit(
  nodeId: string,
  taskMap: Map<string, AtomicTask>,
  color: Map<string, number>,
  parent: Map<string, string | null>,
): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  color.set(nodeId, GRAY);
  const task = taskMap.get(nodeId);
  if (!task) return null;

  for (const dep of task.dependencies) {
    const depColor = color.get(dep);
    if (depColor === GRAY) {
      // Found a cycle — reconstruct path
      const cycle: string[] = [dep, nodeId];
      let cur = nodeId;
      while (parent.get(cur) !== undefined && parent.get(cur) !== dep) {
        cur = parent.get(cur)!;
        cycle.push(cur);
      }
      cycle.reverse();
      return cycle;
    }
    if (depColor === WHITE) {
      parent.set(dep, nodeId);
      const cycle = dfsVisit(dep, taskMap, color, parent);
      if (cycle) return cycle;
    }
  }

  color.set(nodeId, BLACK);
  return null;
}

/**
 * Topological sort via Kahn's algorithm. Returns ordered task IDs.
 * Throws CycleDetectedError if graph has cycles.
 */
export function topologicalSort(tasks: AtomicTask[]): string[] {
  const cycle = detectCycle(tasks);
  if (cycle) {
    throw new CycleDetectedError(
      `Dependency cycle detected: ${cycle.join(' → ')}`,
      cycle,
    );
  }

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    if (!adj.has(task.id)) {
      adj.set(task.id, []);
    }
  }

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      const successors = adj.get(dep);
      if (successors) {
        successors.push(task.id);
      }
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  // Priority queue: critical desc, effort asc (small < medium < large), id asc
  const effortOrder: Record<string, number> = { small: 0, medium: 1, large: 2 };
  const taskMap = new Map<string, AtomicTask>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
    }
  }

  queue.sort((a, b) => {
    const ta = taskMap.get(a)!;
    const tb = taskMap.get(b)!;
    // Critical first
    if (ta.critical !== tb.critical) return ta.critical ? -1 : 1;
    // Smaller effort first
    const ea = effortOrder[ta.estimatedEffort] ?? 1;
    const eb = effortOrder[tb.estimatedEffort] ?? 1;
    if (ea !== eb) return ea - eb;
    // Alphabetical ID
    return a.localeCompare(b);
  });

  const result: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);

    for (const successor of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(successor) ?? 1) - 1;
      inDegree.set(successor, newDeg);
      if (newDeg === 0) {
        queue.push(successor);
        // Re-sort to maintain deterministic ordering
        queue.sort((a, b) => {
          const ta = taskMap.get(a)!;
          const tb = taskMap.get(b)!;
          if (ta.critical !== tb.critical) return ta.critical ? -1 : 1;
          const ea = effortOrder[ta.estimatedEffort] ?? 1;
          const eb = effortOrder[tb.estimatedEffort] ?? 1;
          if (ea !== eb) return ea - eb;
          return a.localeCompare(b);
        });
      }
    }
  }

  return result;
}

/**
 * Compute parallel execution waves: groups of tasks that can run concurrently.
 * Tasks within the same wave have no dependencies on each other.
 */
export function computeWaves(tasks: AtomicTask[]): string[][] {
  const sorted = topologicalSort(tasks);
  const taskMap = new Map<string, AtomicTask>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  // Compute depth (wave index) for each task
  const depth = new Map<string, number>();
  for (const id of sorted) {
    const task = taskMap.get(id)!;
    let maxDepDep = -1;
    for (const dep of task.dependencies) {
      const depDepth = depth.get(dep) ?? 0;
      if (depDepth > maxDepDep) {
        maxDepDep = depDepth;
      }
    }
    depth.set(id, maxDepDep + 1);
  }

  // Group by depth
  const waveMap = new Map<number, string[]>();
  for (const id of sorted) {
    const d = depth.get(id)!;
    const wave = waveMap.get(d);
    if (wave) {
      wave.push(id);
    } else {
      waveMap.set(d, [id]);
    }
  }

  // Convert to ordered array
  const maxDepth = Math.max(...waveMap.keys());
  const waves: string[][] = [];
  for (let i = 0; i <= maxDepth; i++) {
    waves.push(waveMap.get(i) ?? []);
  }

  return waves;
}

/**
 * Compute the set of tasks that are ready to execute:
 * pending tasks whose dependencies are all done.
 */
export function computeReadySet(
  tasks: AtomicTask[],
  doneTaskIds: Set<string>,
): AtomicTask[] {
  return tasks.filter(
    (t) =>
      t.status === 'pending' &&
      t.dependencies.every((dep) => doneTaskIds.has(dep)),
  );
}

// ── Decomposition Prompt ────────────────────────────────────────────

export interface DecompositionInput {
  objective: string;
  constraints: string[];
  context?: string;
}

/**
 * Build the decomposition prompt for the planner agent.
 * Uses Plan-and-Execute + HTN style with strict JSON output format.
 */
export function buildDecompositionPrompt(input: DecompositionInput): string {
  const constraintsBlock =
    input.constraints.length > 0
      ? input.constraints.map((c) => `  - ${c}`).join('\n')
      : '  (none)';

  const contextBlock = input.context
    ? `\n<context>\n${input.context}\n</context>\n`
    : '';

  return `<planner_task>
<role>You are the planner of a Showrunner orchestration system. Your job is to decompose a complex objective into a hierarchical beat sheet that can be executed by specialized agents.</role>

<objective>${input.objective}</objective>

<constraints>
${constraintsBlock}
</constraints>
${contextBlock}
<instructions>
You must decompose the objective into exactly 4 hierarchical levels:

1. **Objective (root)**: The overall goal with measurable success criteria.
2. **Acts**: Exactly 3 acts following the narrative structure:
   - "setup": Foundation, scaffolding, prerequisites
   - "confrontation": Core implementation, the main work
   - "resolution": Integration, polish, verification
3. **Sequences**: Groups of related tasks within each act. Each act must have at least 1 sequence.
4. **Atomic Tasks**: The smallest executable units. Each sequence must have at least 1 task.

For each atomic task, you MUST provide ALL of these fields:
- **precondition**: What must be true before this task starts
- **action**: What the task does (the change to make)
- **postcondition**: What will be true after this task completes
- **verification**: How to verify the postcondition was achieved

Rules:
- Every task must have a verifiable state change. Do NOT create tasks without observable output.
- Dependencies between tasks form a DAG (no cycles). Only reference task IDs within this beat sheet.
- Mark tasks as "critical: true" if failure would block the entire project.
- Estimate effort as "small" (< 30 min agent work), "medium" (30-120 min), or "large" (> 120 min).
- All task statuses should be "pending".
- Use short, descriptive IDs like "task-setup-1", "task-impl-auth", etc.
- Sequence IDs like "seq-setup-1", "seq-impl-core", etc.
- Act IDs: "act-setup", "act-confrontation", "act-resolution".
</instructions>

<output_format>
Return ONLY a valid JSON object matching this exact schema. No markdown, no explanation, just JSON:

{
  "id": "beatsheet-<short-slug>",
  "objective": "<restate the objective clearly>",
  "successCriteria": ["<criterion 1>", "<criterion 2>"],
  "constraints": ["<constraint 1>"],
  "acts": [
    {
      "id": "act-setup",
      "type": "setup",
      "name": "<descriptive name>",
      "objective": "<act-level goal>",
      "sequences": [
        {
          "id": "seq-setup-1",
          "actId": "act-setup",
          "name": "<sequence name>",
          "objective": "<sequence-level goal>",
          "tasks": [
            {
              "id": "task-setup-1",
              "actId": "act-setup",
              "sequenceId": "seq-setup-1",
              "title": "<short task title>",
              "precondition": "<what must be true before>",
              "action": "<what to do>",
              "postcondition": "<what will be true after>",
              "verification": "<how to verify>",
              "dependencies": [],
              "critical": false,
              "estimatedEffort": "small",
              "status": "pending"
            }
          ]
        }
      ]
    }
  ],
  "checkpoints": {
    "catalyst": "pending",
    "midpoint": "pending",
    "allIsLost": "pending",
    "breakIntoThree": "pending",
    "finalImage": "pending"
  },
  "version": 1,
  "createdAt": "<ISO8601>",
  "updatedAt": "<ISO8601>"
}
</output_format>
</planner_task>`;
}

/**
 * Parse the planner agent's JSON response into a BeatSheet.
 * Handles common issues: markdown code fences, trailing commas.
 */
export function parsePlannerResponse(raw: string): BeatSheet {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Remove trailing commas before closing brackets/braces (common LLM mistake)
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Failed to parse planner response as JSON: ${(e as Error).message}`,
    );
  }

  const normalized = normalizeBeatSheet(parsed as Record<string, unknown>);
  assertValidBeatSheet(normalized);

  return normalized;
}
