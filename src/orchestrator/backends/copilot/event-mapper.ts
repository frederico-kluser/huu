import type { AgentEvent } from '../../types.js';
import { extractFileFromArgs, isWriteTool } from '../_shared/write-tools.js';

/**
 * Translates a `@github/copilot-sdk` SessionEvent into the orchestrator's
 * uniformized AgentEvent. Pure function — fed synthetic events from
 * unit tests.
 *
 * The SDK exposes a discriminated union on `ev.type`. We keep the typing
 * loose here (`unknown`) so we don't break when the SDK drops/renames
 * types between minor versions; the switch covers the events we map and
 * everything else is silently ignored (consistent with Pi's mapper).
 *
 * Returns nothing. The caller subscribes to the session and forwards
 * events through this function.
 *
 * Notes about specific Copilot quirks (Apr 2026):
 * - `assistant.message_delta` is NOT translated to log entries — Pi's
 *   debounce path only renders complete messages, and forwarding deltas
 *   would flood the orchestrator's log ring buffer (1000-entry cap)
 *   in seconds. We only emit the final `assistant.message`.
 * - `session.idle` means "this turn is done"; for our case (one prompt
 *   per agent task) it IS the done signal — Pi doesn't have a separate
 *   `agent_end` either; we emit `done` from idle and let the factory's
 *   waitIdleOrShutdown helper resolve.
 * - `assistant.usage` may be absent on BYOK providers that don't report
 *   token counts (Ollama). Treat as best-effort.
 */
export function translateCopilotEvent(
  event: unknown,
  onEvent: (e: AgentEvent) => void,
): void {
  if (!event || typeof event !== 'object') return;
  const ev = event as { type?: string; data?: Record<string, unknown> };
  const data = (ev.data ?? {}) as Record<string, unknown>;

  switch (ev.type) {
    case 'assistant.message': {
      const content = typeof data.content === 'string' ? data.content : '';
      if (content) {
        onEvent({ type: 'log', message: truncateForLog(content) });
      }
      break;
    }

    case 'assistant.reasoning': {
      const content = typeof data.content === 'string' ? data.content : '';
      if (content) {
        onEvent({ type: 'log', message: `thinking: ${truncateForLog(content)}` });
      }
      break;
    }

    case 'tool.execution_start': {
      const toolName = String(data.toolName ?? data.mcpToolName ?? '');
      const file = extractFileFromArgs(data.arguments);
      const msg = `tool: ${toolName}${file ? ` → ${file}` : ''}`;
      onEvent({ type: 'state_change', state: 'tool_running' });
      onEvent({ type: 'log', message: msg });
      if (file && isWriteTool(toolName)) {
        onEvent({ type: 'file_write', file });
      }
      break;
    }

    case 'tool.execution_complete': {
      onEvent({ type: 'state_change', state: 'streaming' });
      const toolName = String(data.toolName ?? '');
      const success = data.success !== false;
      if (!success) {
        const errMsg =
          typeof data.error === 'object' && data.error !== null
            ? String((data.error as { message?: string }).message ?? '')
            : '';
        onEvent({
          type: 'log',
          level: 'error',
          message: `tool error: ${toolName}${errMsg ? ` — ${errMsg}` : ''}`,
        });
      } else {
        onEvent({ type: 'log', message: `tool done: ${toolName}` });
      }
      break;
    }

    case 'assistant.usage': {
      const inp = numOrZero(data.inputTokens);
      const out = numOrZero(data.outputTokens);
      const cost = numOrZero(data.cost);
      const cacheR = numOrZero(data.cacheReadTokens);
      const cacheW = numOrZero(data.cacheWriteTokens);
      const cacheBits =
        cacheR > 0 || cacheW > 0 ? ` (cacheR=${cacheR} cacheW=${cacheW})` : '';
      // Copilot's `cost` is a premium-request multiplier, not USD. Suffix
      // `pr` so the dashboard format is unambiguous vs Pi's `$X`.
      const costBits = cost > 0 ? ` ${cost.toFixed(2)}pr` : '';
      onEvent({
        type: 'log',
        message: `tokens +${inp}in +${out}out${cacheBits}${costBits}`,
      });
      break;
    }

    case 'session.error': {
      const message =
        typeof data.message === 'string' ? data.message : 'session error';
      onEvent({ type: 'error', message });
      break;
    }

    case 'session.idle':
      // Marks turn-end; the factory turns this into a `done` event after
      // confirming no error fired first (TerminationTracker).
      onEvent({ type: 'state_change', state: 'streaming' });
      break;

    case 'session.shutdown': {
      // Persisted shutdown — usually accompanied by session.idle. The
      // factory translates this terminal state.
      const codeChanges = data.codeChanges as
        | { linesAdded?: number; linesRemoved?: number; filesModified?: number }
        | undefined;
      if (codeChanges) {
        onEvent({
          type: 'log',
          message: `shutdown: +${codeChanges.linesAdded ?? 0}/-${codeChanges.linesRemoved ?? 0} lines, ${codeChanges.filesModified ?? 0} file(s)`,
        });
      }
      break;
    }

    case 'abort': {
      const reason = typeof data.reason === 'string' ? data.reason : 'aborted';
      onEvent({ type: 'log', level: 'warn', message: `abort: ${reason}` });
      break;
    }
  }
}

function numOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

const LOG_TRUNCATE_AT = 500;
function truncateForLog(s: string): string {
  if (s.length <= LOG_TRUNCATE_AT) return s;
  return `${s.slice(0, LOG_TRUNCATE_AT)}… (+${s.length - LOG_TRUNCATE_AT} chars)`;
}
