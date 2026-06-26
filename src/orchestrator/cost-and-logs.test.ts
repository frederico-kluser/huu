import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orchestrator } from './index.js';
import { THINKING_LOG_PREFIX } from './types.js';
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
 * Living spec for two web-dashboard behaviors that both ride the
 * `handleAgentEvent` → `getState()` funnel:
 *
 *  1. The header cost is the LIVE sum of every per-card cost — `getState()`
 *     must add up `AgentStatus.cost` (which accumulates the backend's
 *     authoritative `usage.cost`), not return a hardcoded 0.
 *  2. The reasoning ("thinking") stream lands in the per-agent log (tagged),
 *     so a card's drawer mirrors the browser-console firehose — while the
 *     GLOBAL run log stays free of the verbose trace.
 *
 * The only seam is the `onEvent` callback the orchestrator hands the factory,
 * so a factory emitting a known event script is the spec.
 */
describe('per-agent cost sum + thinking-in-card-logs', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'cost-logs-test-'));
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
    'sums every per-card cost into getState().totalCost in real time',
    async () => {
      // Two files → two agents; each reports TWO usage events so cost must
      // ACCUMULATE per card (0.0123 + 0.0001 = 0.0124), and the header total
      // must SUM the cards (0.0248) — proving it is no longer hardcoded 0.
      const factory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
        agentId: task.agentId,
        task,
        async prompt(): Promise<void> {
          writeFileSync(join(cwd, `out-${task.agentId}.txt`), 'x\n', 'utf8');
          onEvent({ type: 'file_write', file: `out-${task.agentId}.txt` });
          onEvent({ type: 'usage', inputTokens: 100, outputTokens: 50, cost: 0.0123 });
          onEvent({ type: 'usage', inputTokens: 10, outputTokens: 5, cost: 0.0001 });
          onEvent({ type: 'done' });
        },
        async abort(): Promise<void> {},
        async dispose(): Promise<void> {},
      });

      const pipeline: Pipeline = {
        name: 'cost-sum',
        steps: [{ name: 'stage1', prompt: 'p', files: ['a.ts', 'b.ts'] }],
      };

      const orch = new Orchestrator(
        { apiKey: 'stub', modelId: 'stub-model', backend: 'stub' },
        pipeline,
        scratch,
        factory,
        { initialConcurrency: 2, autoScale: false },
      );

      const result = await orch.start();
      expect(result.manifest.status).toBe('done');
      // The headless result's totalCost mirrors the live web aggregate.
      expect(result.totalCost).toBeCloseTo(0.0248, 6);

      const state = orch.getState();
      const costed = state.agents.filter((a) => a.cost > 0);
      expect(costed).toHaveLength(2);
      for (const a of costed) expect(a.cost).toBeCloseTo(0.0124, 6);

      // The header reads state.totalCost: it must equal the live sum of cards…
      expect(state.totalCost).toBeCloseTo(0.0248, 6);
      // …and be derived from the cards, never the old `totalCost: 0`.
      expect(state.totalCost).toBe(
        +state.agents.reduce((s, a) => s + a.cost, 0).toFixed(4),
      );
      expect(state.totalCost).toBeGreaterThan(0);
    },
    20_000,
  );

  it(
    'routes the thinking stream into the per-agent log (tagged) but keeps it out of the global run log',
    async () => {
      const factory: AgentFactory = async (task, _config, _hint, cwd, onEvent) => ({
        agentId: task.agentId,
        task,
        async prompt(): Promise<void> {
          // Whole lines (newline-terminated) so the coalescer emits them.
          onEvent({ type: 'stream', channel: 'assistant', delta: 'visible reply line\n' });
          onEvent({ type: 'stream', channel: 'thinking', delta: 'secret reasoning line\n' });
          writeFileSync(join(cwd, 'out.txt'), 'x\n', 'utf8');
          onEvent({ type: 'file_write', file: 'out.txt' });
          onEvent({ type: 'done' });
        },
        async abort(): Promise<void> {},
        async dispose(): Promise<void> {},
      });

      const pipeline: Pipeline = {
        name: 'stream-logs',
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

      const state = orch.getState();
      const agent = state.agents.find((a) => a.logs.includes('visible reply line'));
      expect(agent).toBeDefined();

      // Reply text verbatim; reasoning trace present but TAGGED (mirrors the
      // console firehose), never as its own bare line.
      expect(agent!.logs).toContain('visible reply line');
      expect(agent!.logs).toContain(`${THINKING_LOG_PREFIX}secret reasoning line`);
      expect(agent!.logs).not.toContain('secret reasoning line');

      // The global run log carries the reply but NOT the reasoning trace.
      const globalMsgs = state.logs.map((l) => l.message);
      expect(globalMsgs).toContain('visible reply line');
      expect(globalMsgs.some((m) => m.includes('secret reasoning line'))).toBe(false);
    },
    20_000,
  );
});
