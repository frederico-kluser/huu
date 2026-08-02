import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import { evaluateCheckStep } from './check-evaluator.js';
import type { AgentFactory } from './types.js';
import type { CheckStep, Pipeline } from '../lib/types.js';
import type { KeyPoolHandle } from '../lib/api-key-pool.js';
import type { ProviderErrorKind } from '../lib/provider-error.js';

/**
 * Per-ATTEMPT key rotation, and the part that actually pays for itself: the
 * ROTATION GRANT.
 *
 * With `DEFAULT_MAX_RETRIES = 1` a task gets two attempts total, so a single
 * 429 consumes the entire retry budget and the card errors — the retry was
 * meant to absorb a bad ANSWER, not a busy key. Each rotation therefore grants
 * one EXTRA attempt, capped at `keyPool.size() - 1`.
 *
 * The pool handle is faked here on purpose: `api-key-pool.ts` has its own
 * tests for round-robin/burn/cooldown, and what needs pinning at this layer is
 * the ORCHESTRATOR wiring — which key each attempt uses, and whose budget the
 * extra attempt comes out of.
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

/** Round-robin over `keys`; reports a rotation while an unused key remains. */
function fakePool(keys: string[]): KeyPoolHandle & { reports: Array<[ProviderErrorKind, string]> } {
  let index = 0;
  const reports: Array<[ProviderErrorKind, string]> = [];
  return {
    reports,
    size: () => keys.length,
    current: () => keys[index]!,
    report(kind, key) {
      reports.push([kind, key]);
      if (kind === 'other') return false;
      if (index + 1 >= keys.length) return false;
      index++;
      return true;
    },
  };
}

/**
 * Fails the first `failures.length` prompts with the given messages, then
 * succeeds. Records the api key each attempt was configured with.
 */
function makeFactory(failures: string[]): { factory: AgentFactory; keysUsed: string[] } {
  const keysUsed: string[] = [];
  let attempt = 0;
  const factory: AgentFactory = async (task, config, _hint, cwd, onEvent) => {
    keysUsed.push(config.apiKey);
    const thisAttempt = attempt++;
    return {
      agentId: task.agentId,
      task,
      async prompt(): Promise<void> {
        onEvent({ type: 'state_change', state: 'streaming' });
        const failure = failures[thisAttempt];
        if (failure) throw new Error(failure);
        writeFileSync(join(cwd, `a${task.agentId}.txt`), 'content\n', 'utf8');
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {},
    };
  };
  return { factory, keysUsed };
}

function pipeline(maxRetries: number): Pipeline {
  return {
    name: 'key-rotation',
    maxRetries,
    steps: [{ type: 'work', name: 'stage1', prompt: 'p $file', files: ['a.ts'] }],
  };
}

describe('per-attempt API key rotation', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'key-rotation-'));
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
    'a 429 on key A rotates to key B — and the extra attempt does NOT come out of the retry budget',
    async () => {
      // maxRetries: 0 ⇒ ONE attempt is all the pipeline pays for. The second
      // attempt can only exist because the rotation granted it.
      const pool = fakePool(['sk-A', 'sk-B']);
      const { factory, keysUsed } = makeFactory(['HTTP 429 rate limit exceeded']);

      const orch = new Orchestrator(
        { apiKey: 'sk-A', modelId: 'stub-model', backend: 'stub' },
        pipeline(0),
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false, keyPool: pool },
      );
      const result = await orch.start();
      const agent = result.agents[0]!;

      expect(keysUsed).toEqual(['sk-A', 'sk-B']);
      expect(pool.reports).toEqual([['rate_limit', 'sk-A']]);
      expect(agent.state).toBe('done');
      expect(agent.commitSha).toBeDefined();
      expect(result.integration.branchesMerged).toHaveLength(1);
    },
    30_000,
  );

  it(
    'the granted attempt is ADDITIVE — a later genuine failure still gets its normal retry',
    async () => {
      const pool = fakePool(['sk-A', 'sk-B']);
      // 1: rate-limited (rotates, +1 attempt). 2: a real failure on key B
      // (classified `other`, no grant) consuming the pipeline's own retry.
      // 3: succeeds — only reachable if both budgets were counted separately.
      const { factory, keysUsed } = makeFactory(['429 Too Many Requests', 'model exploded']);

      const orch = new Orchestrator(
        { apiKey: 'sk-A', modelId: 'stub-model', backend: 'stub' },
        pipeline(1),
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false, keyPool: pool },
      );
      const result = await orch.start();

      expect(keysUsed).toEqual(['sk-A', 'sk-B', 'sk-B']);
      expect(result.agents[0]!.state).toBe('done');
    },
    30_000,
  );

  it(
    'grants are capped at pool size − 1: a 2-key pool absorbs one 429, not two',
    async () => {
      const pool = fakePool(['sk-A', 'sk-B']);
      const { factory, keysUsed } = makeFactory(['429 rate limit', '429 rate limit']);

      const orch = new Orchestrator(
        { apiKey: 'sk-A', modelId: 'stub-model', backend: 'stub' },
        pipeline(0),
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false, keyPool: pool },
      );
      const result = await orch.start();
      const agent = result.agents[0]!;

      expect(keysUsed).toEqual(['sk-A', 'sk-B']);
      expect(agent.state).toBe('error');
      expect(agent.errorKind).toBe('failed');
    },
    30_000,
  );

  it(
    'a pool of ONE behaves exactly as today: the key flows through, nothing rotates, no extra attempt',
    async () => {
      const pool = fakePool(['sk-ONLY']);
      const { factory, keysUsed } = makeFactory(['HTTP 429 rate limit']);

      const orch = new Orchestrator(
        { apiKey: 'sk-ONLY', modelId: 'stub-model', backend: 'stub' },
        pipeline(0),
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false, keyPool: pool },
      );
      const result = await orch.start();

      expect(keysUsed).toEqual(['sk-ONLY']);
      expect(result.agents[0]!.state).toBe('error');
    },
    30_000,
  );

  it(
    'without a keyPool the run is byte-identical: AppConfig.apiKey, one attempt, no rotation',
    async () => {
      const { factory, keysUsed } = makeFactory(['HTTP 429 rate limit']);

      const orch = new Orchestrator(
        { apiKey: 'sk-CONFIG', modelId: 'stub-model', backend: 'stub' },
        pipeline(0),
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false },
      );
      const result = await orch.start();

      expect(keysUsed).toEqual(['sk-CONFIG']);
      expect(result.agents[0]!.state).toBe('error');
    },
    30_000,
  );

  it(
    'a non-provider failure never touches the pool',
    async () => {
      const pool = fakePool(['sk-A', 'sk-B']);
      const { factory, keysUsed } = makeFactory(['ENOENT: no such file']);

      const orch = new Orchestrator(
        { apiKey: 'sk-A', modelId: 'stub-model', backend: 'stub' },
        pipeline(0),
        scratch,
        factory,
        { initialConcurrency: 1, autoScale: false, keyPool: pool },
      );
      await orch.start();

      expect(pool.reports).toEqual([]);
      expect(keysUsed).toEqual(['sk-A']);
    },
    30_000,
  );
});

