import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHeadless } from './headless-run.js';
import type { AgentFactory } from '../orchestrator/types.js';
import type { Pipeline } from './types.js';

const okFactory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
  agentId: task.agentId,
  task,
  async prompt(_message: string): Promise<void> {
    onEvent({ type: 'state_change', state: 'streaming' });
    await new Promise((r) => setTimeout(r, 10));
    const fileName = `s${task.stageIndex}_a${task.agentId}.txt`;
    writeFileSync(join(cwd, fileName), 'content\n', 'utf8');
    onEvent({ type: 'file_write', file: fileName });
    onEvent({ type: 'done' });
  },
  async abort(): Promise<void> {},
  async dispose(): Promise<void> {},
});

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

describe('runHeadless', () => {
  let scratch: string;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let origStdout: typeof process.stdout.write;
  let origStderr: typeof process.stderr.write;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'hr-test-'));
    setupRepo(scratch);
    stdoutChunks = [];
    stderrChunks = [];
    origStdout = process.stdout.write.bind(process.stdout);
    origStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: unknown): boolean => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown): boolean => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    try {
      execSync(`rm -rf "${scratch}"`, { encoding: 'utf8' });
    } catch {
      /* best effort */
    }
  });

  it('returns 0 and emits a parseable final JSON on success', async () => {
    const pipeline: Pipeline = {
      name: 'h',
      steps: [{ type: 'work', name: 'one', prompt: 'p', files: [] }],
    };
    const code = await runHeadless({
      pipeline,
      config: { apiKey: 'stub', modelId: 'stub', backend: 'stub' },
      cwd: scratch,
      agentFactory: okFactory,
      concurrency: 1,
      emitIntervalMs: 10,
    });
    expect(code).toBe(0);
    const stdout = stdoutChunks.join('');
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.runId).toMatch(/^[a-z0-9]+$/);
    expect(parsed.integrationBranch).toMatch(/^huu\/.*\/integration$/);
    expect(parsed.status).toBe('done');
  });

  it('streams at least one NDJSON state event to stderr', async () => {
    const pipeline: Pipeline = {
      name: 'h',
      steps: [{ type: 'work', name: 'one', prompt: 'p', files: [] }],
    };
    await runHeadless({
      pipeline,
      config: { apiKey: 'stub', modelId: 'stub', backend: 'stub' },
      cwd: scratch,
      agentFactory: okFactory,
      concurrency: 1,
      emitIntervalMs: 10,
    });
    const stderr = stderrChunks.join('');
    const lines = stderr.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const parsedLines = lines.map((l) => JSON.parse(l));
    expect(parsedLines.some((e) => e.type === 'state')).toBe(true);
  });

  it('pins manual mode when the config sets concurrency (back-compat)', async () => {
    const pipeline: Pipeline = {
      name: 'h',
      steps: [{ type: 'work', name: 'one', prompt: 'p', files: [] }],
    };
    await runHeadless({
      pipeline,
      config: { apiKey: 'stub', modelId: 'stub', backend: 'stub' },
      cwd: scratch,
      agentFactory: okFactory,
      concurrency: 1,
      emitIntervalMs: 10,
    });
    const lines = stderrChunks.join('').split('\n').filter(Boolean);
    const states = lines.map((l) => JSON.parse(l)).filter((e) => e.type === 'state');
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((e) => e.autoScale === 'manual')).toBe(true);
  });

  it('defaults to auto-scale when the config sets no concurrency', async () => {
    const pipeline: Pipeline = {
      name: 'h',
      steps: [{ type: 'work', name: 'one', prompt: 'p', files: [] }],
    };
    await runHeadless({
      pipeline,
      config: { apiKey: 'stub', modelId: 'stub', backend: 'stub' },
      cwd: scratch,
      agentFactory: okFactory,
      emitIntervalMs: 10,
    });
    const lines = stderrChunks.join('').split('\n').filter(Boolean);
    const states = lines.map((l) => JSON.parse(l)).filter((e) => e.type === 'state');
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((e) => e.autoScale === 'auto')).toBe(true);
  });

  it('an explicit autoScale: true keeps auto mode even with concurrency set', async () => {
    const pipeline: Pipeline = {
      name: 'h',
      steps: [{ type: 'work', name: 'one', prompt: 'p', files: [] }],
    };
    await runHeadless({
      pipeline,
      config: { apiKey: 'stub', modelId: 'stub', backend: 'stub' },
      cwd: scratch,
      agentFactory: okFactory,
      concurrency: 2,
      autoScale: true,
      emitIntervalMs: 10,
    });
    const lines = stderrChunks.join('').split('\n').filter(Boolean);
    const states = lines.map((l) => JSON.parse(l)).filter((e) => e.type === 'state');
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((e) => e.autoScale === 'auto')).toBe(true);
  });

  it('returns 1 with structured error JSON when the orchestrator throws (e.g. non-git cwd)', async () => {
    const pipeline: Pipeline = {
      name: 'h',
      steps: [{ type: 'work', name: 'one', prompt: 'p', files: [] }],
    };
    // Force orchestrator.start() to throw at preflight by running outside a git repo.
    const nonGitDir = mkdtempSync(join(tmpdir(), 'no-git-'));
    try {
      const code = await runHeadless({
        pipeline,
        config: { apiKey: 'stub', modelId: 'stub', backend: 'stub' },
        cwd: nonGitDir,
        agentFactory: okFactory,
        concurrency: 1,
        emitIntervalMs: 10,
      });
      expect(code).toBe(1);
      const stdout = stdoutChunks.join('');
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toMatch(/[Pp]reflight|repository|git/);
    } finally {
      try {
        execSync(`rm -rf "${nonGitDir}"`, { encoding: 'utf8' });
      } catch { /* best effort */ }
    }
  });
});
