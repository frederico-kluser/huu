import { describe, it, expect } from 'vitest';
import { translateCopilotEvent } from './event-mapper.js';
import type { AgentEvent } from '../../types.js';

describe('translateCopilotEvent', () => {
  function collect(): { events: AgentEvent[]; emit: (e: AgentEvent) => void } {
    const events: AgentEvent[] = [];
    return { events, emit: (e) => events.push(e) };
  }

  it('ignores non-objects', () => {
    const { events, emit } = collect();
    translateCopilotEvent(null, emit);
    translateCopilotEvent('x', emit);
    expect(events).toEqual([]);
  });

  it('assistant.message → log with content', () => {
    const { events, emit } = collect();
    translateCopilotEvent(
      { type: 'assistant.message', data: { content: 'hello world' } },
      emit,
    );
    expect(events).toEqual([{ type: 'log', message: 'hello world' }]);
  });

  it('assistant.message with empty content is dropped', () => {
    const { events, emit } = collect();
    translateCopilotEvent(
      { type: 'assistant.message', data: { content: '' } },
      emit,
    );
    expect(events).toEqual([]);
  });

  it('assistant.message truncates very long content', () => {
    const { events, emit } = collect();
    const long = 'x'.repeat(2000);
    translateCopilotEvent(
      { type: 'assistant.message', data: { content: long } },
      emit,
    );
    expect(events).toHaveLength(1);
    const msg = (events[0] as { message: string }).message;
    expect(msg.length).toBeLessThan(700);
    expect(msg).toMatch(/\(\+\d+ chars\)$/);
  });

  it('tool.execution_start with edit_file → state_change + log + file_write', () => {
    const { events, emit } = collect();
    translateCopilotEvent(
      {
        type: 'tool.execution_start',
        data: {
          toolCallId: 't-1',
          toolName: 'edit_file',
          arguments: { path: 'src/foo.ts' },
        },
      },
      emit,
    );
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: edit_file → src/foo.ts' },
      { type: 'file_write', file: 'src/foo.ts' },
    ]);
  });

  it('tool.execution_start with view → no file_write', () => {
    const { events, emit } = collect();
    translateCopilotEvent(
      {
        type: 'tool.execution_start',
        data: { toolName: 'view', arguments: { path: 'src/foo.ts' } },
      },
      emit,
    );
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: view → src/foo.ts' },
    ]);
  });

  it('tool.execution_complete with success=false → error log', () => {
    const { events, emit } = collect();
    translateCopilotEvent(
      {
        type: 'tool.execution_complete',
        data: {
          toolName: 'edit_file',
          success: false,
          error: { message: 'permission denied' },
        },
      },
      emit,
    );
    expect(events).toEqual([
      { type: 'state_change', state: 'streaming' },
      { type: 'log', level: 'error', message: 'tool error: edit_file — permission denied' },
    ]);
  });

  it('assistant.usage with cost emits premium-request suffix', () => {
    const { events, emit } = collect();
    translateCopilotEvent(
      {
        type: 'assistant.usage',
        data: {
          inputTokens: 1500,
          outputTokens: 300,
          cost: 0.5,
          cacheReadTokens: 100,
          cacheWriteTokens: 50,
        },
      },
      emit,
    );
    expect(events).toEqual([
      {
        type: 'log',
        message: 'tokens +1500in +300out (cacheR=100 cacheW=50) 0.50pr',
      },
    ]);
  });

  it('assistant.usage without cache fields skips cache suffix', () => {
    const { events, emit } = collect();
    translateCopilotEvent(
      {
        type: 'assistant.usage',
        data: { inputTokens: 100, outputTokens: 20, cost: 0 },
      },
      emit,
    );
    expect(events).toEqual([{ type: 'log', message: 'tokens +100in +20out' }]);
  });

  it('session.error → error AgentEvent', () => {
    const { events, emit } = collect();
    translateCopilotEvent(
      { type: 'session.error', data: { message: 'rate_limit', errorType: 'rate_limit' } },
      emit,
    );
    expect(events).toEqual([{ type: 'error', message: 'rate_limit' }]);
  });

  it('session.idle → state_change(streaming)', () => {
    const { events, emit } = collect();
    translateCopilotEvent({ type: 'session.idle', data: {} }, emit);
    expect(events).toEqual([{ type: 'state_change', state: 'streaming' }]);
  });

  it('session.shutdown with codeChanges emits summary log', () => {
    const { events, emit } = collect();
    translateCopilotEvent(
      {
        type: 'session.shutdown',
        data: {
          shutdownType: 'routine',
          codeChanges: { linesAdded: 50, linesRemoved: 10, filesModified: 3 },
        },
      },
      emit,
    );
    expect(events).toEqual([
      { type: 'log', message: 'shutdown: +50/-10 lines, 3 file(s)' },
    ]);
  });

  it('abort event → warn log', () => {
    const { events, emit } = collect();
    translateCopilotEvent({ type: 'abort', data: { reason: 'user_exit' } }, emit);
    expect(events).toEqual([
      { type: 'log', level: 'warn', message: 'abort: user_exit' },
    ]);
  });

  it('unknown event types are silently ignored', () => {
    const { events, emit } = collect();
    translateCopilotEvent({ type: 'bizarre.future_event', data: { x: 1 } }, emit);
    expect(events).toEqual([]);
  });
});
