import { describe, it, expect } from 'vitest';
import {
  validateBeatSheet,
  assertValidBeatSheet,
  normalizeBeatSheet,
  BeatSheetValidationError,
  collectTasks,
  detectCycle,
  topologicalSort,
  computeWaves,
  computeReadySet,
  CycleDetectedError,
  buildDecompositionPrompt,
  parsePlannerResponse,
} from '../beatsheet.js';
import type { BeatSheet, AtomicTask } from '../beatsheet.js';

// ── Test Fixtures ───────────────────────────────────────────────────

function makeTask(overrides: Partial<AtomicTask> = {}): AtomicTask {
  return {
    id: 'task-1',
    actId: 'act-setup',
    sequenceId: 'seq-1',
    title: 'Test task',
    precondition: 'Nothing exists',
    action: 'Create something',
    postcondition: 'Something exists',
    verification: 'Check file exists',
    dependencies: [],
    critical: false,
    estimatedEffort: 'small',
    status: 'pending',
    ...overrides,
  };
}

function makeValidSheet(overrides: Partial<BeatSheet> = {}): BeatSheet {
  return {
    id: 'beatsheet-test',
    objective: 'Build a test feature',
    successCriteria: ['All tests pass', 'Feature works'],
    constraints: ['Use TypeScript'],
    acts: [
      {
        id: 'act-setup',
        type: 'setup',
        name: 'Setup',
        objective: 'Set up foundation',
        sequences: [
          {
            id: 'seq-1',
            actId: 'act-setup',
            name: 'Init',
            objective: 'Initialize project',
            tasks: [
              makeTask({ id: 'task-1', title: 'Create config' }),
              makeTask({
                id: 'task-2',
                title: 'Install deps',
                dependencies: ['task-1'],
              }),
            ],
          },
        ],
      },
      {
        id: 'act-confrontation',
        type: 'confrontation',
        name: 'Implementation',
        objective: 'Build the core',
        sequences: [
          {
            id: 'seq-2',
            actId: 'act-confrontation',
            name: 'Core',
            objective: 'Core implementation',
            tasks: [
              makeTask({
                id: 'task-3',
                actId: 'act-confrontation',
                sequenceId: 'seq-2',
                title: 'Implement feature',
                dependencies: ['task-2'],
                critical: true,
              }),
            ],
          },
        ],
      },
      {
        id: 'act-resolution',
        type: 'resolution',
        name: 'Resolution',
        objective: 'Wrap up',
        sequences: [
          {
            id: 'seq-3',
            actId: 'act-resolution',
            name: 'Testing',
            objective: 'Verify everything',
            tasks: [
              makeTask({
                id: 'task-4',
                actId: 'act-resolution',
                sequenceId: 'seq-3',
                title: 'Run tests',
                dependencies: ['task-3'],
              }),
            ],
          },
        ],
      },
    ],
    checkpoints: {
      catalyst: 'pending',
      midpoint: 'pending',
      allIsLost: 'pending',
      breakIntoThree: 'pending',
      finalImage: 'pending',
    },
    version: 1,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Validation Tests ────────────────────────────────────────────────

describe('validateBeatSheet', () => {
  it('accepts a valid beat sheet', () => {
    const result = validateBeatSheet(makeValidSheet());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null input', () => {
    const result = validateBeatSheet(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Input must be a non-null object');
  });

  it('rejects non-object input', () => {
    const result = validateBeatSheet('not an object');
    expect(result.valid).toBe(false);
  });

  it('rejects missing id', () => {
    const sheet = makeValidSheet();
    (sheet as unknown as Record<string, unknown>)['id'] = '';
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('id:'))).toBe(true);
  });

  it('rejects missing objective', () => {
    const sheet = makeValidSheet();
    (sheet as unknown as Record<string, unknown>)['objective'] = '';
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('objective:'))).toBe(true);
  });

  it('rejects empty successCriteria', () => {
    const result = validateBeatSheet(makeValidSheet({ successCriteria: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('successCriteria:'))).toBe(true);
  });

  it('rejects invalid version', () => {
    const result = validateBeatSheet(makeValidSheet({ version: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('version:'))).toBe(true);
  });

  it('rejects sheet with no acts', () => {
    const result = validateBeatSheet(makeValidSheet({ acts: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('acts:'))).toBe(true);
  });

  it('rejects invalid act type', () => {
    const sheet = makeValidSheet();
    (sheet.acts[0] as unknown as Record<string, unknown>)['type'] = 'invalid';
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('.type:'))).toBe(true);
  });

  it('rejects sequence with no tasks', () => {
    const sheet = makeValidSheet();
    sheet.acts[0]!.sequences[0]!.tasks = [];
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('.tasks:'))).toBe(true);
  });

  it('rejects task without precondition', () => {
    const sheet = makeValidSheet();
    (sheet.acts[0]!.sequences[0]!.tasks[0] as unknown as Record<string, unknown>)['precondition'] = '';
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('.precondition:'))).toBe(true);
  });

  it('rejects task without postcondition', () => {
    const sheet = makeValidSheet();
    (sheet.acts[0]!.sequences[0]!.tasks[0] as unknown as Record<string, unknown>)['postcondition'] = '';
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
  });

  it('rejects task without verification', () => {
    const sheet = makeValidSheet();
    (sheet.acts[0]!.sequences[0]!.tasks[0] as unknown as Record<string, unknown>)['verification'] = '';
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
  });

  it('rejects duplicate task IDs', () => {
    const sheet = makeValidSheet();
    sheet.acts[0]!.sequences[0]!.tasks.push(
      makeTask({ id: 'task-1', title: 'Duplicate' }),
    );
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate task id'))).toBe(true);
  });

  it('rejects duplicate node IDs across levels', () => {
    const sheet = makeValidSheet();
    (sheet.acts[0]!.sequences[0] as unknown as Record<string, unknown>)['id'] = 'act-setup'; // conflicts with act ID
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate id'))).toBe(true);
  });

  it('rejects unknown dependency reference', () => {
    const sheet = makeValidSheet();
    sheet.acts[0]!.sequences[0]!.tasks[0]!.dependencies = ['nonexistent'];
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('references unknown task'))).toBe(true);
  });

  it('rejects self-dependency', () => {
    const sheet = makeValidSheet();
    sheet.acts[0]!.sequences[0]!.tasks[0]!.dependencies = ['task-1'];
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('self-dependency'))).toBe(true);
  });

  it('rejects missing checkpoints', () => {
    const sheet = makeValidSheet();
    (sheet as unknown as Record<string, unknown>)['checkpoints'] = undefined;
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('checkpoints:'))).toBe(true);
  });

  it('rejects invalid checkpoint value', () => {
    const sheet = makeValidSheet();
    (sheet.checkpoints as unknown as Record<string, unknown>)['catalyst'] = 'invalid';
    const result = validateBeatSheet(sheet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('checkpoints.catalyst:'))).toBe(true);
  });
});

