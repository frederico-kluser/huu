import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import type { AgentFactory } from './types.js';
import type { Pipeline } from '../lib/types.js';
import { GitClient } from '../git/git-client.js';
import { validateTopology } from '../lib/pipeline-io.js';

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
      { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
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
      // "done means MERGED": every clean-run card ends merged, stamped, and
      // the persisted manifest entry carries the same truth.
      expect(agent.merged).toBe(true);
      expect(agent.mergedAt).toBeGreaterThan(0);
      expect(agent.mergeFailed).toBeUndefined();
    }
    for (const entry of result.manifest.agentEntries) {
      expect(entry.merged).toBe(true);
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
  }, 30_000); // headroom for loaded CI boxes — real multi-stage git merges flake at the 5s default.

  it('tracks per-stage merge cards through pending → merging → done', async () => {
    const pipeline: Pipeline = {
      name: 'merge-cards',
      steps: [
        { name: 'stage1', prompt: 's1', files: [] },
        { name: 'stage2', prompt: 's2', files: [] },
      ],
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
      pipeline,
      scratch,
      okFactory,
      { initialConcurrency: 2 },
    );

    const phasesByVisit = new Map<number, Set<string>>();
    orch.subscribe((state) => {
      for (const e of state.stageIntegrations) {
        if (!phasesByVisit.has(e.visitIndex)) phasesByVisit.set(e.visitIndex, new Set());
        phasesByVisit.get(e.visitIndex)!.add(e.phase);
      }
    });

    const result = await orch.start();

    expect(result.manifest.status).toBe('done');
    const integrations = result.manifest.stageIntegrations!;
    expect(integrations).toHaveLength(2);
    for (const entry of integrations) {
      expect(entry.phase).toBe('done');
      expect(entry.branchesMerged).toHaveLength(1);
      expect(entry.resolverUsed).toBe(false);
      expect(entry.modelId).toBe('stub-model');
      expect(entry.startedAt).toBeDefined();
      expect(entry.finishedAt).toBeDefined();
    }
    expect(integrations.map((e) => e.stageName)).toEqual(['stage1', 'stage2']);
    // The card must have been observable in TODO (pending) and DOING (merging).
    expect(phasesByVisit.get(1)).toContain('pending');
    expect(phasesByVisit.get(1)).toContain('merging');
  }, 30_000); // headroom for loaded CI boxes — real multi-stage git merges flake at the 5s default.

  it('passes integrationModelId to the conflict resolver and marks resolverUsed', async () => {
    const originalMerge = GitClient.prototype.merge;
    let callCount = 0;
    GitClient.prototype.merge = async function (worktreePath: string, branchName: string) {
      callCount++;
      if (callCount === 1) {
        return { success: false, conflicts: ['conflict.txt'] };
      }
      return originalMerge.call(this, worktreePath, branchName);
    };

    const pipeline: Pipeline = {
      name: 'integration-model',
      steps: [{ name: 'stage1', prompt: 's1', files: [] }],
      integrationModelId: 'resolver-model',
    };

    const capturedModelIds: string[] = [];
    const capturedMaxThinking: (boolean | undefined)[] = [];
    const resolverFactory: AgentFactory = async (task, config, _hint, _cwd, onEvent, runtimeContext) => {
      capturedMaxThinking.push(runtimeContext?.maxThinking);
      return {
        agentId: task.agentId,
        task,
        async prompt(_message: string): Promise<void> {
          capturedModelIds.push(config.modelId);
          onEvent({ type: 'log', message: 'resolving conflicts' });
        },
        async abort(): Promise<void> {},
        async dispose(): Promise<void> {},
      };
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
      pipeline,
      scratch,
      okFactory,
      { initialConcurrency: 1, conflictResolverFactory: resolverFactory },
    );

    const result = await orch.start();

    GitClient.prototype.merge = originalMerge;

    expect(result.manifest.status).toBe('done');
    expect(capturedModelIds).toEqual(['resolver-model']);
    // The conflict-resolver agent is always spawned with maxThinking so it runs
    // at the model's top reasoning level (see pi/azure factory pickThinkingLevel).
    expect(capturedMaxThinking).toEqual([true]);
    const integrations = result.manifest.stageIntegrations!;
    expect(integrations).toHaveLength(1);
    expect(integrations[0]!.phase).toBe('done');
    expect(integrations[0]!.resolverUsed).toBe(true);
    expect(integrations[0]!.modelId).toBe('resolver-model');
  }, 30_000); // headroom for loaded CI boxes — real git merge + resolver-agent run flakes at the 5s default.

  it('parallel agents never conflict on .env.huu (worktree info/exclude)', async () => {
    // The scratch repo's COMMITTED .gitignore lacks the huu entries — the
    // worktrees would otherwise each commit their own .env.huu (different
    // ports → different content) and the stage merge would add/add-conflict.
    const pipeline: Pipeline = {
      name: 'parallel-envhuu',
      steps: [{ name: 'stage1', prompt: 'p', files: ['a.ts', 'b.ts'] }],
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
      pipeline,
      scratch,
      okFactory,
      { initialConcurrency: 2 },
    );

    const result = await orch.start();

    expect(result.manifest.status).toBe('done');
    const entry = result.manifest.stageIntegrations![0]!;
    expect(entry.phase).toBe('done');
    expect(entry.branchesMerged).toHaveLength(2);
    expect(entry.conflicts).toHaveLength(0);

    const git = new GitClient(scratch);
    const tree = await git.exec(
      `ls-tree -r --name-only ${result.manifest.integrationBranch}`,
    );
    expect(tree).not.toContain('.env.huu');
    expect(tree).not.toContain('.huu-bin');
  }, 30_000); // headroom for loaded CI boxes — real parallel git merges flake at the 5s default.

  it('marks the merge card skipped when no agent commits', async () => {
    const noChangesFactory: AgentFactory = async (task, _config, _hint, _cwd, onEvent) => ({
      agentId: task.agentId,
      task,
      async prompt(_message: string): Promise<void> {
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {},
    });

    const pipeline: Pipeline = {
      name: 'no-changes',
      steps: [{ name: 'stage1', prompt: 's1', files: [] }],
      // Keep the worktree pristine — the default port allocation writes
      // .env.huu/.huu-bin into it, which would count as agent changes here.
      portAllocation: { enabled: false },
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
      pipeline,
      scratch,
      noChangesFactory,
      { initialConcurrency: 1 },
    );

    const result = await orch.start();

    expect(result.manifest.status).toBe('done');
    const integrations = result.manifest.stageIntegrations!;
    expect(integrations).toHaveLength(1);
    expect(integrations[0]!.phase).toBe('skipped');
    // A no_changes card has nothing to merge — the merged tri-state stays
    // undefined (renders as plain terminal NO CHANGES, never READY/UNMERGED).
    expect(result.agents[0]!.phase).toBe('no_changes');
    expect(result.agents[0]!.merged).toBeUndefined();
    expect(result.agents[0]!.mergeFailed).toBeUndefined();
  });

  it('validateTopology catches duplicate step names', () => {
    const pipeline: Pipeline = {
      name: 'dup-names',
      steps: [
        { name: 'stage1', prompt: 's1', files: [] },
        { name: 'stage1', prompt: 's1b', files: [] },
      ],
    };
    const errors = validateTopology(pipeline);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('duplicate step name'))).toBe(true);
  });

  it('validateTopology rejects a dependsOn that points to a later step', () => {
    const pipeline: Pipeline = {
      name: 'fwd-dep',
      steps: [
        { name: 'stage1', prompt: 's1', files: [], dependsOn: ['stage2'] },
        { name: 'stage2', prompt: 's2', files: [] },
      ],
    };
    const errors = validateTopology(pipeline);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('EARLIER'))).toBe(true);
  });

  it('validateTopology rejects unknown dependsOn reference', () => {
    const pipeline: Pipeline = {
      name: 'unknown-dep',
      steps: [
        { name: 'stage1', prompt: 's1', files: [] },
        { name: 'stage2', prompt: 's2', files: [], dependsOn: ['stage-x'] },
      ],
    };
    const errors = validateTopology(pipeline);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('unknown step'))).toBe(true);
  });

  it('validateTopology rejects check step with zero defaults', () => {
    const pipeline: Pipeline = {
      name: 'no-default',
      steps: [
        {
          type: 'check',
          name: 'gate',
          condition: 'check',
          outcomes: [
            { label: 'ok', nextStepName: 'done' },
          ],
        },
        { name: 'done', prompt: 'd', files: [] },
      ],
    };
    const errors = validateTopology(pipeline);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('exactly one outcome with default=true'))).toBe(true);
  });

  it('validateTopology passes a valid pipeline with no errors', () => {
    const pipeline: Pipeline = {
      name: 'valid',
      steps: [
        { name: 'stage1', prompt: 's1', files: [] },
        { name: 'stage2', prompt: 's2', files: [] },
      ],
    };
    expect(validateTopology(pipeline)).toEqual([]);
  });

  it('start recusa grafo invalido — invalid dependsOn throws before run', async () => {
    // dependsOn pointing to the SAME step index — not an earlier step.
    const pipeline: Pipeline = {
      name: 'invalid-dep',
      steps: [
        { name: 'stage1', prompt: 's1', files: [], dependsOn: ['stage2'] },
        { name: 'stage2', prompt: 's2', files: [] },
      ],
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
      pipeline,
      scratch,
      okFactory,
      { initialConcurrency: 1 },
    );

    await expect(orch.start()).rejects.toThrow(/Pipeline topology is invalid/);
  });

  it('start recusa grafo invalido — unknown dependsOn ref throws', async () => {
    const pipeline: Pipeline = {
      name: 'bad-dep',
      steps: [
        { name: 'stage1', prompt: 's1', files: [] },
        { name: 'stage2', prompt: 's2', files: [], dependsOn: ['no-such-step'] },
      ],
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
      pipeline,
      scratch,
      okFactory,
      { initialConcurrency: 1 },
    );

    await expect(orch.start()).rejects.toThrow(/Pipeline topology is invalid/);
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

    // Two tasks in stage1 so the flags' PER-BRANCH granularity is observable:
    // the first branch (ascending agentId) fails, the second merges fine.
    const pipeline: Pipeline = {
      name: 'merge-fail',
      steps: [
        { name: 'stage1', prompt: 's1', files: ['a.ts', 'b.ts'] },
        { name: 'stage2', prompt: 's2', files: [] },
      ],
    };

    const orch = new Orchestrator(
      { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
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

    // Per-branch merge truth on the cards: the failed branch's agent is
    // flagged UNMERGED (orphaned work must not look green), the branch that
    // DID land is merged — and the manifest entries mirror both.
    const byId = new Map(result.agents.map((a) => [a.agentId, a]));
    const failed = byId.get(1)!;
    const landed = byId.get(2)!;
    expect(failed.mergeFailed).toBe(true);
    expect(failed.merged).not.toBe(true);
    expect(landed.merged).toBe(true);
    expect(landed.mergeFailed).toBeUndefined();
    const entryById = new Map(result.manifest.agentEntries.map((e) => [e.agentId, e]));
    expect(entryById.get(1)!.mergeFailed).toBe(true);
    expect(entryById.get(2)!.merged).toBe(true);
  }, 30_000); // headroom for loaded CI boxes — real multi-stage git merges flake at the 5s default.
});
