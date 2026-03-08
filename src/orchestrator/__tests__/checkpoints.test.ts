import { describe, it, expect } from 'vitest';
import {
  evaluateCheckpoint,
  evaluateAllCheckpoints,
  applyCheckpointResults,
  getCurrentCheckpoint,
  checkpointProgressPct,
} from '../checkpoints.js';
import type { BeatSheet, AtomicTask, CheckpointState } from '../beatsheet.js';

// ── Fixtures ────────────────────────────────────────────────────────

function makeTask(overrides: Partial<AtomicTask> = {}): AtomicTask {
  return {
    id: 'task-1',
    actId: 'act-setup',
    sequenceId: 'seq-1',
    title: 'Test task',
    precondition: 'pre',
    action: 'act',
    postcondition: 'post',
    verification: 'verify',
    dependencies: [],
    critical: false,
    estimatedEffort: 'small',
    status: 'pending',
    ...overrides,
  };
}

function makeSheet(overrides: Partial<BeatSheet> = {}): BeatSheet {
  return {
    id: 'test',
    objective: 'Test objective',
    successCriteria: ['Tests pass'],
    constraints: [],
    acts: [
      {
        id: 'act-setup',
        type: 'setup',
        name: 'Setup',
        objective: 'Setup',
        sequences: [
          {
            id: 'seq-1',
            actId: 'act-setup',
            name: 'Init',
            objective: 'Init',
            tasks: [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })],
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

// ── Catalyst Tests ──────────────────────────────────────────────────

describe('evaluateCheckpoint - catalyst', () => {
  it('passes when sheet has objective, criteria, acts, sequences, tasks', () => {
    const result = evaluateCheckpoint('catalyst', makeSheet());
    expect(result.result).toBe('passed');
    expect(result.evidence.every((e) => e.passed)).toBe(true);
  });

  it('fails when objective is empty', () => {
    const result = evaluateCheckpoint(
      'catalyst',
      makeSheet({ objective: '' }),
    );
    expect(result.result).toBe('failed');
  });

  it('fails when no success criteria', () => {
    const result = evaluateCheckpoint(
      'catalyst',
      makeSheet({ successCriteria: [] }),
    );
    expect(result.result).toBe('failed');
  });

  it('fails when act has no sequences', () => {
    const sheet = makeSheet();
    sheet.acts[0]!.sequences = [];
    const result = evaluateCheckpoint('catalyst', sheet);
    expect(result.result).toBe('failed');
  });
});

// ── Midpoint Tests ──────────────────────────────────────────────────

describe('evaluateCheckpoint - midpoint', () => {
  it('passes when >= 50% tasks done and no critical blocked', () => {
    const sheet = makeSheet();
    sheet.acts[0]!.sequences[0]!.tasks[0]!.status = 'done';
    const result = evaluateCheckpoint('midpoint', sheet);
    expect(result.result).toBe('passed');
  });

  it('fails when < 50% tasks done', () => {
    const sheet = makeSheet();
    // 0 out of 2 done
    const result = evaluateCheckpoint('midpoint', sheet);
    expect(result.result).toBe('failed');
  });

  it('fails when critical task is blocked', () => {
    const sheet = makeSheet();
    sheet.acts[0]!.sequences[0]!.tasks = [
      makeTask({ id: 'done-1', status: 'done' }),
      makeTask({ id: 'blocked-1', status: 'blocked', critical: true }),
    ];
    const result = evaluateCheckpoint('midpoint', sheet);
    expect(result.result).toBe('failed');
  });
});

// ── All Is Lost Tests ───────────────────────────────────────────────

describe('evaluateCheckpoint - allIsLost', () => {
  it('passes with >= 75% progress, risk, and contingency', () => {
    const sheet = makeSheet();
    const tasks = sheet.acts[0]!.sequences[0]!.tasks;
    tasks.length = 0;
    for (let i = 0; i < 4; i++) {
      tasks.push(makeTask({ id: `t-${i}`, status: i < 3 ? 'done' : 'running' }));
    }
    const result = evaluateCheckpoint('allIsLost', sheet, {
      majorRisk: 'Context degradation',
      contingencyPlan: 'Compact at checkpoints',
    });
    expect(result.result).toBe('passed');
  });

  it('fails without major risk', () => {
    const sheet = makeSheet();
    sheet.acts[0]!.sequences[0]!.tasks = [
      makeTask({ id: 't-1', status: 'done' }),
    ];
    const result = evaluateCheckpoint('allIsLost', sheet, {});
    expect(result.result).toBe('failed');
  });

  it('fails without contingency plan', () => {
    const sheet = makeSheet();
    sheet.acts[0]!.sequences[0]!.tasks = [
      makeTask({ id: 't-1', status: 'done' }),
    ];
    const result = evaluateCheckpoint('allIsLost', sheet, {
      majorRisk: 'Risk exists',
    });
    expect(result.result).toBe('failed');
  });
});

// ── Break Into Three Tests ──────────────────────────────────────────

describe('evaluateCheckpoint - breakIntoThree', () => {
  it('passes when DAG revised and strategy adjusted', () => {
    const result = evaluateCheckpoint('breakIntoThree', makeSheet({ version: 2 }), {
      dagRevised: true,
      strategyAdjusted: true,
    });
    expect(result.result).toBe('passed');
  });

  it('fails when DAG not revised', () => {
    const result = evaluateCheckpoint('breakIntoThree', makeSheet(), {
      dagRevised: false,
      strategyAdjusted: true,
    });
    expect(result.result).toBe('failed');
  });
});

// ── Final Image Tests ───────────────────────────────────────────────

describe('evaluateCheckpoint - finalImage', () => {
  it('passes when all tasks resolved and all checkpoints passed', () => {
    const sheet = makeSheet({
      checkpoints: {
        catalyst: 'passed',
        midpoint: 'passed',
        allIsLost: 'passed',
        breakIntoThree: 'passed',
        finalImage: 'pending',
      },
    });
    sheet.acts[0]!.sequences[0]!.tasks = [
      makeTask({ id: 't-1', status: 'done' }),
      makeTask({ id: 't-2', status: 'done' }),
    ];
    const result = evaluateCheckpoint('finalImage', sheet);
    expect(result.result).toBe('passed');
  });

  it('fails when tasks still pending', () => {
    const sheet = makeSheet({
      checkpoints: {
        catalyst: 'passed',
        midpoint: 'passed',
        allIsLost: 'passed',
        breakIntoThree: 'passed',
        finalImage: 'pending',
      },
    });
    // Default tasks are pending
    const result = evaluateCheckpoint('finalImage', sheet);
    expect(result.result).toBe('failed');
  });

  it('fails when previous checkpoints not passed', () => {
    const sheet = makeSheet();
    sheet.acts[0]!.sequences[0]!.tasks = [
      makeTask({ id: 't-1', status: 'done' }),
      makeTask({ id: 't-2', status: 'done' }),
    ];
    const result = evaluateCheckpoint('finalImage', sheet);
    expect(result.result).toBe('failed');
  });

  it('accepts failed tasks as resolved', () => {
    const sheet = makeSheet({
      checkpoints: {
        catalyst: 'passed',
        midpoint: 'passed',
        allIsLost: 'passed',
        breakIntoThree: 'passed',
        finalImage: 'pending',
      },
    });
    sheet.acts[0]!.sequences[0]!.tasks = [
      makeTask({ id: 't-1', status: 'done' }),
      makeTask({ id: 't-2', status: 'failed' }),
    ];
    const result = evaluateCheckpoint('finalImage', sheet);
    expect(result.result).toBe('passed');
  });
});

// ── evaluateAllCheckpoints Tests ────────────────────────────────────

describe('evaluateAllCheckpoints', () => {
  it('evaluates all checkpoints in order', () => {
    const results = evaluateAllCheckpoints(makeSheet());
    expect(results).toHaveLength(5);
    expect(results[0]!.name).toBe('catalyst');
    expect(results[4]!.name).toBe('finalImage');
  });

  it('marks remaining checkpoints as pending after a failure', () => {
    const sheet = makeSheet({ objective: '' }); // catalyst will fail
    const results = evaluateAllCheckpoints(sheet);
    expect(results[0]!.result).toBe('failed');
    expect(results[1]!.result).toBe('pending');
    expect(results[2]!.result).toBe('pending');
    expect(results[3]!.result).toBe('pending');
    expect(results[4]!.result).toBe('pending');
  });
});

// ── applyCheckpointResults Tests ────────────────────────────────────

describe('applyCheckpointResults', () => {
  it('converts evaluations to checkpoint state', () => {
    const evaluations = evaluateAllCheckpoints(makeSheet());
    const state = applyCheckpointResults(evaluations);
    expect(state.catalyst).toBe('passed');
    // Midpoint will fail because 0% tasks done
    expect(state.midpoint).toBe('failed');
  });
});

// ── getCurrentCheckpoint Tests ──────────────────────────────────────

describe('getCurrentCheckpoint', () => {
  it('returns first non-passed checkpoint', () => {
    const state: CheckpointState = {
      catalyst: 'passed',
      midpoint: 'pending',
      allIsLost: 'pending',
      breakIntoThree: 'pending',
      finalImage: 'pending',
    };
    expect(getCurrentCheckpoint(state)).toBe('midpoint');
  });

  it('returns null when all passed', () => {
    const state: CheckpointState = {
      catalyst: 'passed',
      midpoint: 'passed',
      allIsLost: 'passed',
      breakIntoThree: 'passed',
      finalImage: 'passed',
    };
    expect(getCurrentCheckpoint(state)).toBeNull();
  });

  it('returns catalyst when nothing passed', () => {
    const state: CheckpointState = {
      catalyst: 'pending',
      midpoint: 'pending',
      allIsLost: 'pending',
      breakIntoThree: 'pending',
      finalImage: 'pending',
    };
    expect(getCurrentCheckpoint(state)).toBe('catalyst');
  });
});

// ── checkpointProgressPct Tests ─────────────────────────────────────

describe('checkpointProgressPct', () => {
  it('returns 0 when nothing passed', () => {
    const state: CheckpointState = {
      catalyst: 'pending',
      midpoint: 'pending',
      allIsLost: 'pending',
      breakIntoThree: 'pending',
      finalImage: 'pending',
    };
    expect(checkpointProgressPct(state)).toBe(0);
  });

  it('returns 10 after catalyst', () => {
    const state: CheckpointState = {
      catalyst: 'passed',
      midpoint: 'pending',
      allIsLost: 'pending',
      breakIntoThree: 'pending',
      finalImage: 'pending',
    };
    expect(checkpointProgressPct(state)).toBe(10);
  });

  it('returns 50 after midpoint', () => {
    const state: CheckpointState = {
      catalyst: 'passed',
      midpoint: 'passed',
      allIsLost: 'pending',
      breakIntoThree: 'pending',
      finalImage: 'pending',
    };
    expect(checkpointProgressPct(state)).toBe(50);
  });

  it('returns 100 when all passed', () => {
    const state: CheckpointState = {
      catalyst: 'passed',
      midpoint: 'passed',
      allIsLost: 'passed',
      breakIntoThree: 'passed',
      finalImage: 'passed',
    };
    expect(checkpointProgressPct(state)).toBe(100);
  });
});
