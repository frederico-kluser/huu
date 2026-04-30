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

  it('message_end with usage → tokens log', () => {
    const { events, emit } = collect();
    translatePiEvent(
      {
        type: 'message_end',
        message: { usage: { input: 100, output: 50, cost: { total: 0.001234 } } },
      },
      emit,
    );
    expect(events).toEqual([
      { type: 'log', message: 'tokens +100in +50out $0.001234' },
    ]);
  });

  it('message_end without usage emits nothing', () => {
    const { events, emit } = collect();
    translatePiEvent({ type: 'message_end' }, emit);
    expect(events).toEqual([]);
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