/**
 * The judge is the system's worst silent-failure surface: it has no retry loop
 * of its own and every CheckStep's default outcome points FORWARD, so a judge
 * that takes a 429 APPROVES in silence. One rotation is the whole fix.
 */
describe('CheckStep judge key rotation', () => {
  const STEP: CheckStep = {
    type: 'check',
    name: 'gate',
    condition: 'is it good',
    outcomes: [
      { label: 'approved', nextStepName: 'seal', default: true },
      { label: 'rework', nextStepName: 'fix' },
    ],
  };

  function judgeFactory(failures: string[]): { factory: AgentFactory; keysUsed: string[] } {
    const keysUsed: string[] = [];
    let attempt = 0;
    const factory: AgentFactory = async (task, config, _hint, _cwd, onEvent) => {
      keysUsed.push(config.apiKey);
      const thisAttempt = attempt++;
      return {
        agentId: task.agentId,
        task,
        async prompt(): Promise<void> {
          const failure = failures[thisAttempt];
          if (failure) throw new Error(failure);
          onEvent({ type: 'log', message: '```json\n{"label":"rework","reason":"tests red"}\n```' });
          onEvent({ type: 'done' });
        },
        async abort(): Promise<void> {},
        async dispose(): Promise<void> {},
      };
    };
    return { factory, keysUsed };
  }

  it('retries ONCE on a rotated key instead of silently taking the default outcome', async () => {
    const pool = fakePool(['sk-A', 'sk-B']);
    const { factory, keysUsed } = judgeFactory(['HTTP 429 rate limit']);
    const events: string[] = [];

    const result = await evaluateCheckStep({
      step: STEP,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      runId: 'r',
      config: { apiKey: 'sk-A', modelId: 'stub' },
      factory,
      keyPool: pool,
      onReservedLifecycle: (ev, id) => events.push(`${ev}:${id}`),
      onEvent: () => {},
    });

    expect(keysUsed).toEqual(['sk-A', 'sk-B']);
    // The real verdict was reached — NOT the forward default.
    expect(result.label).toBe('rework');
    expect(result.fromJudge).toBe(true);
    // Both attempts announced their reserved slot symmetrically.
    expect(events).toEqual(['spawn:9998', 'exit:9998', 'spawn:9998', 'exit:9998']);
  });

  it('gets exactly ONE rotation — a second failure falls back to the default outcome', async () => {
    const pool = fakePool(['sk-A', 'sk-B', 'sk-C']);
    const { factory, keysUsed } = judgeFactory(['429 rate limit', '429 rate limit']);

    const result = await evaluateCheckStep({
      step: STEP,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      runId: 'r',
      config: { apiKey: 'sk-A', modelId: 'stub' },
      factory,
      keyPool: pool,
      onEvent: () => {},
    });

    expect(keysUsed).toEqual(['sk-A', 'sk-B']);
    expect(result.label).toBe('approved');
    expect(result.fromJudge).toBe(false);
  });

  it('never burns a key from here: an auth-looking failure is not reported', async () => {
    // Burning is permanent and `classifyProviderError` is a string heuristic,
    // so the double-gated burn lives on the worker path, not here.
    const pool = fakePool(['sk-A', 'sk-B']);
    const { factory, keysUsed } = judgeFactory(['HTTP 401 unauthorized']);

    await evaluateCheckStep({
      step: STEP,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      runId: 'r',
      config: { apiKey: 'sk-A', modelId: 'stub' },
      factory,
      keyPool: pool,
      onEvent: () => {},
    });

    expect(pool.reports).toEqual([]);
    expect(keysUsed).toEqual(['sk-A']);
  });

  it('without a keyPool the judge path is unchanged — one attempt, config key', async () => {
    const { factory, keysUsed } = judgeFactory([]);
    const result = await evaluateCheckStep({
      step: STEP,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      runId: 'r',
      config: { apiKey: 'sk-CONFIG', modelId: 'stub' },
      factory,
      onEvent: () => {},
    });
    expect(keysUsed).toEqual(['sk-CONFIG']);
    expect(result.label).toBe('rework');
  });
});
