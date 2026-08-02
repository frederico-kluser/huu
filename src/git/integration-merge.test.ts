import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeAgentBranches } from './integration-merge.js';
import type { AgentManifestEntry } from '../lib/types.js';

/** Run git synchronously in a specific cwd (shell is /bin/bash). */
function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', shell: '/bin/bash' }).trim();
}

describe('mergeAgentBranches ordering', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'merge-order-'));
    execSync('git init --initial-branch=main', { cwd: scratch, encoding: 'utf8' });
    git('config user.email "t@t.com" && git config user.name "t"', scratch);
    writeFileSync(join(scratch, 'README.md'), '# init\n', 'utf8');
    git('add -A && git commit -m init', scratch);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('merges in ascending agentId order regardless of input array order', async () => {
    const integrationDir = join(scratch, '.huu-worktrees', 'test-run', 'integration');
    mkdirSync(integrationDir, { recursive: true });

    // Create the integration branch — adds a commit on top of main.
    git(`worktree add -b huu/test-run/integration "${integrationDir}" main`, scratch);
    writeFileSync(join(integrationDir, '.gitignore'), '.huu-worktrees/\n', 'utf8');
    git('add -A && git commit -m "integration baseline"', integrationDir);

    // Create 4 agent branches with non-ascending agentId values.
    const agentIds = [12, 3, 47, 8];

    for (const agentId of agentIds) {
      const branchName = `huu/test-run/agent-${agentId}`;
      const wtPath = join(scratch, '.huu-worktrees', 'test-run', `agent-${agentId}`);
      git(`worktree add -b "${branchName}" "${wtPath}" main`, scratch);
      writeFileSync(join(wtPath, `file-a${agentId}.txt`), `content-${agentId}\n`, 'utf8');
      git('add -A && git commit -m "agent ' + agentId + '"', wtPath);
    }

    // Build entries with deliberately NON-ascending order: [3, 12, 8, 47].
    const entries: AgentManifestEntry[] = agentIds.map((agentId) => ({
      agentId,
      branchName: `huu/test-run/agent-${agentId}`,
      worktreePath: join(scratch, '.huu-worktrees', 'test-run', `agent-${agentId}`),
      files: [`file-a${agentId}.txt`],
      status: 'done',
      pushStatus: 'skipped',
      cleanupDone: false,
      noChanges: false,
    }));

    // Reorder: entries indexed by insertion: [12, 3, 47, 8]
    // Pick order [3, 12, 8, 47] — the 3 is before 12, 8 is before 47, all non-ascending.
    const ordered = [entries[1]!, entries[0]!, entries[3]!, entries[2]!]; // [3, 12, 8, 47]

    const mergedOrder: number[] = [];
    const status = await mergeAgentBranches(
      ordered,
      integrationDir,
      scratch,
      (branchName) => {
        const id = parseInt(branchName.split('-').pop()!, 10);
        mergedOrder.push(id);
      },
    );

    expect(status.phase).toBe('done');
    expect(status.branchesMerged).toHaveLength(4);
    expect(status.conflicts).toHaveLength(0);

    // mergeAgentBranches MUST sort by ascending agentId: [3, 8, 12, 47].
    expect(mergedOrder).toEqual([3, 8, 12, 47]);

    // Verify all files landed.
    for (const agentId of agentIds) {
      const f = join(integrationDir, `file-a${agentId}.txt`);
      const content = execSync(`cat "${f}"`, { cwd: integrationDir, encoding: 'utf8', shell: '/bin/bash' });
      expect(content).toContain(`content-${agentId}`);
    }
  });

  it('onBranchMerged fires once per successfully merged branch', async () => {
    const integrationDir = join(scratch, '.huu-worktrees', 'test-run-2', 'integration');
    mkdirSync(integrationDir, { recursive: true });

    git(`worktree add -b huu/test-run-2/integration "${integrationDir}" main`, scratch);
    writeFileSync(join(integrationDir, '.gitignore'), '.huu-worktrees/\n', 'utf8');
    git('add -A && git commit -m "integration baseline"', integrationDir);

    // Create 2 agent branches.
    for (const agentId of [1, 2]) {
      const branchName = `huu/test-run-2/agent-${agentId}`;
      const wtPath = join(scratch, '.huu-worktrees', 'test-run-2', `agent-${agentId}`);
      git(`worktree add -b "${branchName}" "${wtPath}" main`, scratch);
      writeFileSync(join(wtPath, `file-${agentId}.txt`), `c${agentId}\n`, 'utf8');
      git('add -A && git commit -m "agent ' + agentId + '"', wtPath);
    }

    const entries: AgentManifestEntry[] = [2, 1].map((agentId) => ({
      agentId,
      branchName: `huu/test-run-2/agent-${agentId}`,
      worktreePath: join(scratch, '.huu-worktrees', 'test-run-2', `agent-${agentId}`),
      files: [`file-${agentId}.txt`],
      status: 'done',
      pushStatus: 'skipped',
      cleanupDone: false,
      noChanges: false,
    }));

    const fired: string[] = [];
    const status = await mergeAgentBranches(entries, integrationDir, scratch, (branchName) => {
      fired.push(branchName);
    });

    expect(status.phase).toBe('done');
    // Both merged; callback fires for each.
    expect(fired).toHaveLength(2);
    // Ascending agentId order: agent-1 fires before agent-2.
    expect(fired[0]).toContain('agent-1');
    expect(fired[1]).toContain('agent-2');
  });
});

