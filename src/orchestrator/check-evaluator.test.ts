import { describe, it, expect } from 'vitest';
import { evaluateCheckStep, extractVerdict } from './check-evaluator.js';
import type { AgentFactory } from './types.js';
import type { CheckStep } from '../lib/types.js';

const STEP: CheckStep = {
  type: 'check',
  name: 'gate',
  condition: 'coverage above 60% on attempt $runs',
  outcomes: [
    { label: 'ok', nextStepName: 'release', default: true },
    { label: 'low', nextStepName: 'fix-tests' },
  ],
};

function factoryEmitting(text: string): AgentFactory {
  return async (task, _config, _hint, _cwd, onEvent) => ({
    agentId: task.agentId,
    task,
    async prompt(_message: string): Promise<void> {
      onEvent({ type: 'log', message: text });
      onEvent({ type: 'done' });
    },
    async abort(): Promise<void> {},
    async dispose(): Promise<void> {},
  });
}

describe('check-evaluator', () => {
  it('extracts verdict from a fenced JSON block', () => {
    const text = 'I ran tests.\n```json\n{"label": "ok", "reason": "75%"}\n```\nDone.';
    expect(extractVerdict(text)).toEqual({ label: 'ok', reason: '75%' });
  });

  it('extracts verdict from inline brace block', () => {
    const text = 'verdict: {"label":"low","reason":"only 42%"}';
    expect(extractVerdict(text)).toEqual({ label: 'low', reason: 'only 42%' });
  });

  it('returns null when no JSON', () => {
    expect(extractVerdict('no verdict here')).toBeNull();
  });

  it('picks the LAST verdict when multiple appear', () => {
    const text = '```json\n{"label":"ok"}\n```\nactually:\n```json\n{"label":"low"}\n```';
    expect(extractVerdict(text)?.label).toBe('low');
  });

  it('routes to outcome when judge produces a valid label', async () => {
    const result = await evaluateCheckStep({
      step: STEP,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      runId: 'r',
      config: { apiKey: 'stub', modelId: 'stub' },
      factory: factoryEmitting('```json\n{"label":"low","reason":"42%"}\n```'),
      onEvent: () => {},
    });
    expect(result.label).toBe('low');
    expect(result.nextStepName).toBe('fix-tests');
    expect(result.fromJudge).toBe(true);
    expect(result.resolvedCondition).toContain('attempt 1');
  });

  it('captures a verdict STREAMED as assistant deltas (real pi backend), ignoring the thinking channel', async () => {
    // The pi backend surfaces the judge's answer as `stream`/assistant deltas,
    // NOT `log` events. Regression for the bug where every CheckStep silently
    // fell back to its default outcome because the verdict was never collected.
    const streaming: AgentFactory = async (task, _config, _hint, _cwd, onEvent) => ({
      agentId: task.agentId,
      task,
      async prompt(_message: string): Promise<void> {
        onEvent({ type: 'log', message: 'tool: read → coverage.json' });
        // A red herring on the THINKING channel must be ignored (only the
        // assistant answer carries the real verdict).
        onEvent({ type: 'stream', channel: 'thinking', delta: '{"label":"ok"}' });
        for (const delta of ['Looks low.\n', '```json\n', '{"label": "low", ', '"reason": "42%"}\n', '```']) {
          onEvent({ type: 'stream', channel: 'assistant', delta });
        }
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {},
    });
    const result = await evaluateCheckStep({
      step: STEP,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      runId: 'r',
      config: { apiKey: 'stub', modelId: 'stub' },
      factory: streaming,
      onEvent: () => {},
    });
    expect(result.label).toBe('low');
    expect(result.fromJudge).toBe(true);
  });

  it('falls back to default when verdict is invalid', async () => {
    const result = await evaluateCheckStep({
      step: STEP,
      runs: 3,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      runId: 'r',
      config: { apiKey: 'stub', modelId: 'stub' },
      factory: factoryEmitting('the judge mumbles incoherently'),
      onEvent: () => {},
    });
    expect(result.label).toBe('ok');
    expect(result.nextStepName).toBe('release');
    expect(result.fromJudge).toBe(false);
    expect(result.resolvedCondition).toContain('attempt 3');
  });

  it('surfaces the run base commit to the judge so it can diff what the run changed', async () => {
    let captured = '';
    const capturing: AgentFactory = async (task, _config, systemPrompt, _cwd, onEvent) => ({
      agentId: task.agentId,
      task,
      async prompt(message: string): Promise<void> {
        captured = `${systemPrompt}\n${message}`;
        onEvent({ type: 'log', message: '```json\n{"label":"ok"}\n```' });
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {},
    });
    await evaluateCheckStep({
      step: STEP,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      baseCommit: 'deadbeefcafe',
      runId: 'r',
      config: { apiKey: 'stub', modelId: 'stub' },
      factory: capturing,
      onEvent: () => {},
    });
    expect(captured).toContain('deadbeefcafe');
    expect(captured).toContain('git diff --name-only deadbeefcafe..HEAD');
  });

  it('substitutes $baseCommit in the condition so the judge gets a real diff range, not an unset shell var', async () => {
    const step: CheckStep = {
      type: 'check',
      name: 'freeze',
      condition: 'run `git diff --name-only $baseCommit..HEAD` on attempt $runs',
      outcomes: [
        { label: 'approved', nextStepName: 'done', default: true },
        { label: 'rework', nextStepName: 'fix' },
      ],
    };
    const result = await evaluateCheckStep({
      step,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      baseCommit: 'deadbeefcafe',
      runId: 'r',
      config: { apiKey: 'stub', modelId: 'stub' },
      factory: factoryEmitting('```json\n{"label":"approved"}\n```'),
      onEvent: () => {},
    });
    expect(result.resolvedCondition).toContain('git diff --name-only deadbeefcafe..HEAD');
    // No literal token survives — otherwise a shell would expand it to empty.
    expect(result.resolvedCondition).not.toContain('$baseCommit');
  });

  it('omits the base-commit line when no baseCommit is provided', async () => {
    let captured = '';
    const capturing: AgentFactory = async (task, _config, systemPrompt, _cwd, onEvent) => ({
      agentId: task.agentId,
      task,
      async prompt(message: string): Promise<void> {
        captured = `${systemPrompt}\n${message}`;
        onEvent({ type: 'log', message: '```json\n{"label":"ok"}\n```' });
        onEvent({ type: 'done' });
      },
      async abort(): Promise<void> {},
      async dispose(): Promise<void> {},
    });
    await evaluateCheckStep({
      step: STEP,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      runId: 'r',
      config: { apiKey: 'stub', modelId: 'stub' },
      factory: capturing,
      onEvent: () => {},
    });
    expect(captured).not.toContain('Run base commit');
  });

  it('falls back to default when judge label is unknown', async () => {
    const result = await evaluateCheckStep({
      step: STEP,
      runs: 1,
      repoRoot: '/tmp',
      integrationWorktreePath: '/tmp',
      integrationBranch: 'b',
      runId: 'r',
      config: { apiKey: 'stub', modelId: 'stub' },
      factory: factoryEmitting('```json\n{"label":"weird","reason":""}\n```'),
      onEvent: () => {},
    });
    expect(result.label).toBe('ok');
    expect(result.fromJudge).toBe(false);
  });
});
