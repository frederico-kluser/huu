import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { Orchestrator } from './index.js';
import type { AgentFactory } from './types.js';
import type { Pipeline } from '../lib/types.js';
import { GitClient } from '../git/git-client.js';

function setupScratchRepo(scratch: string): void {
  execSync('git init --initial-branch=main', { cwd: scratch, encoding: 'utf8' });
  execSync('git config user.email "t@t.com" && git config user.name "t"', {
    cwd: scratch,
    shell: '/bin/bash',
  });
  writeFileSync(join(scratch, 'README.md'), '# initial\n', 'utf8');
  writeFileSync(join(scratch, '.gitignore'), '.huu-worktrees/\n', 'utf8');
  execSync('git add -A && git commit -m init', { cwd: scratch, encoding: 'utf8' });
}

const disposeErrorFactory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
  agentId: task.agentId,
  task,
  async prompt(_message: string): Promise<void> {
    onEvent({ type: 'state_change', state: 'streaming' });
    const targetFile = task.files.length > 0 ? task.files[0]! : 'STUB.md';
    writeFileSync(join(cwd, targetFile), `content from agent ${task.agentId}\n`, 'utf8');
    onEvent({ type: 'file_write', file: targetFile });
    onEvent({ type: 'done' });
  },
  async dispose(): Promise<void> {
    throw new Error('dispose explosion');
  },
});

describe('pipeline integration', () => {
  it('continues pipeline when agent.dispose() throws', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'pa-dispose-'));
    try {
      setupScratchRepo(scratch);

      writeFileSync(join(scratch, 'file.txt'), 'initial\n', 'utf8');
      execSync('git add -A && git commit -m "add file"', { cwd: scratch, encoding: 'utf8' });

      const pipeline: Pipeline = {
        name: 'dispose-error-test',
        steps: [{ name: 'stage1', prompt: 'Process $file', files: ['file.txt'] }],
      };

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model' },
        pipeline,
        scratch,
        disposeErrorFactory,
        { initialConcurrency: 1 },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('done');
      expect(result.agents).toHaveLength(1);

      const agent = result.agents[0]!;
      expect(agent.state).toBe('done');
      expect(agent.commitSha).toBeTruthy();

      const disposeLog = result.logs.find((l) => l.message.includes('dispose failed'));
      expect(disposeLog).toBeDefined();
      expect(disposeLog!.level).toBe('warn');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('aborts the run when stage merge fails for non-conflict reason (with resolverFactory)', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'pa-merge-fail-'));
    const originalMerge = GitClient.prototype.merge;
    let callCount = 0;
    // First merge returns success:false with NO conflicts — the "non-conflict
    // merge fail" pattern from Bug B. Pre-fix, the resolver path would spawn
    // an integration agent, see conflictedBranches=[], skip the loop, and
    // claim success — leaving the integration HEAD untouched and the
    // orchestrator silently progressing to the next stage on a stale base.
    GitClient.prototype.merge = async function (worktreePath, branchName) {
      callCount++;
      if (callCount === 1) return { success: false, conflicts: [] };
      return originalMerge.call(this, worktreePath, branchName);
    };

    const okFactory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
      agentId: task.agentId,
      task,
      async prompt(_message: string): Promise<void> {
        onEvent({ type: 'state_change', state: 'streaming' });
        const fileName = `s${task.stageIndex}_a${task.agentId}.txt`;
        writeFileSync(join(cwd, fileName), `content\n`, 'utf8');
        onEvent({ type: 'file_write', file: fileName });
        onEvent({ type: 'done' });
      },
      async dispose(): Promise<void> {},
    });

    try {
      setupScratchRepo(scratch);

      const pipeline: Pipeline = {
        name: 'merge-fail-resolver',
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
        { initialConcurrency: 1, conflictResolverFactory: okFactory },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('error');

      // Stage 2 must NOT have run — the run aborts in stage 1's integration
      // before stage 2's executeTaskPool ever fires. Stage 2 agents are
      // pre-decomposed into result.agents but should be untouched: state stays
      // 'idle', phase stays 'pending', no commit, no streaming.
      const stage2Agents = result.agents.filter((a) => a.stageIndex === 1);
      expect(stage2Agents.length).toBeGreaterThan(0);
      for (const a of stage2Agents) {
        expect(a.commitSha).toBeFalsy();
        expect(a.state).toBe('idle');
        expect(a.phase).toBe('pending');
      }

      // The new error message from integration-agent.ts must appear in the logs
      // so operators can tell *why* the run aborted.
      const failLog = result.logs.find((l) =>
        l.message.includes('merge failed for non-conflict reason'),
      );
      expect(failLog).toBeDefined();
    } finally {
      GitClient.prototype.merge = originalMerge;
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