describe('assertValidBeatSheet', () => {
  it('does not throw for valid sheet', () => {
    expect(() => assertValidBeatSheet(makeValidSheet())).not.toThrow();
  });

  it('throws BeatSheetValidationError for invalid sheet', () => {
    expect(() => assertValidBeatSheet(null)).toThrow(BeatSheetValidationError);
  });

  it('includes all errors in the exception', () => {
    try {
      assertValidBeatSheet({});
    } catch (e) {
      expect(e).toBeInstanceOf(BeatSheetValidationError);
      expect((e as BeatSheetValidationError).errors.length).toBeGreaterThan(0);
    }
  });
});

// ── Normalization Tests ─────────────────────────────────────────────

describe('normalizeBeatSheet', () => {
  it('fills default checkpoints', () => {
    const raw: Record<string, unknown> = {
      ...makeValidSheet(),
    };
    delete raw['checkpoints'];
    const normalized = normalizeBeatSheet(raw);
    expect(normalized.checkpoints.catalyst).toBe('pending');
    expect(normalized.checkpoints.finalImage).toBe('pending');
  });

  it('fills default version', () => {
    const raw: Record<string, unknown> = { ...makeValidSheet() };
    delete raw['version'];
    const normalized = normalizeBeatSheet(raw);
    expect(normalized.version).toBe(1);
  });

  it('sets createdAt and updatedAt', () => {
    const raw: Record<string, unknown> = { ...makeValidSheet() };
    delete raw['createdAt'];
    delete raw['updatedAt'];
    const normalized = normalizeBeatSheet(raw);
    expect(normalized.createdAt).toBeTruthy();
    expect(normalized.updatedAt).toBeTruthy();
  });

  it('fills task defaults (dependencies, critical, effort, status)', () => {
    const raw = makeValidSheet();
    // Strip optional fields from first task
    const task = raw.acts[0]!.sequences[0]!.tasks[0]! as unknown as Record<string, unknown>;
    delete task['dependencies'];
    delete task['critical'];
    delete task['estimatedEffort'];
    delete task['status'];

    const normalized = normalizeBeatSheet(raw as unknown as Record<string, unknown>);
    const t = normalized.acts[0]!.sequences[0]!.tasks[0]!;
    expect(t.dependencies).toEqual([]);
    expect(t.critical).toBe(false);
    expect(t.estimatedEffort).toBe('medium');
    expect(t.status).toBe('pending');
  });

  it('sets actId and sequenceId on tasks', () => {
    const raw = makeValidSheet();
    const normalized = normalizeBeatSheet(raw as unknown as Record<string, unknown>);
    const t = normalized.acts[0]!.sequences[0]!.tasks[0]!;
    expect(t.actId).toBe('act-setup');
    expect(t.sequenceId).toBe('seq-1');
  });
});

