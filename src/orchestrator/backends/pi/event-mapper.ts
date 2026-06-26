import type { AgentEvent } from '../../types.js';
import { extractFileFromArgs, isWriteTool } from '../_shared/write-tools.js';

/**
 * Translates a `pi-coding-agent` SDK event into the orchestrator's
 * uniformized `AgentEvent`. Kept as a pure function so unit tests can feed
 * synthetic event objects without spawning a real session.
 *
 * Pi event shapes consumed here (subset of AgentSessionEvent in 0.73.x):
 *   { type: 'agent_start' }
 *   { type: 'tool_execution_start', toolName, args }
 *   { type: 'tool_execution_end',   toolName, isError? }
 *   { type: 'message_update',       assistantMessageEvent: { type, delta } }
 *   { type: 'message_end',          message: AssistantMessage }
 *   { type: 'agent_end' }
 *   { type: 'auto_compaction_start', reason? }
 *   { type: 'auto_retry_start',     attempt, maxAttempts, errorMessage }
 *   { type: 'auto_retry_end',       success, attempt, finalError? }
 *   { type: 'error',                message? }
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

    case 'message_update': {
      // The live stream: pi fires one `message_update` per provider SSE chunk,
      // each carrying an `assistantMessageEvent` delta. Surfacing these is what
      // makes the run log advance token-by-token instead of freezing between
      // tool calls. We forward only the incremental text/thinking deltas — the
      // cumulative `partial` message and the structural start/end/toolcall
      // sub-events are noise for a log view.
      const sub = (ev as { assistantMessageEvent?: { type?: string; delta?: unknown } })
        .assistantMessageEvent;
      if (!sub) break;
      const delta = typeof sub.delta === 'string' ? sub.delta : '';
      if (!delta) break;
      if (sub.type === 'text_delta') {
        onEvent({ type: 'stream', channel: 'assistant', delta });
      } else if (sub.type === 'thinking_delta') {
        onEvent({ type: 'stream', channel: 'thinking', delta });
      }
      break;
    }

    case 'message_end': {
      const message = readAssistantMessage(ev as { message?: unknown; usage?: unknown });
      const usage = message?.usage;
      if (usage) {
        const inp = usage.input ?? usage.inputTokens ?? 0;
        const out = usage.output ?? usage.outputTokens ?? 0;
        const cacheRead = usage.cacheRead ?? usage.cacheReadInput ?? 0;
        const cacheWrite = usage.cacheWrite ?? usage.cacheWriteInput ?? 0;
        const cost = usage.cost?.total ?? 0;
        const model = message.responseModel ?? message.model;
        // Emit BOTH events: 'usage' carries structured numbers the
        // orchestrator accumulates into AgentStatus; 'log' keeps the
        // human-readable line that the dashboard / per-agent log file
        // already render. Removing the log line would silently regress
        // the visible token trail in the TUI.
        onEvent({
          type: 'usage',
          inputTokens: inp,
          outputTokens: out,
          cacheReadTokens: cacheRead > 0 ? cacheRead : undefined,
          cacheWriteTokens: cacheWrite > 0 ? cacheWrite : undefined,
          cost: cost > 0 ? cost : undefined,
          model: typeof model === 'string' && model.length > 0 ? model : undefined,
        });
        onEvent({
          type: 'log',
          message: formatTokenLog(inp, out, cacheRead, cacheWrite, cost),
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

    case 'auto_retry_start': {
      const attempt = typeof ev.attempt === 'number' ? ev.attempt : 0;
      const max = typeof ev.maxAttempts === 'number' ? ev.maxAttempts : 0;
      const reason =
        typeof ev.errorMessage === 'string' && ev.errorMessage.length > 0
          ? `: ${ev.errorMessage}`
          : '';
      onEvent({
        type: 'log',
        level: 'warn',
        message: `pi auto-retry ${attempt}/${max}${reason}`,
      });
      break;
    }

    case 'auto_retry_end': {
      const success = ev.success === true;
      if (success) {
        const attempt = typeof ev.attempt === 'number' ? ev.attempt : 0;
        onEvent({
          type: 'log',
          message: `pi auto-retry recovered on attempt ${attempt}`,
        });
      } else {
        const finalErr =
          typeof ev.finalError === 'string' && ev.finalError.length > 0
            ? `: ${ev.finalError}`
            : '';
        onEvent({
          type: 'log',
          level: 'warn',
          message: `pi auto-retry exhausted${finalErr}`,
        });
      }
      break;
    }

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
  cacheRead?: number;
  cacheReadInput?: number;
  cacheWrite?: number;
  cacheWriteInput?: number;
  cost?: { total?: number };
}

interface PiAssistantMessage {
  usage?: PiUsage;
  model?: string;
  responseModel?: string;
}

function readAssistantMessage(ev: {
  message?: unknown;
  usage?: unknown;
}): PiAssistantMessage | null {
  if (ev.message && typeof ev.message === 'object') {
    return ev.message as PiAssistantMessage;
  }
  // Older event shapes carried `usage` directly on the event. Wrap so the
  // single message_end branch keeps working without two parallel paths.
  if (ev.usage && typeof ev.usage === 'object') {
    return { usage: ev.usage as PiUsage };
  }
  return null;
}

function formatTokenLog(
  inp: number,
  out: number,
  cacheRead: number,
  cacheWrite: number,
  cost: number,
): string {
  const parts = [`tokens +${inp}in +${out}out`];
  if (cacheRead > 0) parts.push(`+${cacheRead}cr`);
  if (cacheWrite > 0) parts.push(`+${cacheWrite}cw`);
  if (cost > 0) parts.push(`$${cost.toFixed(6)}`);
  return parts.join(' ');
}
