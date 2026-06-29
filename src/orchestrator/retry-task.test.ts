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

type SpawnBehavior =
  | { kind: 'succeed'; afterMs?: number }
  | { kind: 'fail' }
  | { kind: 'hang'; ms: number };

/**
 * Per-spawn programmable factory. `decide(agentId, spawnCount)` returns what
 * the n-th spawn of that agent should do — succeed (writes a file + done),
 * fail (throws), or hang (resolves only on dispose, used to force a timeout).
 */
function makeRetryFactory(decide: (agentId: number, spawnCount: number) => SpawnBehavior): {
  factory: AgentFactory;
  spawnCounts: Map<number, number>;
} {
  const spawnCounts = new Map<number, number>();
  const factory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => {
    const spawnCount = (spawnCounts.get(task.agentId) ?? 0) + 1;
    spawnCounts.set(task.agentId, spawnCount);
    let onDispose: (() => void) | null = null;
    const disposed = new Promise<never>((_, reject) => {
      onDispose = () => reject(new Error('disposed'));
    });
    disposed.catch(() => {
      /* handled — success path disposes after prompt resolved */
    });
    return {
      agentId: task.agentId,
      task,
      async prompt(): Promise<void> {
        onEvent({ type: 'state_change', state: 'streaming' });
        const b = decide(task.agentId, spawnCount);
        if (b.kind === 'fail') {
          throw new Error('boom: agent failed');
        }
        if (b.kind === 'hang') {
          // Resolves only when the orchestrator disposes us (the timeout path).
          await Promise.race([new Promise((r) => setTimeout(r, b.ms)), disposed]);
          return;
        }
        await Promise.race([new Promise((r) => setTimeout(r, b.afterMs ?? 50)), disposed]);
        const fileName = `out-${task.agentId}.txt`;
        writeFileSync(join(cwd, fileName), `content ${spawnCount}\n`, 'utf8');
        onEvent({ type: 'file_write', file: fileName });
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {
        onDispose?.();
      },
    };
  };
  return { factory, spawnCounts };
}

describe('interactive retry (awaiting_retry → retryTask → finish)', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'retry-test-'));
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
    'holds the run open on a failed card, retries it to success, and merges it',
    async () => {
      const pipeline: Pipeline = {
        name: 'retry',
        // maxRetries 0 so the first failure goes straight to an error card
        // (no in-stage auto-retry masking the user-retry under test).
        maxRetries: 0,
        steps: [{ name: 'stage1', prompt: 'p $file', files: ['a.ts', 'b.ts'] }],
      };
      // a.ts's agent fails on its FIRST spawn and succeeds on the user retry;
      // b.ts always succeeds. Lowest agentId (1) is a.ts.
      const { factory, spawnCounts } = makeRetryFactory((agentId, spawnCount) =>
        agentId === 1 && spawnCount === 1 ? { kind: 'fail' } : { kind: 'succeed' },
      );

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false, interactiveRetry: true },
      );

      let sawAwaitingRetry = false;
      let retried = false;
      let finished = false;
      orch.subscribe((state) => {
        if (state.status !== 'awaiting_retry') return;
        sawAwaitingRetry = true;
        const failed = state.agents.find((a) => a.state === 'error');
        if (failed && !retried) {
          retried = true;
          void orch.retryTask(failed.agentId);
          return;
        }
        if (!failed && !finished) {
          finished = true;
          orch.finish();
        }
      });

      const result = await orch.start();

      // The run paused in awaiting_retry rather than finishing with a red card.
      expect(sawAwaitingRetry).toBe(true);
      expect(result.manifest.status).toBe('done');
      // The retried task spawned a second time and now succeeded.
      expect(spawnCounts.get(1)).toBe(2);
      const a = result.agents.find((x) => x.agentId === 1)!;
      expect(a.state).toBe('done');
      expect(a.commitSha).toBeDefined();
      expect(a.manualRetries).toBe(1);
      expect(a.error).toBeUndefined();
      // Both branches ended up integrated (b in the stage merge, a in the retry merge).
      expect(result.integration.branchesMerged).toHaveLength(2);
      // No duplicate manifest entry for the retried agent.
      expect(result.manifest.agentEntries.filter((e) => e.agentId === 1)).toHaveLength(1);
      expect(result.manifest.agentEntries.find((e) => e.agentId === 1)!.status).toBe('done');
    },
    20_000,
  );

  it(
    'retries a TIMED-OUT card with a longer timeout and integrates it',
    async () => {
      const pipeline: Pipeline = {
        name: 'retry-timeout',
        maxRetries: 0,
        // 200ms timeout for the single-file card.
        singleFileCardTimeoutMs: 200,
        steps: [{ name: 'stage1', prompt: 'p $file', files: ['slow.ts'] }],
      };
      // First spawn hangs (→ TimeoutError at 200ms). The retry needs ~400ms,
      // which exceeds the original 200ms limit — so it only succeeds because
      // the user's longer per-task override is honored.
      const { factory, spawnCounts } = makeRetryFactory((_agentId, spawnCount) =>
        spawnCount === 1 ? { kind: 'hang', ms: 5_000 } : { kind: 'succeed', afterMs: 400 },
      );

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false, interactiveRetry: true },
      );

      let sawTimeoutCard = false;
      let retried = false;
      let finished = false;
      orch.subscribe((state) => {
        const tmo = state.agents.find((a) => a.state === 'error' && a.errorKind === 'timeout');
        if (tmo) sawTimeoutCard = true;
        if (state.status !== 'awaiting_retry') return;
        const failed = state.agents.find((a) => a.state === 'error');
        if (failed && !retried) {
          retried = true;
          void orch.retryTask(failed.agentId, { timeoutMs: 2_000 });
          return;
        }
        if (!failed && !finished) {
          finished = true;
          orch.finish();
        }
      });

      const result = await orch.start();

      // The first failure was classified as a timeout (signaled distinctly).
      expect(sawTimeoutCard).toBe(true);
      expect(result.manifest.status).toBe('done');
      expect(spawnCounts.get(1)).toBe(2);
      const card = result.agents.find((a) => a.agentId === 1)!;
      expect(card.state).toBe('done');
      expect(card.errorKind).toBeUndefined();
      expect(card.commitSha).toBeDefined();
      expect(card.manualRetries).toBe(1);
      expect(result.integration.branchesMerged).toHaveLength(1);
    },
    20_000,
  );

  it(
    'without interactiveRetry the run does NOT hold open — a failed card resolves straight to done',
    async () => {
      const pipeline: Pipeline = {
        name: 'no-hold',
        maxRetries: 0,
        steps: [{ name: 'stage1', prompt: 'p $file', files: ['a.ts', 'b.ts'] }],
      };
      const { factory } = makeRetryFactory((agentId, spawnCount) =>
        agentId === 1 && spawnCount === 1 ? { kind: 'fail' } : { kind: 'succeed' },
      );

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false },
      );

      let sawAwaitingRetry = false;
      orch.subscribe((state) => {
        if (state.status === 'awaiting_retry') sawAwaitingRetry = true;
      });

      // No retry wiring at all — start() must still resolve on its own.
      const result = await orch.start();

      expect(sawAwaitingRetry).toBe(false);
      expect(result.manifest.status).toBe('done');
      const a = result.agents.find((x) => x.agentId === 1)!;
      expect(a.state).toBe('error');
      expect(a.manualRetries).toBeUndefined();
    },
    20_000,
  );
});
