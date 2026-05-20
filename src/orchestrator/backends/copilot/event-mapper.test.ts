import { describe, it, expect } from 'vitest';
import { createCopilotEventTranslator } from './event-mapper.js';
import type { AgentEvent } from '../../types.js';

describe('createCopilotEventTranslator', () => {
  function harness(): {
    events: AgentEvent[];
    emit: (e: AgentEvent) => void;
    translate: (event: unknown) => void;
  } {
    const events: AgentEvent[] = [];
    const translator = createCopilotEventTranslator();
    const emit = (e: AgentEvent): void => {
      events.push(e);
    };
    return {
      events,
      emit,
      translate: (event: unknown) => translator(event, emit),
    };
  }

  it('ignores non-objects', () => {
    const { events, translate } = harness();
    translate(null);
    translate('x');
    expect(events).toEqual([]);
  });

  it('assistant.message → log with content', () => {
    const { events, translate } = harness();
    translate({
      type: 'assistant.message',
      data: { content: 'hello world', messageId: 'm1' },
    });
    expect(events).toEqual([{ type: 'log', message: 'hello world' }]);
  });

  it('assistant.message with empty content is dropped', () => {
    const { events, translate } = harness();
    translate({ type: 'assistant.message', data: { content: '' } });
    expect(events).toEqual([]);
  });

  it('assistant.message truncates very long content', () => {
    const { events, translate } = harness();
    const long = 'x'.repeat(2000);
    translate({ type: 'assistant.message', data: { content: long } });
    expect(events).toHaveLength(1);
    const msg = (events[0] as { message: string }).message;
    expect(msg.length).toBeLessThan(700);
    expect(msg).toMatch(/\(\+\d+ chars\)$/);
  });

  it('tool.execution_start with edit_file → state_change + log + file_write', () => {
    const { events, translate } = harness();
    translate({
      type: 'tool.execution_start',
      data: {
        toolCallId: 't-1',
        toolName: 'edit_file',
        arguments: { path: 'src/foo.ts' },
      },
    });
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: edit_file → src/foo.ts' },
      { type: 'file_write', file: 'src/foo.ts' },
    ]);
  });

  it('tool.execution_start with view → no file_write', () => {
    const { events, translate } = harness();
    translate({
      type: 'tool.execution_start',
      data: {
        toolCallId: 't-2',
        toolName: 'view',
        arguments: { path: 'src/foo.ts' },
      },
    });
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: view → src/foo.ts' },
    ]);
  });

  it('tool.execution_complete resolves toolName via toolCallId from execution_start', () => {
    // The SDK's ToolExecutionCompleteData carries only `toolCallId` —
    // the translator must remember the name from the matching
    // execution_start event.
    const { events, translate } = harness();
    translate({
      type: 'tool.execution_start',
      data: { toolCallId: 't-x', toolName: 'edit_file', arguments: {} },
    });
    events.length = 0; // discard start-event noise
    translate({
      type: 'tool.execution_complete',
      data: {
        toolCallId: 't-x',
        success: false,
        error: { message: 'permission denied' },
      },
    });
    expect(events).toEqual([
      { type: 'state_change', state: 'streaming' },
      {
        type: 'log',
        level: 'error',
        message: 'tool error: edit_file — permission denied',
      },
    ]);
  });

  it('tool.execution_complete falls back to <unknown> when start was missed', () => {
    // Resumed-session edge case: complete without a matching start.
    const { events, translate } = harness();
    translate({
      type: 'tool.execution_complete',
      data: { toolCallId: 't-orphan', success: true },
    });
    expect(events).toEqual([
      { type: 'state_change', state: 'streaming' },
      { type: 'log', message: 'tool done: <unknown>' },
    ]);
  });

  it('tool.execution_complete success=true → "tool done" log with name', () => {
    const { events, translate } = harness();
    translate({
      type: 'tool.execution_start',
      data: { toolCallId: 't-y', toolName: 'bash', arguments: {} },
    });
    events.length = 0;
    translate({
      type: 'tool.execution_complete',
      data: { toolCallId: 't-y', success: true },
    });
    expect(events).toEqual([
      { type: 'state_change', state: 'streaming' },
      { type: 'log', message: 'tool done: bash' },
    ]);
  });

  it('toolName map is per-translator (no cross-session leak)', () => {
    const a = harness();
    const b = harness();
    a.translate({
      type: 'tool.execution_start',
      data: { toolCallId: 'shared', toolName: 'foo', arguments: {} },
    });
    a.events.length = 0;
    b.events.length = 0;
    b.translate({
      type: 'tool.execution_complete',
      data: { toolCallId: 'shared', success: true },
    });
    expect(b.events).toEqual([
      { type: 'state_change', state: 'streaming' },
      { type: 'log', message: 'tool done: <unknown>' },
    ]);
  });

  it('assistant.usage with cost emits structured usage + premium-request log', () => {
    const { events, translate } = harness();
    translate({
      type: 'assistant.usage',
      data: {
        inputTokens: 1500,
        outputTokens: 300,
        cost: 0.5,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      },
    });
    // Order: structured `usage` first (orchestrator accumulates),
    // then `log` for the dashboard.
    expect(events).toEqual([
      {
        type: 'usage',
        inputTokens: 1500,
        outputTokens: 300,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        cost: 0.5,
        model: undefined,
      },
      {
        type: 'log',
        message: 'tokens +1500in +300out (cacheR=100 cacheW=50) 0.50pr',
      },
    ]);
  });

  it('assistant.usage without cache fields skips cache suffix', () => {
    const { events, translate } = harness();
    translate({
      type: 'assistant.usage',
      data: { inputTokens: 100, outputTokens: 20, cost: 0 },
    });
    expect(events).toEqual([
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: undefined,
        model: undefined,
      },
      { type: 'log', message: 'tokens +100in +20out' },
    ]);
  });

  it('assistant.usage includes duration and model when present', () => {
    const { events, translate } = harness();
    translate({
      type: 'assistant.usage',
      data: {
        inputTokens: 100,
        outputTokens: 20,
        cost: 0,
        duration: 2500,
        model: 'claude-sonnet-4.6',
      },
    });
    expect(events).toEqual([
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: undefined,
        model: 'claude-sonnet-4.6',
      },
      { type: 'log', message: 'tokens +100in +20out 2.5s [claude-sonnet-4.6]' },
    ]);
  });

  it('assistant.intent → log "intent: ..."', () => {
    const { events, translate } = harness();
    translate({
      type: 'assistant.intent',
      data: { intent: 'refactor file X' },
    });
    expect(events).toEqual([{ type: 'log', message: 'intent: refactor file X' }]);
  });

  it('tool.execution_progress → log with leading 2-space indent', () => {
    const { events, translate } = harness();
    translate({
      type: 'tool.execution_progress',
      data: { toolCallId: 't1', progressMessage: 'installing deps...' },
    });
    expect(events).toEqual([{ type: 'log', message: '  installing deps...' }]);
  });

  it('tool.execution_partial_result → log with pipe prefix, first line only', () => {
    const { events, translate } = harness();
    translate({
      type: 'tool.execution_partial_result',
      data: {
        toolCallId: 't2',
        partialOutput: 'line one\nline two\nline three',
      },
    });
    expect(events).toEqual([{ type: 'log', message: '  | line one' }]);
  });

  it('tool.execution_partial_result drops empty/whitespace chunks', () => {
    const { events, translate } = harness();
    translate({
      type: 'tool.execution_partial_result',
      data: { partialOutput: '   ' },
    });
    expect(events).toEqual([]);
  });

  it('subagent.started → log with display name', () => {
    const { events, translate } = harness();
    translate({
      type: 'subagent.started',
      data: { agentName: 'tester', agentDisplayName: 'Test Runner' },
    });
    expect(events).toEqual([
      { type: 'log', message: 'subagent started: Test Runner' },
    ]);
  });

  it('subagent.completed → log', () => {
    const { events, translate } = harness();
    translate({ type: 'subagent.completed', data: { agentName: 'tester' } });
    expect(events).toEqual([{ type: 'log', message: 'subagent done: tester' }]);
  });

  it('subagent.failed → error-level log with reason', () => {
    const { events, translate } = harness();
    translate({
      type: 'subagent.failed',
      data: { agentName: 'tester', error: { message: 'oom' } },
    });
    expect(events).toEqual([
      { type: 'log', level: 'error', message: 'subagent failed: tester — oom' },
    ]);
  });

  it('session.compaction_start → warn log', () => {
    const { events, translate } = harness();
    translate({ type: 'session.compaction_start', data: {} });
    expect(events).toEqual([
      {
        type: 'log',
        level: 'warn',
        message: 'auto-compaction: starting (context limit approaching)',
      },
    ]);
  });

  it('session.compaction_complete success → info log derived from pre/post tokens', () => {
    // Real SDK shape: success implied by absence of `error`,
    // tokensRemoved derived from preCompactionTokens - postCompactionTokens.
    const { events, translate } = harness();
    translate({
      type: 'session.compaction_complete',
      data: {
        preCompactionTokens: 18_000,
        postCompactionTokens: 13_000,
        messagesRemoved: 12,
      },
    });
    expect(events).toEqual([
      {
        type: 'log',
        level: 'info',
        message: 'auto-compaction: done (-5000 tokens, -12 msgs)',
      },
    ]);
  });

  it('session.compaction_complete with error → warn log including error text', () => {
    const { events, translate } = harness();
    translate({
      type: 'session.compaction_complete',
      data: {
        error: 'rate limit',
        preCompactionTokens: 0,
        postCompactionTokens: 0,
      },
    });
    expect(events).toEqual([
      {
        type: 'log',
        level: 'warn',
        message: 'auto-compaction: failed (-0 tokens, -0 msgs) — rate limit',
      },
    ]);
  });

  it('session.usage_info under 80% emits nothing', () => {
    const { events, translate } = harness();
    translate({
      type: 'session.usage_info',
      data: { tokenLimit: 200_000, currentTokens: 100_000 },
    });
    expect(events).toEqual([]);
  });

  it('session.usage_info over 80% emits warn log', () => {
    const { events, translate } = harness();
    translate({
      type: 'session.usage_info',
      data: { tokenLimit: 200_000, currentTokens: 170_000 },
    });
    expect(events).toEqual([
      {
        type: 'log',
        level: 'warn',
        message: 'context: 170000/200000 tokens (85%) — compaction approaching',
      },
    ]);
  });

  it('session.context_changed → log of cwd/branch', () => {
    const { events, translate } = harness();
    translate({
      type: 'session.context_changed',
      data: { cwd: '/some/path', branch: 'main' },
    });
    expect(events).toEqual([
      { type: 'log', message: 'context: cwd=/some/path branch=main' },
    ]);
  });

  it('session.task_complete with summary → log', () => {
    const { events, translate } = harness();
    translate({
      type: 'session.task_complete',
      data: { summary: 'Refactored auth.ts' },
    });
    expect(events).toEqual([
      { type: 'log', message: 'task complete: Refactored auth.ts' },
    ]);
  });

  it('session.shutdown aggregates premium-request cost across modelMetrics', () => {
    // Real SDK shape (ShutdownData.modelMetrics): keyed by model,
    // each entry has requests.cost. Top-level totalPremiumRequests
    // does NOT exist — derive via summation.
    const { events, translate } = harness();
    translate({
      type: 'session.shutdown',
      data: {
        shutdownType: 'routine',
        codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] },
        modelMetrics: {
          'claude-sonnet-4.6': {
            requests: { cost: 2.0, count: 4 },
            usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
          'gpt-5.4-nano': {
            requests: { cost: 1.5, count: 3 },
            usage: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
      },
    });
    // codeChanges with all zeros emits one log; aggregated cost emits another.
    expect(events).toEqual([
      { type: 'log', message: 'shutdown: +0/-0 lines, 0 file(s)' },
      { type: 'log', message: 'shutdown: 3.50pr total' },
    ]);
  });

  it('session.error → error AgentEvent', () => {
    const { events, translate } = harness();
    translate({
      type: 'session.error',
      data: { message: 'rate_limit', errorType: 'rate_limit' },
    });
    expect(events).toEqual([{ type: 'error', message: 'rate_limit' }]);
  });

  it('session.idle emits NOTHING — factory observes it directly to resolve done', () => {
    // Regression guard: an earlier version emitted state_change('streaming')
    // here, which was the wrong semantic (idle = "turn done", not
    // "back to streaming"). The factory hooks `session.idle` itself
    // to resolve prompt(); the mapper must stay quiet.
    const { events, translate } = harness();
    translate({ type: 'session.idle', data: {} });
    expect(events).toEqual([]);
  });

  it('session.shutdown with codeChanges emits summary log (filesModified is string[])', () => {
    const { events, translate } = harness();
    translate({
      type: 'session.shutdown',
      data: {
        shutdownType: 'routine',
        codeChanges: {
          linesAdded: 50,
          linesRemoved: 10,
          // Real SDK shape: filesModified is a list of paths, not a count.
          filesModified: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        },
        modelMetrics: {},
      },
    });
    expect(events).toEqual([
      { type: 'log', message: 'shutdown: +50/-10 lines, 3 file(s)' },
    ]);
  });

  it('abort event → warn log', () => {
    const { events, translate } = harness();
    translate({ type: 'abort', data: { reason: 'user_exit' } });
    expect(events).toEqual([
      { type: 'log', level: 'warn', message: 'abort: user_exit' },
    ]);
  });

  it('unknown event types are silently ignored', () => {
    const { events, translate } = harness();
    translate({ type: 'bizarre.future_event', data: { x: 1 } });
    expect(events).toEqual([]);
  });
});
