import { describe, it, expect } from 'vitest';
import { renderBeatSheet, renderBeatSheetSummary } from '../beatsheet-render.js';
import type { BeatSheet, AtomicTask } from '../beatsheet.js';

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

function makeSheet(): BeatSheet {
  return {
    id: 'beatsheet-test',
    objective: 'Build test feature',
    successCriteria: ['Tests pass', 'Feature works'],
    constraints: [],
    acts: [
      {
        id: 'act-setup',
        type: 'setup',
        name: 'Setup',
        objective: 'Foundation',
        sequences: [
          {
            id: 'seq-1',
            actId: 'act-setup',
            name: 'Init',
            objective: 'Initialize',
            tasks: [
              makeTask({ id: 'task-1', title: 'Create config', status: 'done' }),
              makeTask({
                id: 'task-2',
                title: 'Install deps',
                status: 'done',
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
        objective: 'Core',
        sequences: [
          {
            id: 'seq-2',
            actId: 'act-confrontation',
            name: 'Feature',
            objective: 'Build feature',
            tasks: [
              makeTask({
                id: 'task-3',
                actId: 'act-confrontation',
                sequenceId: 'seq-2',
                title: 'Implement auth',
                status: 'running',
                critical: true,
                dependencies: ['task-2'],
              }),
              makeTask({
                id: 'task-4',
                actId: 'act-confrontation',
                sequenceId: 'seq-2',
                title: 'Implement API',
                status: 'blocked',
                dependencies: ['task-3'],
              }),
            ],
          },
        ],
      },
      {
        id: 'act-resolution',
        type: 'resolution',
        name: 'Resolution',
        objective: 'Polish',
        sequences: [
          {
            id: 'seq-3',
            actId: 'act-resolution',
            name: 'Testing',
            objective: 'Verify',
            tasks: [
              makeTask({
                id: 'task-5',
                actId: 'act-resolution',
                sequenceId: 'seq-3',
                title: 'Run tests',
                status: 'pending',
                dependencies: ['task-3', 'task-4'],
              }),
            ],
          },
        ],
      },
    ],
    checkpoints: {
      catalyst: 'passed',
      midpoint: 'pending',
      allIsLost: 'pending',
      breakIntoThree: 'pending',
      finalImage: 'pending',
    },
    version: 1,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

// ── renderBeatSheet Tests ───────────────────────────────────────────

describe('renderBeatSheet', () => {
  it('renders objective header', () => {
    const output = renderBeatSheet(makeSheet());
    expect(output).toContain('Beat Sheet: Build test feature');
  });

  it('renders version and task summary', () => {
    const output = renderBeatSheet(makeSheet());
    expect(output).toContain('Version: 1');
    expect(output).toContain('2 done');
  });

  it('renders acts with status and counts', () => {
    const output = renderBeatSheet(makeSheet());
    expect(output).toContain('Act setup');
    expect(output).toContain('Act confrontation');
    expect(output).toContain('Act resolution');
    // Act setup should show done 2/2
    expect(output).toContain('done 2/2');
  });

  it('renders sequences with status', () => {
    const output = renderBeatSheet(makeSheet());
    expect(output).toContain('Sequence seq-1');
    expect(output).toContain('Sequence seq-2');
  });

  it('renders individual tasks with status labels', () => {
    const output = renderBeatSheet(makeSheet());
    expect(output).toContain('[done] task-1: Create config');
    expect(output).toContain('[running] task-3: Implement auth');
    expect(output).toContain('[BLOCKED] task-4: Implement API');
    expect(output).toContain('[pending] task-5: Run tests');
  });

  it('marks critical tasks', () => {
    const output = renderBeatSheet(makeSheet());
    expect(output).toContain('*critical*');
  });

  it('shows blocked dependency details', () => {
    const output = renderBeatSheet(makeSheet());
    expect(output).toContain('deps=[task-3]');
  });

  it('shows unmet deps for pending tasks', () => {
    const output = renderBeatSheet(makeSheet());
    // task-5 depends on task-3 and task-4, neither is done
    expect(output).toContain('deps=[task-3, task-4]');
  });

  it('renders checkpoints', () => {
    const output = renderBeatSheet(makeSheet());
    expect(output).toContain('Checkpoints:');
    expect(output).toContain('catalyst=passed');
    expect(output).toContain('midpoint=pending');
  });

  it('renders success criteria', () => {
    const output = renderBeatSheet(makeSheet());
    expect(output).toContain('Success Criteria:');
    expect(output).toContain('Tests pass');
    expect(output).toContain('Feature works');
  });

  it('hides tasks when showTasks=false', () => {
    const output = renderBeatSheet(makeSheet(), { showTasks: false });
    expect(output).not.toContain('[done] task-1');
    // But still shows sequences
    expect(output).toContain('Sequence seq-1');
  });

  it('truncates tasks when maxTasksPerSequence is set', () => {
    const output = renderBeatSheet(makeSheet(), { maxTasksPerSequence: 1 });
    expect(output).toContain('... and 1 more task(s)');
  });

  it('hides dep details when showBlockedDeps=false', () => {
    const output = renderBeatSheet(makeSheet(), { showBlockedDeps: false });
    expect(output).not.toContain('deps=');
  });

  it('is deterministic', () => {
    const sheet = makeSheet();
    const output1 = renderBeatSheet(sheet);
    const output2 = renderBeatSheet(sheet);
    expect(output1).toBe(output2);
  });
});

// ── renderBeatSheetSummary Tests ────────────────────────────────────

describe('renderBeatSheetSummary', () => {
  it('renders compact summary with done count', () => {
    const summary = renderBeatSheetSummary(makeSheet());
    expect(summary).toContain('[v1]');
    expect(summary).toContain('Build test feature');
    expect(summary).toContain('2/5 done');
  });

  it('includes running count', () => {
    const summary = renderBeatSheetSummary(makeSheet());
    expect(summary).toContain('1 running');
  });

  it('includes blocked count', () => {
    const summary = renderBeatSheetSummary(makeSheet());
    expect(summary).toContain('1 blocked');
  });

  it('shows percentage', () => {
    const summary = renderBeatSheetSummary(makeSheet());
    expect(summary).toContain('40%');
  });
});