// ── DAG Tests ───────────────────────────────────────────────────────

describe('collectTasks', () => {
  it('collects all tasks from all acts and sequences', () => {
    const sheet = makeValidSheet();
    const tasks = collectTasks(sheet);
    expect(tasks).toHaveLength(4);
    expect(tasks.map((t) => t.id)).toEqual(['task-1', 'task-2', 'task-3', 'task-4']);
  });
});

describe('detectCycle', () => {
  it('returns null for acyclic graph', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: [] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
      makeTask({ id: 'c', dependencies: ['b'] }),
    ];
    expect(detectCycle(tasks)).toBeNull();
  });

  it('detects simple cycle', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: ['b'] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
    ];
    const cycle = detectCycle(tasks);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
  });

  it('detects indirect cycle', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: ['c'] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
      makeTask({ id: 'c', dependencies: ['b'] }),
    ];
    const cycle = detectCycle(tasks);
    expect(cycle).not.toBeNull();
  });

  it('returns null for single node with no deps', () => {
    const tasks = [makeTask({ id: 'a', dependencies: [] })];
    expect(detectCycle(tasks)).toBeNull();
  });
});

describe('topologicalSort', () => {
  it('sorts simple linear chain', () => {
    const tasks = [
      makeTask({ id: 'c', dependencies: ['b'] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
      makeTask({ id: 'a', dependencies: [] }),
    ];
    const sorted = topologicalSort(tasks);
    expect(sorted).toEqual(['a', 'b', 'c']);
  });

  it('throws CycleDetectedError for cyclic graph', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: ['b'] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
    ];
    expect(() => topologicalSort(tasks)).toThrow(CycleDetectedError);
  });

  it('provides cycle path in error', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: ['b'] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
    ];
    try {
      topologicalSort(tasks);
    } catch (e) {
      expect((e as CycleDetectedError).cycle.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('is deterministic for same input', () => {
    const tasks = [
      makeTask({ id: 'c', dependencies: [] }),
      makeTask({ id: 'b', dependencies: [] }),
      makeTask({ id: 'a', dependencies: [] }),
    ];
    const sorted1 = topologicalSort(tasks);
    const sorted2 = topologicalSort(tasks);
    expect(sorted1).toEqual(sorted2);
  });

  it('prioritizes critical tasks', () => {
    const tasks = [
      makeTask({ id: 'regular', dependencies: [], critical: false }),
      makeTask({ id: 'critical', dependencies: [], critical: true }),
    ];
    const sorted = topologicalSort(tasks);
    expect(sorted[0]).toBe('critical');
  });

  it('prioritizes smaller effort when not critical', () => {
    const tasks = [
      makeTask({ id: 'large', dependencies: [], estimatedEffort: 'large' }),
      makeTask({ id: 'small', dependencies: [], estimatedEffort: 'small' }),
      makeTask({ id: 'medium', dependencies: [], estimatedEffort: 'medium' }),
    ];
    const sorted = topologicalSort(tasks);
    expect(sorted).toEqual(['small', 'medium', 'large']);
  });
});

describe('computeWaves', () => {
  it('groups independent tasks into wave 0', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: [] }),
      makeTask({ id: 'b', dependencies: [] }),
      makeTask({ id: 'c', dependencies: [] }),
    ];
    const waves = computeWaves(tasks);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(3);
  });

  it('creates sequential waves for chain', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: [] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
      makeTask({ id: 'c', dependencies: ['b'] }),
    ];
    const waves = computeWaves(tasks);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toEqual(['a']);
    expect(waves[1]).toEqual(['b']);
    expect(waves[2]).toEqual(['c']);
  });

  it('handles diamond dependency', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: [] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
      makeTask({ id: 'c', dependencies: ['a'] }),
      makeTask({ id: 'd', dependencies: ['b', 'c'] }),
    ];
    const waves = computeWaves(tasks);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toEqual(['a']);
    expect(waves[1]!.sort()).toEqual(['b', 'c']);
    expect(waves[2]).toEqual(['d']);
  });
});

