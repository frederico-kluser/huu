import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import type { AgentFactory } from './types.js';
import type { Pipeline } from '../lib/types.js';
import { GitClient } from '../git/git-client.js';

const okFactory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
  agentId: task.agentId,
  task,
  async prompt(_message: string): Promise<void> {
    onEvent({ type: 'state_change', state: 'streaming' });
    await new Promise((r) => setTimeout(r, 10));
    const fileName = `s${task.stageIndex}_a${task.agentId}.txt`;
    writeFileSync(join(cwd, fileName), `content\n`, 'utf8');
    onEvent({ type: 'file_write', file: fileName });
    onEvent({ type: 'done' });
  },
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

describe('multi-stage pipeline', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'pa-test-'));
    setupRepo(scratch);
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${scratch}"`, { encoding: 'utf8' });
    } catch {
      /* best effort */
    }
  });

  it('merges all agent branches across multiple stages', async () => {
    const pipeline: Pipeline = {
      name: 'multi-stage',
      steps: [
        { name: 'stage1', prompt: 's1', files: [] },
        { name: 'stage2', prompt: 's2', files: [] },
      ],
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model' },
      pipeline,
      scratch,
      okFactory,
      { initialConcurrency: 2 },
    );

    const result = await orch.start();

    expect(result.manifest.status).toBe('done');
    expect(result.agents).toHaveLength(2);
    expect(result.agents.filter((a) => a.commitSha)).toHaveLength(2);
    expect(result.integration.branchesMerged).toHaveLength(2);
    expect(result.integration.branchesPending).toHaveLength(0);
    expect(result.integration.conflicts).toHaveLength(0);
    expect(result.integration.phase).toBe('done');

    for (const agent of result.agents) {
      expect(agent.startedAt).toBeDefined();
      expect(agent.startedAt).toBeGreaterThan(0);
      expect(agent.finishedAt).toBeDefined();
      expect(agent.finishedAt).toBeGreaterThanOrEqual(agent.startedAt!);
    }

    const git = new GitClient(scratch);
    const log = await git.exec(`log --oneline ${result.manifest.integrationBranch}`);
    const mergeCommits = log.split('\n').filter((l) => l.includes('Merge'));
    expect(mergeCommits).toHaveLength(2);

    // Run log persisted under .huu/: chronological `.log` + sibling per-agent dir.
    const huuDir = join(scratch, '.huu');
    expect(existsSync(huuDir)).toBe(true);
    const huuFiles = readdirSync(huuDir);
    const chronoFile = huuFiles.find((f) => f.endsWith('.log'));
    expect(chronoFile).toBeDefined();
    expect(chronoFile!).toMatch(
      new RegExp(`^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}-execution-${result.runId}\\.log$`),
    );
    const splitDirName = chronoFile!.replace(/\.log$/, '');
    expect(huuFiles).toContain(splitDirName);
    const content = readFileSync(join(huuDir, chronoFile!), 'utf8');
    expect(content).toContain(`# Run ID:            ${result.runId}`);
    expect(content).toContain('# Pipeline:          multi-stage');
    expect(content).toContain('=== Logs ===');
    expect(content).toContain('=== Per-Agent Summary ===');
    expect(content).toContain('=== Integration ===');
    // Each agent should appear in the per-agent section
    for (const a of result.agents) {
      expect(content).toContain(`agent-${a.agentId}`);
    }
  });

  it('fails the run when a merge fails for a non-conflict reason', async () => {
    const originalMerge = GitClient.prototype.merge;
    let callCount = 0;
    GitClient.prototype.merge = async function (worktreePath: string, branchName: string) {
      callCount++;
      if (callCount === 1) {
        return { success: false, conflicts: [] };
      }
      return originalMerge.call(this, worktreePath, branchName);
    };

    const pipeline: Pipeline = {
      name: 'merge-fail',
      steps: [
        { name: 'stage1', prompt: 's1', files: [] },
        { name: 'stage2', prompt: 's2', files: [] },
      ],
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model' },
      pipeline,
      scratch,
      okFactory,
      { initialConcurrency: 2 },
    );

    const result = await orch.start();

    GitClient.prototype.merge = originalMerge;

    expect(result.manifest.status).toBe('error');
    expect(result.integration.phase).toBe('error');
    expect(result.integration.branchesPending.length).toBeGreaterThan(0);
  });

  it('calls onInteractiveStep for interactive stages and uses the refined prompt', async () => {
    const promptsReceived: string[] = [];
    const recordingFactory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
      agentId: task.agentId,
      task,
      async prompt(message: string): Promise<void> {
        promptsReceived.push(message);
        onEvent({ type: 'state_change', state: 'streaming' });
        await new Promise((r) => setTimeout(r, 5));
        writeFileSync(join(cwd, `s${task.stageIndex}_a${task.agentId}.txt`), 'x\n', 'utf8');
        onEvent({ type: 'done' });
      },
      async dispose(): Promise<void> {},
    });

    const pipeline: Pipeline = {
      name: 'interactive-flow',
      steps: [
        {
          name: 'refine',
          prompt: 'intent original',
          files: [],
          interactive: true,
        },
        {
          name: 'apply',
          prompt: 'aplique mudanças',
          files: [],
        },
      ],
    };

    const interactiveCalls: Array<{ stageIdx: number; promptIn: string }> = [];
    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model' },
      pipeline,
      scratch,
      recordingFactory,
      {
        initialConcurrency: 2,
        onInteractiveStep: async (step, stageIdx) => {
          interactiveCalls.push({ stageIdx, promptIn: step.prompt });
          return 'PROMPT-REFINADO';
        },
      },
    );

    const result = await orch.start();

    expect(result.manifest.status).toBe('done');
    expect(interactiveCalls).toHaveLength(1);
    expect(interactiveCalls[0]).toEqual({ stageIdx: 0, promptIn: 'intent original' });
    // The first agent should have received the refined prompt header (which contains it).
    expect(promptsReceived.some((p) => p.includes('PROMPT-REFINADO'))).toBe(true);
    // Original pipeline prompt MUST NOT be mutated.
    expect(pipeline.steps[0].prompt).toBe('intent original');
  });

  it('aborts the run when the interactive callback rejects', async () => {
    const pipeline: Pipeline = {
      name: 'interactive-cancel',
      steps: [
        { name: 'refine', prompt: 'x', files: [], interactive: true },
        { name: 'apply', prompt: 'y', files: [] },
      ],
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model' },
      pipeline,
      scratch,
      okFactory,
      {
        initialConcurrency: 2,
        onInteractiveStep: async () => {
          throw new Error('user cancelled');
        },
      },
    );

    const result = await orch.start();
    // Aborted runs end with manifest.status === 'done' (orchestrator treats
    // cooperative abort as a clean shutdown), but no agent commits land.
    expect(result.agents.filter((a) => a.commitSha)).toHaveLength(0);
  });

  it('errors when an interactive step is present but no handler is wired', async () => {
    const pipeline: Pipeline = {
      name: 'interactive-no-handler',
      steps: [{ name: 'refine', prompt: 'x', files: [], interactive: true }],
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model' },
      pipeline,
      scratch,
      okFactory,
      { initialConcurrency: 2 },
    );

    const result = await orch.start();
    expect(result.manifest.status).toBe('error');
  });
});
