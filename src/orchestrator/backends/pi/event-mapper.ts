import type { AgentEvent } from '../../types.js';
import { extractFileFromArgs, isWriteTool } from '../_shared/write-tools.js';

/**
 * Translates a `pi-coding-agent` SDK event into the orchestrator's
 * uniformized `AgentEvent`. Kept as a pure function so unit tests can feed
 * synthetic event objects without spawning a real session.
 *
 * Pi event shapes (assumed, since the SDK doesn't export public types at
 * the level we consume):
 *   { type: 'agent_start' }
 *   { type: 'tool_execution_start', toolName, args }
 *   { type: 'tool_execution_end',   toolName, isError? }
 *   { type: 'message_end',          message?: { usage }, usage? }
 *   { type: 'agent_end' }
 *   { type: 'auto_compaction_start', reason? }
 *   { type: 'error',                 message? }
 */
export function translatePiEvent(
  event: unknown,
  onEvent: (e: AgentEvent) => void,
): void {
  if (!event || typeof event !== 'object') return;
  const ev = event as { type?: string; [k: string]: unknown };

  switch (ev.type) {
    case 'agent_start':
      onEvent({ type: 'state_change', state: 'streaming' });
      onEvent({ type: 'log', message: 'agent started' });
      break;

    case 'tool_execution_start': {
      const toolName = String(ev.toolName ?? '');
      const file = extractFileFromArgs(ev.args);
      const msg = `tool: ${toolName}${file ? ` → ${file}` : ''}`;
      onEvent({ type: 'state_change', state: 'tool_running' });
      onEvent({ type: 'log', message: msg });
      if (file && isWriteTool(toolName)) {
        onEvent({ type: 'file_write', file });
      }
      break;
    }

    case 'tool_execution_end': {
      onEvent({ type: 'state_change', state: 'streaming' });
      const toolName = String(ev.toolName ?? '');
      if (ev.isError) {
        onEvent({ type: 'log', level: 'error', message: `tool error: ${toolName}` });
      } else {
        onEvent({ type: 'log', message: `tool done: ${toolName}` });
      }
      break;
    }

    case 'message_end': {
      const usage = readUsage(ev as { message?: unknown; usage?: unknown });
      if (usage) {
        const inp = usage.input ?? usage.inputTokens ?? 0;
        const out = usage.output ?? usage.outputTokens ?? 0;
        const cost = usage.cost?.total ?? 0;
        onEvent({
          type: 'log',
          message: `tokens +${inp}in +${out}out${cost > 0 ? ` $${cost.toFixed(6)}` : ''}`,
        });
      }
      break;
    }

    case 'agent_end':
      onEvent({ type: 'log', message: 'agent finished' });
      break;

    case 'auto_compaction_start':
      onEvent({
        type: 'log',
        level: 'warn',
        message: `auto-compaction: ${typeof ev.reason === 'string' ? ev.reason : ''}`,
      });
      break;

    case 'error':
      onEvent({
        type: 'error',
        message: typeof ev.message === 'string' ? ev.message : 'unknown error',
      });
      break;
  }
}

interface PiUsage {
  input?: number;
  inputTokens?: number;
  output?: number;
  outputTokens?: number;
  cost?: { total?: number };
}

function readUsage(ev: { message?: unknown; usage?: unknown }): PiUsage | null {
  const fromMessage =
    ev.message && typeof ev.message === 'object'
      ? (ev.message as { usage?: PiUsage }).usage
      : undefined;
  const direct = ev.usage as PiUsage | undefined;
  return fromMessage ?? direct ?? null;
}
