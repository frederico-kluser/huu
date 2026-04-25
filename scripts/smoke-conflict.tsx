/**
 * Smoke test for the LLM conflict resolver wiring.
 *
 * Strategy: a custom "conflict-causing" stub agent writes to a shared file
 * (`SHARED.md`) on every agent. Two agents in the same stage with conflicting
 * content force a real merge conflict. We then run the orchestrator twice:
 *   1) without a conflictResolverFactory  → expect run status = error
 *   2) with a stub resolver that DOES resolve conflicts deterministically
 *      → expect run status = done
 *
 * The "good" resolver shells out to `git merge --strategy-option=theirs` to
 * deterministically resolve, simulating what an LLM would do.
 */
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Orchestrator } from '../src/orchestrator/index.js';
import type { AgentFactory } from '../src/orchestrator/types.js';
import type { Pipeline } from '../src/lib/types.js';

const conflictStubFactory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
  agentId: task.agentId,
  task,
  async prompt(_message: string): Promise<void> {
    onEvent({ type: 'state_change', state: 'streaming' });
    onEvent({ type: 'log', message: `agent ${task.agentId} writing SHARED.md` });
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(cwd, 'SHARED.md'), `# Content from agent ${task.agentId}\n`, 'utf8');
    onEvent({ type: 'file_write', file: 'SHARED.md' });
    onEvent({ type: 'done' });
  },
  async dispose(): Promise<void> {},
});

/** A "fake LLM" resolver: shells out to git to resolve conflicts using "theirs". */
const fakeResolverFactory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
  agentId: task.agentId,
  task,
  async prompt(message: string): Promise<void> {
    onEvent({ type: 'state_change', state: 'streaming' });
    onEvent({ type: 'log', message: 'fake LLM resolver scanning prompt for conflicted branches' });

    // Extract pending branches from <pending>...</pending> in the prompt.
    const pendingMatch = message.match(/<pending>([\s\S]*?)<\/pending>/);
    const branches: string[] = [];
    if (pendingMatch) {
      for (const line of pendingMatch[1].split('\n')) {
        const m = line.match(/^\s*-\s+(.+)$/);
        if (m) branches.push(m[1].trim());
      }
    }
    onEvent({ type: 'log', message: `branches to resolve: ${branches.join(', ')}` });

    for (const branch of branches) {
      try {
        execSync(`git merge ${branch} --strategy-option=theirs --no-edit`, {
          cwd,
          encoding: 'utf8',
          timeout: 30_000,
        });
        onEvent({ type: 'log', message: `merged ${branch} (theirs)` });
      } catch (err) {
        onEvent({ type: 'log', level: 'error', message: `failed to merge ${branch}: ${err}` });
      }
    }
    onEvent({ type: 'done' });
  },
  async dispose(): Promise<void> {},
});

async function setupScratch(scratch: string): Promise<void> {
  execSync(`rm -rf "${scratch}" && mkdir -p "${scratch}"`, { encoding: 'utf8' });
  execSync('git init --initial-branch=main', { cwd: scratch, encoding: 'utf8' });
  execSync('git config user.email "t@t.com" && git config user.name "t"', { cwd: scratch, shell: '/bin/bash' });
  writeFileSync(join(scratch, 'SHARED.md'), '# initial\n', 'utf8');
  writeFileSync(join(scratch, '.gitignore'), '.programatic-agent-worktrees/\n', 'utf8');
  execSync('git add -A && git commit -m init', { cwd: scratch, encoding: 'utf8' });
}

async function runOnce(scratch: string, withResolver: boolean): Promise<{ status: string; finalCommitSha?: string }> {
  await setupScratch(scratch);
  process.chdir(scratch);

  const pipeline: Pipeline = {
    name: 'conflict-demo',
    steps: [
      { name: 'stage1', prompt: 'overwrite SHARED.md', files: ['a.txt', 'b.txt'] },
    ],
  };

  // Make sure files exist so decomposeTasks creates 2 work items
  writeFileSync(join(scratch, 'a.txt'), 'a\n', 'utf8');
  writeFileSync(join(scratch, 'b.txt'), 'b\n', 'utf8');
  execSync('git add -A && git commit -m "add files"', { cwd: scratch, encoding: 'utf8' });

  const orch = new Orchestrator(
    { apiKey: 'stub', modelId: 'stub-model' },
    pipeline,
    scratch,
    conflictStubFactory,
    {
      initialConcurrency: 2,
      conflictResolverFactory: withResolver ? fakeResolverFactory : undefined,
    },
  );

  const result = await orch.start();
  return { status: result.manifest.status, finalCommitSha: result.integration.finalCommitSha };
}

async function main(): Promise<void> {
  console.log('=== run #1: without resolver (expect error) ===');
  const r1 = await runOnce('/tmp/programatic-conflict-1', false);
  console.log('status:', r1.status);
  if (r1.status !== 'error') {
    console.error('FAIL: expected error status without resolver');
    process.exit(1);
  }
  console.log('OK: no resolver → run aborted on conflict');
  console.log();

  console.log('=== run #2: with fake resolver (expect done) ===');
  const r2 = await runOnce('/tmp/programatic-conflict-2', true);
  console.log('status:', r2.status, 'finalCommit:', r2.finalCommitSha);
  if (r2.status !== 'done') {
    console.error('FAIL: expected done status with resolver');
    process.exit(1);
  }
  console.log('OK: resolver → conflict resolved, run finished');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