describe('mergeGate verify hook', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'merge-gate-'));
    execSync('git init --initial-branch=main', { cwd: scratch, encoding: 'utf8' });
    git('config user.email "t@t.com" && git config user.name "t"', scratch);
    writeFileSync(join(scratch, 'README.md'), '# init\n', 'utf8');
    git('add -A && git commit -m init', scratch);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function makeEntry(runName: string, agentId: number): AgentManifestEntry {
    return {
      agentId,
      branchName: `huu/${runName}/agent-${agentId}`,
      worktreePath: join(scratch, '.huu-worktrees', runName, `agent-${agentId}`),
      files: [`file-a${agentId}.txt`],
      status: 'done',
      pushStatus: 'skipped',
      cleanupDone: false,
      noChanges: false,
    };
  }

  function setupIntegration(dirName: string): string {
    const integrationDir = join(scratch, '.huu-worktrees', dirName, 'integration');
    mkdirSync(integrationDir, { recursive: true });
    git(`worktree add -b huu/${dirName}/integration "${integrationDir}" main`, scratch);
    writeFileSync(join(integrationDir, '.gitignore'), '.huu-worktrees/\n', 'utf8');
    git('add -A && git commit -m "integration baseline"', integrationDir);
    return integrationDir;
  }

  function setupAgentBranch(runName: string, agentId: number): void {
    const branchName = `huu/${runName}/agent-${agentId}`;
    const wtPath = join(scratch, '.huu-worktrees', runName, `agent-${agentId}`);
    git(`worktree add -b "${branchName}" "${wtPath}" main`, scratch);
    writeFileSync(join(wtPath, `file-a${agentId}.txt`), `content-${agentId}\n`, 'utf8');
    git('add -A && git commit -m "agent ' + agentId + '"', wtPath);
  }

  it('mergeGate vermelho reverte — verify failure rolls back the merge commit', async () => {
    const runName = 'gate-red';
    const integrationDir = setupIntegration(runName);
    setupAgentBranch(runName, 1);
    setupAgentBranch(runName, 2);

    const initialHead = git('rev-parse HEAD', integrationDir);

    const entries: AgentManifestEntry[] = [makeEntry(runName, 1), makeEntry(runName, 2)];

    // Verify that PASSES for agent 1 but FAILS for agent 2.
    let callCount = 0;
    const status = await mergeAgentBranches(
      entries,
      integrationDir,
      scratch,
      undefined,
      async (_wtPath, branchName) => {
        callCount++;
        // Agent 1 passes; agent 2 fails.
        if (branchName === `huu/${runName}/agent-2`) {
          return { ok: false, output: 'verify failed for ' + branchName };
        }
        return { ok: true, output: 'ok' };
      },
    );

    // Verify was called for both branches.
    expect(callCount).toBe(2);

    // Agent 1 merged, agent 2 pending.
    expect(status.branchesMerged).toEqual([`huu/${runName}/agent-1`]);
    expect(status.branchesPending).toEqual([`huu/${runName}/agent-2`]);
    expect(status.conflicts).toHaveLength(0);
    // Phase is not 'done' because one branch is pending.
    expect(status.phase).toBe('error');

    // The merge commit for agent 2 was rolled back; HEAD should be the merge
    // commit that brought in agent 1 (one commit ahead of initialHead).
    const finalHead = git('rev-parse HEAD', integrationDir);
    // HEAD moved forward once (agent 1 merge), not twice.
    expect(finalHead).not.toBe(initialHead);
    const log = execSync('git log --oneline -2', { cwd: integrationDir, encoding: 'utf8', shell: '/bin/bash' });
    // Should NOT contain agent 2's file changes.
    expect(log).toContain('Merge huu/');

    // Agent 2's file should NOT be in the integration worktree.
    const exists = (() => {
      try {
        execSync(`test -f "${join(integrationDir, 'file-a2.txt')}"`, {
          cwd: integrationDir,
          encoding: 'utf8',
          shell: '/bin/bash',
        });
        return true;
      } catch {
        return false;
      }
    })();
    expect(exists).toBe(false);

    // Agent 1's file SHOULD be present.
    const content1 = execSync(`cat "${join(integrationDir, 'file-a1.txt')}"`, {
      cwd: integrationDir,
      encoding: 'utf8',
      shell: '/bin/bash',
    });
    expect(content1).toContain('content-1');
  });

  it('mergeGate nomeia o branch — verify receives the correct branch name', async () => {
    const runName = 'gate-name';
    const integrationDir = setupIntegration(runName);
    setupAgentBranch(runName, 1);
    setupAgentBranch(runName, 3); // non-sequential IDs to confirm ordering

    const entries: AgentManifestEntry[] = [makeEntry(runName, 3), makeEntry(runName, 1)]; // reversed input order

    const receivedBranches: string[] = [];
    await mergeAgentBranches(
      entries,
      integrationDir,
      scratch,
      undefined,
      async (_wtPath, branchName) => {
        receivedBranches.push(branchName);
        return { ok: true, output: 'ok' };
      },
    );

    // Verify receives branches in ascending agentId order: agent-1 then agent-3.
    expect(receivedBranches).toEqual([
      `huu/${runName}/agent-1`,
      `huu/${runName}/agent-3`,
    ]);
  });

  it('verify throwing is treated as failure (ok: false)', async () => {
    const runName = 'gate-throw';
    const integrationDir = setupIntegration(runName);
    setupAgentBranch(runName, 1);

    const entries: AgentManifestEntry[] = [makeEntry(runName, 1)];

    const status = await mergeAgentBranches(
      entries,
      integrationDir,
      scratch,
      undefined,
      async () => {
        throw new Error('boom');
      },
    );

    expect(status.branchesMerged).toHaveLength(0);
    expect(status.branchesPending).toEqual([`huu/${runName}/agent-1`]);
    expect(status.phase).toBe('error');
  });
});
