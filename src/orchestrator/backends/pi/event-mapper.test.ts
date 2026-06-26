import { describe, it, expect, vi } from 'vitest';
import { translatePiEvent } from './event-mapper.js';
import type { AgentEvent } from '../../types.js';

describe('translatePiEvent', () => {
  function collect(): { events: AgentEvent[]; emit: (e: AgentEvent) => void } {
    const events: AgentEvent[] = [];
    return { events, emit: (e) => events.push(e) };
  }

  it('ignores null/undefined/non-objects', () => {
    const { events, emit } = collect();
    translatePiEvent(null, emit);
    translatePiEvent(undefined, emit);
    translatePiEvent('foo', emit);
    translatePiEvent(42, emit);
    expect(events).toEqual([]);
  });

  it('agent_start → state_change(streaming) + log "agent started"', () => {
    const { events, emit } = collect();
    translatePiEvent({ type: 'agent_start' }, emit);
    expect(events).toEqual([
      { type: 'state_change', state: 'streaming' },
      { type: 'log', message: 'agent started' },
    ]);
  });

  it('tool_execution_start with write tool + path → 3 events including file_write', () => {
    const { events, emit } = collect();
    translatePiEvent(
      { type: 'tool_execution_start', toolName: 'edit', args: { path: 'src/foo.ts' } },
      emit,
    );
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: edit → src/foo.ts' },
      { type: 'file_write', file: 'src/foo.ts' },
    ]);
  });

  it('tool_execution_start with read tool → no file_write', () => {
    const { events, emit } = collect();
    translatePiEvent(
      { type: 'tool_execution_start', toolName: 'read', args: { path: 'src/foo.ts' } },
      emit,
    );
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: read → src/foo.ts' },
    ]);
  });

  it('tool_execution_end with isError → error-level log', () => {
    const { events, emit } = collect();
    translatePiEvent({ type: 'tool_execution_end', toolName: 'edit', isError: true }, emit);
    expect(events).toEqual([
      { type: 'state_change', state: 'streaming' },
      { type: 'log', level: 'error', message: 'tool error: edit' },
    ]);
  });

  it('message_update text_delta → stream(assistant)', () => {
    const { events, emit } = collect();
    translatePiEvent(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello ', contentIndex: 0 },
      },
      emit,
    );
    expect(events).toEqual([{ type: 'stream', channel: 'assistant', delta: 'Hello ' }]);
  });

  it('message_update thinking_delta → stream(thinking)', () => {
    const { events, emit } = collect();
    translatePiEvent(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'let me reason', contentIndex: 0 },
      },
      emit,
    );
    expect(events).toEqual([{ type: 'stream', channel: 'thinking', delta: 'let me reason' }]);
  });

  it('message_update with a non-text sub-event (start/toolcall/end) emits nothing', () => {
    const { events, emit } = collect();
    translatePiEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } }, emit);
    translatePiEvent({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', delta: '{"a":1}', contentIndex: 0 } }, emit);
    translatePiEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_end', content: 'x', contentIndex: 0 } }, emit);
    expect(events).toEqual([]);
  });

  it('message_update with an empty delta or no assistantMessageEvent emits nothing', () => {
    const { events, emit } = collect();
    translatePiEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '' } }, emit);
    translatePiEvent({ type: 'message_update' }, emit);
    expect(events).toEqual([]);
  });

  it('message_end with usage → usage AgentEvent + tokens log', () => {
    const { events, emit } = collect();
    translatePiEvent(
      {
        type: 'message_end',
        message: { usage: { input: 100, output: 50, cost: { total: 0.001234 } } },
      },
      emit,
    );
    // Two events: structured `usage` flows to the orchestrator's token
    // accumulator; the human-readable `log` is for the dashboard. Both
    // are required — see the comment in pi/event-mapper.ts message_end.
    expect(events).toEqual([
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.001234,
      },
      { type: 'log', message: 'tokens +100in +50out $0.001234' },
    ]);
  });

  it('message_end with cache tokens and routedModel → usage carries them through', () => {
    const { events, emit } = collect();
    translatePiEvent(
      {
        type: 'message_end',
        message: {
          model: 'anthropic/claude-opus-4-5',
          responseModel: 'anthropic/claude-opus-4-5-20260101',
          usage: {
            input: 100,
            output: 50,
            cacheRead: 800,
            cacheWrite: 200,
            cost: { total: 0.005 },
          },
        },
      },
      emit,
    );
    expect(events).toEqual([
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 800,
        cacheWriteTokens: 200,
        cost: 0.005,
        model: 'anthropic/claude-opus-4-5-20260101',
      },
      { type: 'log', message: 'tokens +100in +50out +800cr +200cw $0.005000' },
    ]);
  });

  it('message_end falls back to message.model when responseModel is absent', () => {
    const { events, emit } = collect();
    translatePiEvent(
      {
        type: 'message_end',
        message: {
          model: 'openai/gpt-5',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
        },
      },
      emit,
    );
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ model: 'openai/gpt-5' });
  });

  it('message_end without usage emits nothing', () => {
    const { events, emit } = collect();
    translatePiEvent({ type: 'message_end' }, emit);
    expect(events).toEqual([]);
  });

  it('auto_retry_start emits warn log with attempt count and reason', () => {
    const { events, emit } = collect();
    translatePiEvent(
      {
        type: 'auto_retry_start',
        attempt: 2,
        maxAttempts: 5,
        delayMs: 1000,
        errorMessage: 'rate limit',
      },
      emit,
    );
    expect(events).toEqual([
      { type: 'log', level: 'warn', message: 'pi auto-retry 2/5: rate limit' },
    ]);
  });

  it('auto_retry_end on success emits info log; on failure emits warn', () => {
    const { events: ok, emit: emitOk } = collect();
    translatePiEvent({ type: 'auto_retry_end', success: true, attempt: 3 }, emitOk);
    expect(ok).toEqual([{ type: 'log', message: 'pi auto-retry recovered on attempt 3' }]);

    const { events: fail, emit: emitFail } = collect();
    translatePiEvent(
      { type: 'auto_retry_end', success: false, attempt: 5, finalError: 'timeout' },
      emitFail,
    );
    expect(fail).toEqual([
      { type: 'log', level: 'warn', message: 'pi auto-retry exhausted: timeout' },
    ]);
  });

  it('error event → error AgentEvent', () => {
    const { events, emit } = collect();
    translatePiEvent({ type: 'error', message: 'rate limit exceeded' }, emit);
    expect(events).toEqual([{ type: 'error', message: 'rate limit exceeded' }]);
  });

  it('does not throw on unknown event types', () => {
    const { emit } = collect();
    expect(() =>
      translatePiEvent({ type: 'something_new', foo: 'bar' }, emit),
    ).not.toThrow();
  });

  it('exception in callback does not propagate (caller responsibility)', () => {
    // Mapper itself doesn't try/catch — that's the factory's job. We just
    // verify mapper doesn't add its own catch that would swallow useful errors.
    const throwing = vi.fn(() => {
      throw new Error('downstream');
    });
    expect(() =>
      translatePiEvent({ type: 'agent_start' }, throwing),
    ).toThrow(/downstream/);
  });
});
