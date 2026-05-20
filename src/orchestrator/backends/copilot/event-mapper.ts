import type { AgentEvent } from '../../types.js';
import { extractFileFromArgs, isWriteTool } from '../_shared/write-tools.js';

/**
 * Translates a `@github/copilot-sdk` SessionEvent into the orchestrator's
 * uniformized AgentEvent. The translator is **stateful** — it tracks
 * `toolCallId → toolName` from `tool.execution_start` so that
 * `tool.execution_complete` (which carries only `toolCallId` per SDK
 * 0.3.0's `ToolExecutionCompleteData`) can be reported with a real name.
 *
 * The SDK exposes a discriminated union on `ev.type`. We keep the typing
 * loose here (`unknown`) so we don't break when the SDK drops/renames
 * types between minor versions; the switch covers the events we map and
 * everything else is silently ignored (consistent with Pi's mapper).
 *
 * Quirks specific to Copilot CLI / SDK as of Apr 2026:
 * - `assistant.message_delta` is NOT translated to log entries. The
 *   orchestrator's log ring buffer caps at 1000 entries; forwarding
 *   chunked deltas (5-30 chars each) overflows in seconds. Only the
 *   final `assistant.message` is emitted.
 * - `session.idle` ends a turn but doesn't shut down the session. We
 *   used to emit `state_change('streaming')` on idle — that was wrong
 *   (idle is "turn done, waiting"). The factory observes idle to
 *   resolve the prompt() promise; the mapper no longer emits anything
 *   for it.
 * - `assistant.usage` may be absent on BYOK Anthropic providers that
 *   strip turn lifecycle / reasoning events (issue copilot-cli/2651).
 *   Treat as best-effort.
 * - `session.shutdown.shutdownType` collapses true reasons into
 *   `routine|error` (issue copilot-cli/2852). The factory carries the
 *   real reason via TerminationTracker; the mapper just logs the
 *   summary line for human readers.
 *
 * Use {@link createCopilotEventTranslator} per session — never share an
 * instance across sessions. The toolCallId map is unbounded by design
 * (a single session is bounded by the auto-compaction / shutdown
 * lifecycle); a long-lived shared instance would leak.
 */
export interface CopilotEventTranslator {
  (event: unknown, onEvent: (e: AgentEvent) => void): void;
}

