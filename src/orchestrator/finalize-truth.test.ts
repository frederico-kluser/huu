import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import type { AgentFactory } from './types.js';
import type { Pipeline } from '../lib/types.js';

/**
 * REGRESSION PIN — "did this task produce anything" is a GIT question.
 *
 * `finalizeAgent` used to answer it from `hasChanges(worktree)` alone. The
 * moment anything commits mid-task the tree goes clean, the card is stamped
 * `no_changes`, and `runStageIntegration` (which only merges entries with
 * `commitSha && state === 'done'`) then drops the branch WITHOUT AN ERROR —
 * the agent's whole output silently gone.
 *
 * Two paths hit it: the per-task review loop, which commits every round, and
 * pause→resume, where `pauseAgent` clears `commitSha` on a branch that already
 * has commits. Both are fixed by the same line — `dirty || branchAhead`.
 */

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

/** An agent that writes AND commits itself, leaving the worktree clean. */
function selfCommittingFactory(): AgentFactory {
  return async (task, _config, _hint, cwd, onEvent) => ({
    agentId: task.agentId,
    task,
    async prompt(): Promise<void> {
      writeFileSync(join(cwd, `a${task.agentId}.txt`), 'content\n', 'utf8');
      execSync('git add -A && git commit -q -m "agent commit"', { cwd, encoding: 'utf8' });
      onEvent({ type: 'done' });
    },
    async abort(): Promise<void> {},
    async dispose(): Promise<void> {},
  });
}

/** An agent that does nothing at all. */
const idleFactory: AgentFactory = async (task, _config, _hint, _cwd, onEvent) => ({
  agentId: task.agentId,
  task,
  async prompt(): Promise<void> {
    onEvent({ type: 'done' });
  },
  async abort(): Promise<void> {},
  async dispose(): Promise<void> {},
});

const PIPELINE: Pipeline = {
  name: 'finalize-truth',
  steps: [{ type: 'work', name: 'stage1', prompt: 'p $file', files: ['a.ts'] }],
};

describe('finalizeAgent — produced-work truth', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'finalize-truth-'));
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
    'clean worktree but branch AHEAD ⇒ done + commitSha, and the branch still merges',
    async () => {
      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        PIPELINE,
        scratch,
        selfCommittingFactory(),
        { initialConcurrency: 1, autoScale: false },
      );
      const result = await orch.start();
      const agent = result.agents[0]!;

      expect(agent.phase).toBe('done');
      expect(agent.state).toBe('done');
      // Resolved from git (the branch tip), not from a status field that was
      // never written on this path.
      expect(agent.commitSha).toBeDefined();
      expect(agent.filesModified).toEqual(['a1.txt']);
      // THE POINT: the work reached the integration worktree.
      expect(agent.merged).toBe(true);
      expect(result.integration.branchesMerged).toHaveLength(1);
      expect(result.manifest.status).toBe('done');
    },
    30_000,
  );

  it(
    'clean worktree and branch NOT ahead ⇒ no_changes (the honest empty outcome)',
    async () => {
      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        PIPELINE,
        scratch,
        idleFactory,
        { initialConcurrency: 1, autoScale: false },
      );
      const result = await orch.start();
      const agent = result.agents[0]!;

      expect(agent.phase).toBe('no_changes');
      expect(agent.state).toBe('done');
      expect(agent.commitSha).toBeUndefined();
      // Nothing to merge — the merge card is skipped, not failed.
      expect(result.integration.branchesMerged).toHaveLength(0);
      expect(result.manifest.status).toBe('done');
    },
    30_000,
  );
});
