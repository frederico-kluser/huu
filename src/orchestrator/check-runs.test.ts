import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
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

/** Work agents write a unique file; judge invocations emit `verdict` (if any). */
function makeFactory(verdict?: { label: string; reason: string }): AgentFactory {
  let seq = 0;
  return async (task, _config, _hint, cwd, onEvent) => ({
    agentId: task.agentId,
    task,
    async prompt(_message: string): Promise<void> {
      onEvent({ type: 'state_change', state: 'streaming' });
      if (task.stageName.startsWith('check:')) {
        if (verdict) {
          onEvent({ type: 'log', message: JSON.stringify(verdict) });
        }
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

describe('check-run judge cards', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'check-runs-'));
    setupRepo(scratch);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it(
    'records one judging→done card with the default outcome when the judge emits no verdict',
    async () => {
      const pipeline: Pipeline = {
        name: 'check-cards',
        steps: [
          { name: 'work1', prompt: 'w1', files: [] },
          {
            type: 'check',
            name: 'gate',
            condition: 'all good after run $runs?',
            maxRuns: 2,
            outcomes: [
              { label: 'approved', nextStepName: 'final', default: true },
              { label: 'rework', nextStepName: 'work1' },
            ],
          },
          { name: 'final', prompt: 'w2', files: [] },
        ],
      };

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        makeFactory(),
        { initialConcurrency: 1, autoScale: false },
      );

      const phasesSeen = new Set<string>();
      orch.subscribe((state) => {
        for (const c of state.checkRuns) phasesSeen.add(c.phase);
      });

      const result = await orch.start();

      expect(result.manifest.status).toBe('done');
      // The judge card was observable mid-run (DOING column) and finished.
      expect(phasesSeen.has('judging')).toBe(true);
      expect(phasesSeen.has('done')).toBe(true);

      const checkRuns = result.manifest.checkRuns!;
      expect(checkRuns).toHaveLength(1);
      const entry = checkRuns[0]!;
      expect(entry.stepName).toBe('gate');
      expect(entry.runs).toBe(1);
      expect(entry.maxRuns).toBe(2);
      expect(entry.phase).toBe('done');
      expect(entry.outcomeLabel).toBe('approved');
      expect(entry.nextStepName).toBe('final');
      expect(entry.fromJudge).toBe(false);
      expect(entry.modelId).toBe('stub-model');
      // $runs got substituted into the condition the judge actually saw.
      expect(entry.condition).toContain('run 1');
      expect(entry.startedAt).toBeGreaterThan(0);
      expect(entry.finishedAt).toBeGreaterThanOrEqual(entry.startedAt);
    },
    20_000,
  );

  it(
    'loops create one card per visit, with a fromJudge=false card when maxRuns trips',
    async () => {
      const pipeline: Pipeline = {
        name: 'check-loop',
        steps: [
          { name: 'work1', prompt: 'w1', files: [] },
          {
            type: 'check',
            name: 'gate',
            condition: 'good enough?',
            maxRuns: 2,
            outcomes: [
              { label: 'approved', nextStepName: 'final', default: true },
              { label: 'rework', nextStepName: 'work1' },
            ],
          },
          { name: 'final', prompt: 'w2', files: [] },
        ],
      };

      // Judge always demands rework — visits 1 and 2 loop back; visit 3
      // exceeds maxRuns=2 and forces the default outcome (approved).
      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        makeFactory({ label: 'rework', reason: 'not there yet' }),
        { initialConcurrency: 1, autoScale: false },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('done');
      const checkRuns = result.manifest.checkRuns!;
      expect(checkRuns).toHaveLength(3);

      expect(checkRuns[0]!.runs).toBe(1);
      expect(checkRuns[0]!.outcomeLabel).toBe('rework');
      expect(checkRuns[0]!.fromJudge).toBe(true);
      expect(checkRuns[0]!.reason).toBe('not there yet');

      expect(checkRuns[1]!.runs).toBe(2);
      expect(checkRuns[1]!.outcomeLabel).toBe('rework');
      expect(checkRuns[1]!.fromJudge).toBe(true);

      // maxRuns trip: forced default, visible as its own DONE card.
      expect(checkRuns[2]!.runs).toBe(3);
      expect(checkRuns[2]!.phase).toBe('done');
      expect(checkRuns[2]!.outcomeLabel).toBe('approved');
      expect(checkRuns[2]!.fromJudge).toBe(false);
      expect(checkRuns[2]!.reason).toContain('maxRuns=2');

      // Every entry has a unique visitIndex (loops never collide).
      const visits = new Set(checkRuns.map((c) => c.visitIndex));
      expect(visits.size).toBe(3);
    },
    20_000,
  );
});