export function createCopilotEventTranslator(): CopilotEventTranslator {
  // toolCallId → toolName, populated on tool.execution_start and read
  // on tool.execution_complete. Cleared lazily when a complete event
  // is observed, so a runaway session doesn't grow this without bound.
  const toolNames = new Map<string, string>();

  return function translate(
    event: unknown,
    onEvent: (e: AgentEvent) => void,
  ): void {
    if (!event || typeof event !== 'object') return;
    const ev = event as { type?: string; data?: Record<string, unknown> };
    const data = (ev.data ?? {}) as Record<string, unknown>;

    switch (ev.type) {
      // ─── Assistant turn lifecycle ─────────────────────────────────
      case 'assistant.intent': {
        const intent = typeof data.intent === 'string' ? data.intent : '';
        if (intent) {
          onEvent({ type: 'log', message: `intent: ${truncateForLog(intent)}` });
        }
        break;
      }

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

      case 'assistant.usage': {
        const inp = numOrZero(data.inputTokens);
        const out = numOrZero(data.outputTokens);
        const cost = numOrZero(data.cost);
        const cacheR = numOrZero(data.cacheReadTokens);
        const cacheW = numOrZero(data.cacheWriteTokens);
        const dur = numOrZero(data.duration);
        const model = typeof data.model === 'string' ? data.model : '';
        const cacheBits =
          cacheR > 0 || cacheW > 0 ? ` (cacheR=${cacheR} cacheW=${cacheW})` : '';
        // Copilot's `cost` is a premium-request multiplier, not USD.
        // Suffix `pr` so the dashboard format is unambiguous vs Pi `$X`.
        const costBits = cost > 0 ? ` ${cost.toFixed(2)}pr` : '';
        const durBits = dur > 0 ? ` ${(dur / 1000).toFixed(1)}s` : '';
        const modelBits = model ? ` [${model}]` : '';
        // Structured usage flows to the orchestrator's accumulator; the
        // human-readable log line stays for the dashboard. Suppressing
        // the log here would regress visible token feedback during a run.
        onEvent({
          type: 'usage',
          inputTokens: inp,
          outputTokens: out,
          cacheReadTokens: cacheR,
          cacheWriteTokens: cacheW,
          cost: cost > 0 ? cost : undefined,
          model: model || undefined,
        });
        onEvent({
          type: 'log',
          message: `tokens +${inp}in +${out}out${cacheBits}${costBits}${durBits}${modelBits}`,
        });
        break;
      }

      // ─── Tool execution ───────────────────────────────────────────
      case 'tool.execution_start': {
        const toolName = String(data.toolName ?? data.mcpToolName ?? '');
        const toolCallId =
          typeof data.toolCallId === 'string' ? data.toolCallId : '';
        if (toolCallId && toolName) {
          toolNames.set(toolCallId, toolName);
        }
        const file = extractFileFromArgs(data.arguments);
        const msg = `tool: ${toolName}${file ? ` → ${file}` : ''}`;
        onEvent({ type: 'state_change', state: 'tool_running' });
        onEvent({ type: 'log', message: msg });
        if (file && isWriteTool(toolName)) {
          onEvent({ type: 'file_write', file });
        }
        break;
      }

      case 'tool.execution_progress': {
        // Long-running tools (bash with sleep, npm install, build) emit
        // these to keep the user oriented. Without them the TUI looks
        // frozen for minutes during a single tool call.
        const progress =
          typeof data.progressMessage === 'string' ? data.progressMessage : '';
        if (progress) {
          onEvent({ type: 'log', message: `  ${truncateForLog(progress)}` });
        }
        break;
      }

      case 'tool.execution_partial_result': {
        // Streamed bash stdout (and similar). Truncate aggressively —
        // a single `npm install` can stream ~100 KB of output and we
        // don't want it dominating the dashboard ring buffer.
        const chunk =
          typeof data.partialOutput === 'string' ? data.partialOutput : '';
        if (chunk) {
          // Take only the first line to reduce noise; full output is
          // in the recorder's JSONL file.
          const firstLine = chunk.split('\n', 1)[0] ?? '';
          if (firstLine.trim()) {
            onEvent({
              type: 'log',
              message: `  | ${truncateForLog(firstLine, 120)}`,
            });
          }
        }
        break;
      }

      case 'tool.execution_complete': {
        onEvent({ type: 'state_change', state: 'streaming' });
        // SDK 0.3.0 ToolExecutionCompleteData carries only toolCallId,
        // not toolName. Look it up from the start-event map; fall back
        // to '<unknown>' if start was missed (e.g. resumed session).
        const toolCallId =
          typeof data.toolCallId === 'string' ? data.toolCallId : '';
        const toolName =
          (toolCallId && toolNames.get(toolCallId)) || '<unknown>';
        if (toolCallId) toolNames.delete(toolCallId);
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

      // ─── Sub-agent (custom agents / fleet) ────────────────────────
      // SDK 0.3.0 added per-subagent streaming; issue copilot-cli/2265
      // (now closed) limited the granularity inside the parent message
      // but lifecycle events fire reliably.
      case 'subagent.started': {
        const name = pickName(data);
        onEvent({ type: 'log', message: `subagent started: ${name}` });
        break;
      }
      case 'subagent.completed': {
        const name = pickName(data);
        onEvent({ type: 'log', message: `subagent done: ${name}` });
        break;
      }
      case 'subagent.failed': {
        const name = pickName(data);
        const err =
          typeof data.error === 'object' && data.error !== null
            ? String((data.error as { message?: string }).message ?? '')
            : '';
        onEvent({
          type: 'log',
          level: 'error',
          message: `subagent failed: ${name}${err ? ` — ${err}` : ''}`,
        });
        break;
      }

      // ─── Session lifecycle ────────────────────────────────────────
      case 'session.error': {
        const message =
          typeof data.message === 'string' ? data.message : 'session error';
        onEvent({ type: 'error', message });
        break;
      }

      case 'session.usage_info': {
        // Context-window pressure gauge — fires before compaction kicks
        // in. Useful for the dashboard but noisy if logged every turn,
        // so emit only when usage crosses a threshold (>80% of limit).
        const limit = numOrZero(data.tokenLimit);
        const current = numOrZero(data.currentTokens);
        if (limit > 0 && current / limit > 0.8) {
          const pct = ((current / limit) * 100).toFixed(0);
          onEvent({
            type: 'log',
            level: 'warn',
            message: `context: ${current}/${limit} tokens (${pct}%) — compaction approaching`,
          });
        }
        break;
      }

      case 'session.compaction_start': {
        onEvent({
          type: 'log',
          level: 'warn',
          message: 'auto-compaction: starting (context limit approaching)',
        });
        break;
      }

      case 'session.compaction_complete': {
        // Real fields per SDK 0.3.0 CompactionCompleteData:
        //   error?, messagesRemoved?, preCompactionTokens?,
        //   postCompactionTokens?, preCompactionMessagesLength?, ...
        // Success is signalled by the absence of `error`. Tokens
        // removed is the difference (may be negative on a noop).
        const error =
          typeof data.error === 'string' && data.error ? data.error : '';
        const success = !error;
        const pre = numOrZero(data.preCompactionTokens);
        const post = numOrZero(data.postCompactionTokens);
        const tokensRemoved = pre > 0 && post >= 0 ? Math.max(0, pre - post) : 0;
        const messagesRemoved = numOrZero(data.messagesRemoved);
        onEvent({
          type: 'log',
          level: success ? 'info' : 'warn',
          message: `auto-compaction: ${success ? 'done' : 'failed'} (-${tokensRemoved} tokens, -${messagesRemoved} msgs)${
            error ? ` — ${truncateForLog(error)}` : ''
          }`,
        });
        break;
      }

      case 'session.context_changed': {
        // Defensive log: huu controls cwd/branch via worktree, the
        // agent shouldn't be navigating elsewhere. If this fires
        // mid-run with a different cwd, something escaped the sandbox.
        const cwd = typeof data.cwd === 'string' ? data.cwd : '';
        const branch = typeof data.branch === 'string' ? data.branch : '';
        onEvent({
          type: 'log',
          message: `context: cwd=${cwd}${branch ? ` branch=${branch}` : ''}`,
        });
        break;
      }

      case 'session.task_complete': {
        const summary =
          typeof data.summary === 'string' ? data.summary : '';
        if (summary) {
          onEvent({
            type: 'log',
            message: `task complete: ${truncateForLog(summary)}`,
          });
        }
        break;
      }

      case 'session.idle':
        // Turn ended — the factory observes this to resolve prompt().
        // Don't emit any AgentEvent here: the factory's `done` event
        // is the canonical end-of-prompt signal, and emitting
        // state_change here would briefly show "streaming" right
        // before "done".
        break;

      case 'session.shutdown': {
        // Persisted shutdown — usually accompanied by session.idle.
        // shutdownType collapses to routine|error (issue
        // copilot-cli/2852). The factory's TerminationTracker carries
        // the true reason; here we just log the run summary.
        // Real fields per SDK 0.3.0 ShutdownData:
        //   shutdownType, codeChanges, modelMetrics (required),
        //   errorReason?, currentModel?, currentTokens?, ...
        const codeChanges = data.codeChanges as
          | {
              linesAdded?: number;
              linesRemoved?: number;
              filesModified?: string[] | number;
            }
          | undefined;
        if (codeChanges) {
          // filesModified is a string[] of file paths in the real
          // schema; we want a count. Defensively handle a number too
          // for forward-compat with future schema changes.
          const filesModified = Array.isArray(codeChanges.filesModified)
            ? codeChanges.filesModified.length
            : numOrZero(codeChanges.filesModified);
          onEvent({
            type: 'log',
            message: `shutdown: +${codeChanges.linesAdded ?? 0}/-${codeChanges.linesRemoved ?? 0} lines, ${filesModified} file(s)`,
          });
        }
        // Aggregate premium-request cost across models. Real schema
        // has no top-level totalPremiumRequests — it's per-model under
        // modelMetrics[name].requests.cost.
        const totalPR = sumModelMetricsCost(data.modelMetrics);
        if (totalPR > 0) {
          onEvent({
            type: 'log',
            message: `shutdown: ${totalPR.toFixed(2)}pr total`,
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
  };
}

function pickName(data: Record<string, unknown>): string {
  if (typeof data.agentDisplayName === 'string' && data.agentDisplayName) {
    return data.agentDisplayName;
  }
  if (typeof data.agentName === 'string' && data.agentName) {
    return data.agentName;
  }
  return '<anonymous>';
}

function numOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * `session.shutdown.modelMetrics` is a record keyed by model name.
 * Each entry has `requests.cost` (cumulative cost multiplier for that
 * model) and `requests.count`. We sum the costs across all models for
 * the dashboard "premium-requests total" line.
 */
function sumModelMetricsCost(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const requests = (entry as { requests?: { cost?: unknown } }).requests;
    const cost = numOrZero(requests?.cost);
    total += cost;
  }
  return total;
}

const LOG_TRUNCATE_AT = 500;
function truncateForLog(s: string, limit = LOG_TRUNCATE_AT): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}… (+${s.length - limit} chars)`;
}
