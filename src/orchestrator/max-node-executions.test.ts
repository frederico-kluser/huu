import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import type { AgentFactory } from './types.js';
import type { Pipeline } from '../lib/types.js';

function setupRepo(dir: string): void {
  execSync('git init --initial-branch=main', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "t@t.com" && git config user.name "t"', {
    cwd: dir,
    shell: '/bin/bash',
  });
  writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.huu-worktrees/\n', 'utf8');
  execSync('git add -A && git commit -m init', { cwd: dir, encoding: 'utf8' });
}

/**
 * Stub factory where the check judge always chooses the 'rework' outcome,
 * creating an infinite loop that maxNodeExecutions must stop.
 */
function makeLoopingFactory(reworkOutcome: string): AgentFactory {
  let seq = 0;
  return async (task, _config, _hint, cwd, onEvent) => ({
    agentId: task.agentId,
    task,
    async prompt(_message: string): Promise<void> {
      onEvent({ type: 'state_change', state: 'streaming' });
      if (task.stageName.startsWith('check:')) {
        onEvent({
          type: 'log',
          message: JSON.stringify({ label: reworkOutcome, reason: 'keep looping' }),
        });
        onEvent({ type: 'done' });
        return;
      }
      const fileName = `w${(seq += 1)}_a${task.agentId}.txt`;
      writeFileSync(join(cwd, fileName), 'content\n', 'utf8');
      onEvent({ type: 'file_write', file: fileName });
      onEvent({ type: 'done' });
    },
    async abort(): Promise<void> {},
    async dispose(): Promise<void> {},
  });
}

describe('maxNodeExecutions', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'maxnode-'));
    setupRepo(scratch);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it(
    'linear cursor: status === error when maxNodeExecutions is exceeded by outcome loop',
    async () => {
      const pipeline: Pipeline = {
        name: 'maxnode-linear',
        steps: [
          { name: 'work1', prompt: 'do first pass', files: [] },
          {
            type: 'check',
            name: 'gate',
            condition: 'should we rework?',
            maxRuns: 5,
            outcomes: [
              { label: 'rework', nextStepName: 'work1' },
              { label: 'done', nextStepName: 'final', default: true },
            ],
          },
          { name: 'final', prompt: 'finalize', files: [] },
        ],
        maxNodeExecutions: 3,
      };

      // Judge always picks 'rework' → loops back to work1 forever.
      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        makeLoopingFactory('rework'),
        { initialConcurrency: 1, autoScale: false },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('error');
      expect(result.manifest.errorReason).toContain('maxNodeExecutions=3');
    },
    20_000,
  );

  it(
    'DAG waves: status === error when maxNodeExecutions is exceeded by activation loop',
    async () => {
      const pipeline: Pipeline = {
        name: 'maxnode-dag',
        steps: [
          { name: 'setup', prompt: 'init', files: [], scope: 'project', dependsOn: [] },
          {
            type: 'check',
            name: 'gate',
            condition: 'ready?',
            maxRuns: 5,
            outcomes: [
              { label: 'rework', nextStepName: 'setup' },
              { label: 'pass', nextStepName: 'final', default: true },
            ],
          },
          { name: 'final', prompt: 'ship', files: [], scope: 'project', dependsOn: ['gate'] },
        ],
        maxNodeExecutions: 3,
      };

      // Gate judge always picks 'rework' → activation edge re-pends
      // setup + its downstream cone (gate, final) every visit.
      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        makeLoopingFactory('rework'),
        { initialConcurrency: 1, autoScale: false },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('error');
      expect(result.manifest.errorReason).toContain('maxNodeExecutions=3');
    },
    20_000,
  );

  it(
    'succeeds when visits stay under maxNodeExecutions (counter-example)',
    async () => {
      const pipeline: Pipeline = {
        name: 'maxnode-ok',
        steps: [
          { name: 'work1', prompt: 'do work', files: [] },
          { name: 'work2', prompt: 'more work', files: [] },
        ],
        maxNodeExecutions: 10,
      };

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        makeLoopingFactory('done'),
        { initialConcurrency: 1, autoScale: false },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('done');
      // total visits = 2, well under maxNodeExecutions=10
    },
    20_000,
  );
});
