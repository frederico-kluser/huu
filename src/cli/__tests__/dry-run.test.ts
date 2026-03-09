import { describe, it, expect } from 'vitest';
import {
  renderDryRunPreview,
  renderDryRunJson,
} from '../formatting/dry-run.js';
import type { BeatSheet } from '../../orchestrator/beatsheet.js';

function createTestBeatSheet(): BeatSheet {
  return {
    id: 'beatsheet-test',
    objective: 'Build a test feature',
    successCriteria: ['Tests pass', 'Feature works'],
    constraints: ['No breaking changes'],
    acts: [
      {
        id: 'act-setup',
        type: 'setup',
        name: 'Setup',
        objective: 'Prepare foundation',
        sequences: [
          {
            id: 'seq-setup-1',
            actId: 'act-setup',
            name: 'Scaffolding',
            objective: 'Create project structure',
            tasks: [
              {
                id: 'task-1',
                actId: 'act-setup',
                sequenceId: 'seq-setup-1',
                title: 'Create directory structure',
                precondition: 'Empty project',
                action: 'Create src/ and test/ directories',
                postcondition: 'Directories exist',
                verification: 'Directories are on disk',
                dependencies: [],
                critical: true,
                estimatedEffort: 'small',
                status: 'pending',
              },
            ],
          },
        ],
      },
      {
        id: 'act-confrontation',
        type: 'confrontation',
        name: 'Implementation',
        objective: 'Build the core feature',
        sequences: [
          {
            id: 'seq-impl-1',
            actId: 'act-confrontation',
            name: 'Core Logic',
            objective: 'Implement main functionality',
            tasks: [
              {
                id: 'task-2',
                actId: 'act-confrontation',
                sequenceId: 'seq-impl-1',
                title: 'Write core module',
                precondition: 'Directory structure exists',
                action: 'Implement the main feature logic',
                postcondition: 'Module exports work',
                verification: 'Unit tests pass',
                dependencies: ['task-1'],
                critical: true,
                estimatedEffort: 'medium',
                status: 'pending',
              },
              {
                id: 'task-3',
                actId: 'act-confrontation',
                sequenceId: 'seq-impl-1',
                title: 'Write tests for core module',
                precondition: 'Core module exists',
                action: 'Write test suite with full coverage',
                postcondition: 'Test suite passes',
                verification: 'Run test command',
                dependencies: ['task-2'],
                critical: false,
                estimatedEffort: 'small',
                status: 'pending',
              },
            ],
          },
        ],
      },
      {
        id: 'act-resolution',
        type: 'resolution',
        name: 'Polish',
        objective: 'Final integration and documentation',
        sequences: [
          {
            id: 'seq-polish-1',
            actId: 'act-resolution',
            name: 'Documentation',
            objective: 'Write documentation',
            tasks: [
              {
                id: 'task-4',
                actId: 'act-resolution',
                sequenceId: 'seq-polish-1',
                title: 'Write documentation for the module',
                precondition: 'Module and tests complete',
                action: 'Write doc comments and usage docs',
                postcondition: 'Documentation exists',
                verification: 'Doc files present',
                dependencies: ['task-3'],
                critical: false,
                estimatedEffort: 'small',
                status: 'pending',
              },
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
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('renderDryRunPreview', () => {
  it('should render a human-readable preview', () => {
    const sheet = createTestBeatSheet();
    const output = renderDryRunPreview(sheet);

    expect(output).toContain('DRY-RUN PREVIEW');
    expect(output).toContain('Build a test feature');
    expect(output).toContain('Tests pass');
    expect(output).toContain('No breaking changes');
    expect(output).toContain('No side effects executed');
  });

  it('should show all acts', () => {
    const sheet = createTestBeatSheet();
    const output = renderDryRunPreview(sheet);

    expect(output).toContain('Setup');
    expect(output).toContain('Implementation');
    expect(output).toContain('Polish');
  });

  it('should show task details', () => {
    const sheet = createTestBeatSheet();
    const output = renderDryRunPreview(sheet);

    expect(output).toContain('task-1');
    expect(output).toContain('task-2');
    expect(output).toContain('CRITICAL');
  });

  it('should show parallel execution waves', () => {
    const sheet = createTestBeatSheet();
    const output = renderDryRunPreview(sheet);

    expect(output).toContain('Wave');
    expect(output).toContain('Total Tasks');
  });
});

describe('renderDryRunJson', () => {
  it('should produce structured JSON output', () => {
    const sheet = createTestBeatSheet();
    const json = renderDryRunJson(sheet);

    expect(json.objective).toBe('Build a test feature');
    expect(json.successCriteria).toHaveLength(2);
    expect(json.acts).toHaveLength(3);
    expect(json.stats.totalTasks).toBe(4);
    expect(json.stats.criticalTasks).toBe(2);
  });

  it('should compute wave information', () => {
    const sheet = createTestBeatSheet();
    const json = renderDryRunJson(sheet);

    expect(json.waves.length).toBeGreaterThan(0);
    expect(json.stats.totalWaves).toBeGreaterThan(0);
    expect(json.stats.maxParallelism).toBeGreaterThanOrEqual(1);
  });

  it('should assign candidate agents', () => {
    const sheet = createTestBeatSheet();
    const json = renderDryRunJson(sheet);

    const tasks = json.acts.flatMap((a) =>
      a.sequences.flatMap((s) => s.tasks),
    );
    for (const task of tasks) {
      expect(task.candidateAgent).toBeTruthy();
    }

    // task-3 has "test" in the action, should be tester
    const testTask = tasks.find((t) => t.id === 'task-3');
    expect(testTask?.candidateAgent).toBe('tester');
  });
});