describe('computeReadySet', () => {
  it('returns tasks with all deps satisfied', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'done', dependencies: [] }),
      makeTask({ id: 'b', status: 'pending', dependencies: ['a'] }),
      makeTask({ id: 'c', status: 'pending', dependencies: ['a', 'b'] }),
    ];
    const done = new Set(['a']);
    const ready = computeReadySet(tasks, done);
    expect(ready.map((t) => t.id)).toEqual(['b']);
  });

  it('returns empty when no tasks are pending', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'done', dependencies: [] }),
    ];
    const done = new Set(['a']);
    const ready = computeReadySet(tasks, done);
    expect(ready).toHaveLength(0);
  });

  it('returns all root tasks when nothing is done', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'pending', dependencies: [] }),
      makeTask({ id: 'b', status: 'pending', dependencies: [] }),
      makeTask({ id: 'c', status: 'pending', dependencies: ['a'] }),
    ];
    const ready = computeReadySet(tasks, new Set());
    expect(ready.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('excludes non-pending tasks', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'running', dependencies: [] }),
      makeTask({ id: 'b', status: 'blocked', dependencies: [] }),
    ];
    const ready = computeReadySet(tasks, new Set());
    expect(ready).toHaveLength(0);
  });
});

// ── Decomposition Prompt Tests ──────────────────────────────────────

describe('buildDecompositionPrompt', () => {
  it('includes the objective', () => {
    const prompt = buildDecompositionPrompt({
      objective: 'Build auth system',
      constraints: [],
    });
    expect(prompt).toContain('Build auth system');
  });

  it('includes constraints', () => {
    const prompt = buildDecompositionPrompt({
      objective: 'Build app',
      constraints: ['Use TypeScript', 'No external DB'],
    });
    expect(prompt).toContain('Use TypeScript');
    expect(prompt).toContain('No external DB');
  });

  it('includes context when provided', () => {
    const prompt = buildDecompositionPrompt({
      objective: 'Build app',
      constraints: [],
      context: 'Existing codebase uses React',
    });
    expect(prompt).toContain('Existing codebase uses React');
    expect(prompt).toContain('<context>');
  });

  it('omits context block when not provided', () => {
    const prompt = buildDecompositionPrompt({
      objective: 'Build app',
      constraints: [],
    });
    expect(prompt).not.toContain('<context>');
  });

  it('contains key instructions', () => {
    const prompt = buildDecompositionPrompt({
      objective: 'Test',
      constraints: [],
    });
    expect(prompt).toContain('precondition');
    expect(prompt).toContain('postcondition');
    expect(prompt).toContain('verification');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('3 acts');
  });
});

describe('parsePlannerResponse', () => {
  it('parses valid JSON response', () => {
    const sheet = makeValidSheet();
    const json = JSON.stringify(sheet);
    const result = parsePlannerResponse(json);
    expect(result.id).toBe('beatsheet-test');
    expect(result.objective).toBe('Build a test feature');
  });

  it('strips markdown code fences', () => {
    const sheet = makeValidSheet();
    const json = '```json\n' + JSON.stringify(sheet) + '\n```';
    const result = parsePlannerResponse(json);
    expect(result.id).toBe('beatsheet-test');
  });

  it('handles trailing commas', () => {
    const sheet = makeValidSheet();
    let json = JSON.stringify(sheet, null, 2);
    // Insert a trailing comma before the last closing brace
    json = json.replace(/\}\s*$/, ',\n}');
    const result = parsePlannerResponse(json);
    expect(result.id).toBe('beatsheet-test');
  });

  it('throws on invalid JSON', () => {
    expect(() => parsePlannerResponse('not json at all')).toThrow(
      'Failed to parse planner response as JSON',
    );
  });

  it('throws on structurally invalid sheet', () => {
    const json = JSON.stringify({ id: '', objective: '' });
    expect(() => parsePlannerResponse(json)).toThrow(BeatSheetValidationError);
  });
});
