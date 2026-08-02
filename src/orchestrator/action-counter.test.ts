import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
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

/**
 * Counters are bumped in `handleAgentEvent`, whose only seam is the `onEvent`
 * callback the orchestrator hands the factory. So a factory that emits a known
 * event script is the spec: drive every event type once (+ repeats) and assert
 * the resulting `AgentStatus.actionCounts` / `lastAction`.
 */
describe('per-agent action counters', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'action-counter-test-'));
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
    'counts EVERY agent event (state_change split into stream/tool) and tracks the last action',
    async () => {
      // Emits one of each event type — plus a second streaming burst — so the
      // expected counts are unambiguous and `state_change` provably splits.
      const factory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
        agentId: task.agentId,
        task,
        async prompt(): Promise<void> {
          onEvent({ type: 'state_change', state: 'streaming' }); // stream #1
          onEvent({ type: 'state_change', state: 'tool_running' }); // tool #1
          onEvent({ type: 'state_change', state: 'streaming' }); // stream #2
          onEvent({ type: 'log', message: 'thinking…' }); // log #1
          // A real change so finalize commits and the run reaches `done`.
          writeFileSync(join(cwd, 'out.txt'), 'content\n', 'utf8');
          onEvent({ type: 'file_write', file: 'out.txt' }); // file #1
          onEvent({ type: 'usage', inputTokens: 10, outputTokens: 5 }); // usage #1
          onEvent({ type: 'done' }); // done #1
        },
        async abort(): Promise<void> {},
        async dispose(): Promise<void> {},
      });

      const pipeline: Pipeline = {
        name: 'action-counter',
        steps: [{ name: 'stage1', prompt: 'p', files: ['a.ts'] }],
      };

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false },
      );

      const result = await orch.start();

      expect(result.manifest.status).toBe('done');
      const agent = result.agents[0]!;
      expect(agent.state).toBe('done');
      // Every event type counted; `state_change` split into stream/tool, with
      // the two streaming bursts accumulated.
      expect(agent.actionCounts).toEqual({
        stream: 2,
        tool: 1,
        log: 1,
        file: 1,
        usage: 1,
        done: 1,
      });
      // `done` was the last event fed through the funnel.
      expect(agent.lastAction).toBe('done');
    },
    20_000,
  );
});
