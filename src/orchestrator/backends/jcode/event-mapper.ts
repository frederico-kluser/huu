import type { AgentEvent } from '../../types.js';
import { extractFileFromArgs, isWriteTool } from '../_shared/write-tools.js';

/**
 * Translates a single stdout line from the `jcode run` subprocess into
 * zero or more `AgentEvent` emissions.
 *
 * jcode output line patterns (one per line, no overlapping prefixes):
 *   `[start]`            — agent session started
 *   `[read] <path>`      — read tool executed on a file
 *   `[write] <path>`     — file written (treated as file_write event)
 *   `[bash] <command>`   — bash tool executed
 *   `[edit] <path>`      — file edited (treated as file_write event)
 *   `[tokens] in:<N> out:<N> [cr:<N>] [cw:<N>] [cost:<N>]` — token usage
 *   `[thinking] <text>`  — reasoning stream delta
 *   `[end]`              — agent session ended
 *   `[error] <message>`  — agent error
 *   `[retry] <N>/<M> <reason>` — auto-retry
 *   `[retry-ok] <N>`     — auto-retry recovered
 *   `[retry-exhausted] <msg>` — auto-retry exhausted
 *   `[compaction] <reason>` — context compaction
 *   Anything else        — assistant stream delta
 *
 * The function is pure so unit tests can feed synthetic lines without
 * spawning a real jcode subprocess.
 */
export function translateJcodeOutput(
  line: string,
  onEvent: (e: AgentEvent) => void,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  // ---- Tagged lines (structured events) ----
  const tagMatch = trimmed.match(/^\[(\w[\w-]*)\]\s?(.*)$/);
  if (tagMatch) {
    const tag = tagMatch[1]!.toLowerCase();
    const rest = tagMatch[2]!;

    switch (tag) {
      case 'start':
        onEvent({ type: 'state_change', state: 'streaming' });
        onEvent({ type: 'log', message: 'jcode agent started' });
        return;

      case 'read': {
        const file = rest || null;
        const msg = file ? `tool: read → ${file}` : 'tool: read';
        onEvent({ type: 'state_change', state: 'tool_running' });
        onEvent({ type: 'log', message: msg });
        return;
      }

      case 'write': {
        const file = rest || null;
        const msg = file ? `tool: write → ${file}` : 'tool: write';
        onEvent({ type: 'state_change', state: 'tool_running' });
        onEvent({ type: 'log', message: msg });
        if (file) onEvent({ type: 'file_write', file });
        return;
      }

      case 'edit': {
        const file = rest || null;
        const msg = file ? `tool: edit → ${file}` : 'tool: edit';
        onEvent({ type: 'state_change', state: 'tool_running' });
        onEvent({ type: 'log', message: msg });
        if (file) onEvent({ type: 'file_write', file });
        return;
      }

      case 'bash': {
        const cmd = rest || '';
        const msg = cmd ? `tool: bash → ${cmd}` : 'tool: bash';
        onEvent({ type: 'state_change', state: 'tool_running' });
        onEvent({ type: 'log', message: msg });
        return;
      }

      case 'tokens': {
        const parsed = parseTokenLine(rest);
        if (parsed) {
          onEvent({
            type: 'usage',
            inputTokens: parsed.input,
            outputTokens: parsed.output,
            ...(parsed.cacheRead !== undefined
              ? { cacheReadTokens: parsed.cacheRead }
              : {}),
            ...(parsed.cacheWrite !== undefined
              ? { cacheWriteTokens: parsed.cacheWrite }
              : {}),
            ...(parsed.cost !== undefined ? { cost: parsed.cost } : {}),
            ...(parsed.model ? { model: parsed.model } : {}),
          });
          onEvent({
            type: 'log',
            message: formatTokenLog(
              parsed.input,
              parsed.output,
              parsed.cacheRead,
              parsed.cacheWrite,
              parsed.cost,
            ),
          });
        }
        return;
      }

      case 'thinking':
        if (rest) {
          onEvent({ type: 'stream', channel: 'thinking', delta: rest });
        }
        return;

      case 'end':
        onEvent({ type: 'log', message: 'jcode agent finished' });
        return;

      case 'error':
        onEvent({ type: 'error', message: rest || 'unknown jcode error' });
        return;

      case 'retry': {
        const retryMatch = rest.match(/^(\d+)\/(\d+)\s*(.*)$/);
        if (retryMatch) {
          const attempt = retryMatch[1]!;
          const max = retryMatch[2]!;
          const reason = retryMatch[3] ? `: ${retryMatch[3]}` : '';
          onEvent({
            type: 'log',
            level: 'warn',
            message: `jcode auto-retry ${attempt}/${max}${reason}`,
          });
        }
        return;
      }

      case 'retry-ok':
        onEvent({
          type: 'log',
          message: `jcode auto-retry recovered on attempt ${rest || '?'}`,
        });
        return;

      case 'retry-exhausted':
        onEvent({
          type: 'log',
          level: 'warn',
          message: `jcode auto-retry exhausted${rest ? `: ${rest}` : ''}`,
        });
        return;

      case 'compaction':
        onEvent({
          type: 'compaction',
          reason: rest || 'unknown',
        });
        return;

      default:
        // Unknown tag — treat as a log line so nothing is silently dropped.
        onEvent({ type: 'log', message: trimmed });
        return;
    }
  }

  // ---- Untagged line: assistant stream delta ----
  onEvent({ type: 'stream', channel: 'assistant', delta: trimmed });
}

// ---- Token-line parser ----

interface TokenInfo {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  model?: string;
}

/**
 * Parse a jcode `[tokens]` payload line.
 *
 * Formats accepted (space-separated key:value pairs):
 *   `in:100 out:50`
 *   `in:100 out:50 cr:800 cw:200 cost:0.001234 model:deepseek-v4-pro`
 */
function parseTokenLine(rest: string): TokenInfo | null {
  const info: TokenInfo = { input: 0, output: 0 };
  let hasInput = false;
  let hasOutput = false;

  const pairs = rest.split(/\s+/);
  for (const pair of pairs) {
    const colon = pair.indexOf(':');
    if (colon === -1) continue;
    const key = pair.slice(0, colon).toLowerCase();
    const val = pair.slice(colon + 1);

    switch (key) {
      case 'in':
        info.input = parseInt(val, 10) || 0;
        hasInput = true;
        break;
      case 'out':
        info.output = parseInt(val, 10) || 0;
        hasOutput = true;
        break;
      case 'cr':
        info.cacheRead = parseInt(val, 10) || 0;
        break;
      case 'cw':
        info.cacheWrite = parseInt(val, 10) || 0;
        break;
      case 'cost': {
        const n = parseFloat(val);
        if (!isNaN(n)) info.cost = n;
        break;
      }
      case 'model':
        info.model = val;
        break;
    }
  }

  if (!hasInput && !hasOutput) return null;
  return info;
}

function formatTokenLog(
  inp: number,
  out: number,
  cacheRead?: number,
  cacheWrite?: number,
  cost?: number,
): string {
  const parts = [`tokens +${inp}in +${out}out`];
  if (cacheRead !== undefined && cacheRead > 0)
    parts.push(`+${cacheRead}cr`);
  if (cacheWrite !== undefined && cacheWrite > 0)
    parts.push(`+${cacheWrite}cw`);
  if (cost !== undefined && cost > 0) parts.push(`$${cost.toFixed(6)}`);
  return parts.join(' ');
}
