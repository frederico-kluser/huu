import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import type { AgentFactory } from './types.js';
import type { AgentTask, Pipeline } from '../lib/types.js';

function setupRepo(dir: string): void {
  execSync('git init --initial-branch=main', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "t@t.com" && git config user.name "t"', {
    cwd: dir,
    shell: '/bin/bash',
  });
  writeFileSync(join(dir, 'README.md'), '# init\n', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.huu-worktrees/\n', 'utf8');
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(dir, 'b.ts'), 'export const b = 2;\n', 'utf8');
  execSync('git add -A && git commit -m init', { cwd: dir, encoding: 'utf8' });
}

/**
 * Stub factory for the producer→consumer memory flow. Agents on the
 * producing stage write (or corrupt, or skip) the memory file in their own
 * worktree — the stage merge carries it into the integration worktree,
 * which is where the memory-scope step must read it from. Consumer-stage
 * agents record their task + rendered prompt for assertions.
 */
function makeMemoryFlowFactory(opts: {
  producerWrites?: 'valid' | 'corrupt' | 'none';
}): {
  factory: AgentFactory;
  consumerTasks: AgentTask[];
  consumerPrompts: string[];
  producerPrompts: string[];
} {
  const consumerTasks: AgentTask[] = [];
  const consumerPrompts: string[] = [];
  const producerPrompts: string[] = [];
  const factory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
    agentId: task.agentId,
    task,
    async prompt(text?: string): Promise<void> {
      onEvent({ type: 'state_change', state: 'streaming' });
      if (task.stageName === 'one: produce list') {
        producerPrompts.push(text ?? '');
        if (opts.producerWrites === 'valid') {
          mkdirSync(join(cwd, '.huu'), { recursive: true });
          writeFileSync(
            join(cwd, '.huu', 'scan.json'),
            JSON.stringify({
              _format: 'huu-memory-v1',
              files: [{ path: 'a.ts', hint: 'lead-A from the scanner' }, 'b.ts'],
            }),
            'utf8',
          );
          onEvent({ type: 'file_write', file: '.huu/scan.json' });
        } else if (opts.producerWrites === 'corrupt') {
          mkdirSync(join(cwd, '.huu'), { recursive: true });
          writeFileSync(join(cwd, '.huu', 'scan.json'), '{ broken', 'utf8');
          onEvent({ type: 'file_write', file: '.huu/scan.json' });
        } else {
          // Producer chose to write nothing — still commit SOMETHING so the
          // stage merge isn't skipped for emptiness reasons.
          writeFileSync(join(cwd, 'producer-ran.txt'), 'yes\n', 'utf8');
          onEvent({ type: 'file_write', file: 'producer-ran.txt' });
        }
      } else {
        consumerTasks.push(task);
        consumerPrompts.push(text ?? '');
        const out = `consumed-${task.agentId}.txt`;
        writeFileSync(join(cwd, out), `${task.files.join(',')}\n`, 'utf8');
        onEvent({ type: 'file_write', file: out });
      }
      onEvent({ type: 'done' });
    },
    async abort(): Promise<void> {},
    async dispose(): Promise<void> {},
  });
  return { factory, consumerTasks, consumerPrompts, producerPrompts };
}

function memoryPipeline(): Pipeline {
  return {
    name: 'memory-flow',
    steps: [
      {
        type: 'work',
        name: 'one: produce list',
        prompt: 'write the scan list',
        files: [],
        scope: 'project',
        produces: '.huu/scan.json',
      },
      {
        type: 'work',
        name: 'two: consume $file',
        prompt: 'work on $file — scanner note: $hint',
        files: [],
        scope: 'memory',
        filesFrom: '.huu/scan.json',
      },
    ],
  };
}

describe('memory scope (filesFrom fan-out)', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'memscope-test-'));
    setupRepo(scratch);
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${scratch}"`, { encoding: 'utf8' });
    } catch {
      /* best effort */
    }
  });

  it(
    'fans out one agent per listed file, reading the list from the integration worktree, with $hint substituted',
    async () => {
      const { factory, consumerTasks, consumerPrompts, producerPrompts } = makeMemoryFlowFactory({
        producerWrites: 'valid',
      });
      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        memoryPipeline(),
        scratch,
        factory,
        { initialConcurrency: 2, autoScale: false },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('done');
      // One consumer agent per listed path. Capture order follows agent
      // COMPLETION (parallel pool) — assert by identity, not arrival.
      const byFile = [...consumerTasks].sort((x, y) => x.files[0]!.localeCompare(y.files[0]!));
      expect(byFile.map((t) => t.files[0])).toEqual(['a.ts', 'b.ts']);
      // The producer's per-entry hint rode along on the task...
      expect(byFile[0]!.hint).toBe('lead-A from the scanner');
      expect(byFile[1]!.hint).toBeUndefined();
      // ...and was substituted into the rendered prompt via $hint.
      const promptA = consumerPrompts.find((p) => p.includes('work on a.ts'))!;
      const promptB = consumerPrompts.find((p) => p.includes('work on b.ts'))!;
      expect(promptA).toContain('scanner note: lead-A from the scanner');
      expect(promptB).toBeDefined();
      expect(promptB).not.toContain('$hint');
      // The producer declared `produces` — huu appended the MEMORY CONTRACT
      // (exact path, format, the default cap) to its prompt at run time.
      expect(producerPrompts[0]).toContain('write the scan list');
      expect(producerPrompts[0]).toContain('MEMORY CONTRACT');
      expect(producerPrompts[0]).toContain('`.huu/scan.json`');
      expect(producerPrompts[0]).toContain('huu-memory-v1');
      expect(producerPrompts[0]).toContain('at most 40 files');
    },
    60_000,
  );

  it(
    'missing memory file resolves the stage to zero tasks and the run still completes',
    async () => {
      const { factory, consumerTasks } = makeMemoryFlowFactory({ producerWrites: 'none' });
      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        memoryPipeline(),
        scratch,
        factory,
        { initialConcurrency: 2, autoScale: false },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('done');
      expect(consumerTasks).toHaveLength(0);
    },
    60_000,
  );

  it(
    'corrupt memory file fails the run loudly',
    async () => {
      const { factory, consumerTasks } = makeMemoryFlowFactory({ producerWrites: 'corrupt' });
      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        memoryPipeline(),
        scratch,
        factory,
        { initialConcurrency: 2, autoScale: false },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('error');
      expect(consumerTasks).toHaveLength(0);
    },
    60_000,
  );
});
