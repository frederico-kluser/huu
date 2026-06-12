import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
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

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * Stub factory for DAG runs. Work agents drop a marker file named after
 * their step and record what markers they could SEE in their worktree
 * (proves join steps observe both branches' merges). The judge (agent 9998)
 * emits scripted verdicts via log events — the same channel the real
 * evaluator parses.
 */
function makeDagFactory(opts: { verdicts?: string[] }): {
  factory: AgentFactory;
  seenByStep: Map<string, string[]>;
} {
  const seenByStep = new Map<string, string[]>();
  let judgeCalls = 0;
  const factory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
    agentId: task.agentId,
    task,
    async prompt(): Promise<void> {
      onEvent({ type: 'state_change', state: 'streaming' });
      if (task.agentId === 9998) {
        const verdict = opts.verdicts?.[judgeCalls] ?? 'done';
        judgeCalls += 1;
        onEvent({ type: 'log', message: JSON.stringify({ label: verdict, reason: 'scripted' }) });
        onEvent({ type: 'done' });
        return;
      }
      const seen = ['setup', 'lint', 'security', 'a', 'b'].filter((m) =>
        existsSync(join(cwd, `${m}.txt`)),
      );
      seenByStep.set(task.stageName, seen);
      const marker = `${slug(task.stageName)}.txt`;
      writeFileSync(join(cwd, marker), `run\n`, 'utf8');
      onEvent({ type: 'file_write', file: marker });
      onEvent({ type: 'done' });
    },
    async abort(): Promise<void> {},
    async dispose(): Promise<void> {},
  });
  return { factory, seenByStep };
}

function diamond(): Pipeline {
  return {
    name: 'diamond',
    steps: [
      { type: 'work', name: 'setup', prompt: 'p', files: [], scope: 'project', dependsOn: [] },
      { type: 'work', name: 'lint', prompt: 'p', files: [], scope: 'project', dependsOn: ['setup'] },
      { type: 'work', name: 'security', prompt: 'p', files: [], scope: 'project', dependsOn: ['setup'] },
      { type: 'work', name: 'join', prompt: 'p', files: [], scope: 'project', dependsOn: ['lint', 'security'] },
    ],
  };
}

async function runOnce(pipeline: Pipeline, opts: { verdicts?: string[] } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'dag-test-'));
  setupRepo(scratch);
  const { factory, seenByStep } = makeDagFactory(opts);
  const orch = new Orchestrator(
    { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
    pipeline,
    scratch,
    factory,
    { initialConcurrency: 4, autoScale: false },
  );
  let maxWave = 0;
  orch.subscribe((s) => {
    if (typeof s.wave === 'number' && s.wave > maxWave) maxWave = s.wave;
  });
  const result = await orch.start();
  try {
    execSync(`rm -rf "${scratch}"`, { encoding: 'utf8' });
  } catch {
    /* best effort */
  }
  return { result, seenByStep, maxWave };
}

describe('DAG waves (dependsOn fork/join)', () => {
  let noop: string;
  beforeEach(() => {
    noop = '';
  });
  afterEach(() => {
    void noop;
  });

  it(
    'runs the diamond in 3 deterministic waves and the join sees BOTH branches',
    async () => {
      const { result, seenByStep, maxWave } = await runOnce(diamond());

      expect(result.manifest.status).toBe('done');
      const traceNames = result.manifest.executionTrace!.map((t) => t.stepName);
      // Wave 1: setup · wave 2: lint+security (array order) · wave 3: join.
      expect(traceNames).toEqual(['setup', 'lint', 'security', 'join']);
      expect(maxWave).toBe(3);
      // Each middle branch saw setup's merge but NOT its sibling (they
      // branched from the same wave base).
      expect(seenByStep.get('lint')).toEqual(['setup']);
      expect(seenByStep.get('security')).toEqual(['setup']);
      // The join saw the merged result of BOTH branches.
      expect(seenByStep.get('join')).toEqual(['setup', 'lint', 'security']);
      // Merge cards exist for all four steps, in visit order.
      expect(result.manifest.stageIntegrations!.map((s) => s.stageName)).toEqual([
        'setup', 'lint', 'security', 'join',
      ]);
    },
    60_000,
  );

  it(
    'is deterministic: a second run yields the identical visit sequence',
    async () => {
      const a = await runOnce(diamond());
      const b = await runOnce(diamond());
      expect(a.result.manifest.executionTrace!.map((t) => `${t.stepName}#${t.runs}`)).toEqual(
        b.result.manifest.executionTrace!.map((t) => `${t.stepName}#${t.runs}`),
      );
    },
    120_000,
  );

  it(
    'a check rework outcome re-pends its downstream cone (activation cascade)',
    async () => {
      const pipeline: Pipeline = {
        name: 'rework-cascade',
        steps: [
          { type: 'work', name: 'a', prompt: 'p', files: [], scope: 'project', dependsOn: [] },
          { type: 'work', name: 'b', prompt: 'p', files: [], scope: 'project', dependsOn: ['a'] },
          {
            type: 'check',
            name: 'gate',
            condition: 'scripted',
            dependsOn: ['b'],
            maxRuns: 3,
            outcomes: [
              { label: 'done', nextStepName: 'c', default: true },
              { label: 'rework', nextStepName: 'a' },
            ],
          },
          { type: 'work', name: 'c', prompt: 'p', files: [], scope: 'project', dependsOn: ['gate'] },
        ],
      };
      // First gate visit demands rework (re-pends a + its cone b,gate,c);
      // second visit approves.
      const { result } = await runOnce(pipeline, { verdicts: ['rework', 'done'] });

      expect(result.manifest.status).toBe('done');
      const seq = result.manifest.executionTrace!.map((t) => `${t.stepName}#${t.runs}`);
      expect(seq).toEqual(['a#1', 'b#1', 'gate#1', 'a#2', 'b#2', 'gate#2', 'c#1']);
    },
    60_000,
  );

  it(
    'pipelines without dependsOn keep the legacy linear cursor (no wave field)',
    async () => {
      const pipeline: Pipeline = {
        name: 'legacy',
        steps: [
          { type: 'work', name: 'a', prompt: 'p', files: [], scope: 'project' },
          { type: 'work', name: 'b', prompt: 'p', files: [], scope: 'project' },
        ],
      };
      const { result, maxWave } = await runOnce(pipeline);
      expect(result.manifest.status).toBe('done');
      expect(maxWave).toBe(0);
      expect(result.manifest.executionTrace!.map((t) => t.stepName)).toEqual(['a', 'b']);
    },
    60_000,
  );
});
