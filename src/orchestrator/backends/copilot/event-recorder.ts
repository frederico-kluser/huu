import {
  closeSync,
  mkdirSync,
  openSync,
  writeSync,
  type PathLike,
} from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Mirrors raw `SessionEvent` objects from the Copilot SDK into a
 * project-owned JSONL file under `.huu/`. The community consensus
 * (paperclip's copilot_local adapter, github/copilot-cli issues
 * #2012, #2217, #2490, #2609, #2649) is to NEVER read the SDK's own
 * `~/.copilot/session-state/<sid>/events.jsonl` for orchestration:
 *
 *   - #2012 raw U+2028/U+2029 in events breaks JSON.parse on resume
 *   - #2217 trailing NUL bytes after crash hides 3000+ valid lines
 *   - #2490 20 MB / 10k events corrupts segmented sessions
 *   - #2609 mutex contention + orphan inuse.<pid>.lock files
 *   - #2649 tool.execution_complete writes raw multiline content
 *
 * Subscribing via `session.on(handler)` and writing our own JSONL
 * sidesteps every one of those bugs — we control the encoding, the
 * fsync cadence, the rotation policy, and the file's lifetime is
 * tied to our run.
 *
 * Format: one JSON object per line, newline-delimited (RFC 7464). Each
 * line is `JSON.stringify(rawSdkEvent)` plus our own envelope:
 *
 *   { "_huu": { "agentId": N, "ts": "ISO" }, ...sdkEvent }
 *
 * The `_huu` prefix is namespaced so it never collides with SDK fields,
 * and lets readers filter by agent without joining against another file.
 *
 * Use `createEventRecorder` from inside the factory, register
 * `recorder.write(ev)` as a `session.on(handler)`, and add `recorder.close()`
 * to the lifecycle dispose chain. Failures during write are swallowed
 * (best-effort logging — never let recorder errors crash a run).
 */
export interface EventRecorder {
  /** Append a raw SDK event. Best-effort; never throws. */
  write(rawEvent: unknown): void;
  /** Close the underlying fd. Idempotent. */
  close(): void;
  /** Path of the file being written, for diagnostics. */
  readonly path: string;
}

export interface EventRecorderOptions {
  /** Worktree root or repo root — file lands at `<dir>/.huu/<basename>`. */
  rootDir: string;
  /** Run-scoped basename (no extension). Final path adds `-copilot-events.jsonl`. */
  runId: string;
  /** Agent id stamped into each line's `_huu.agentId`. */
  agentId: number;
}

export function createEventRecorder(opts: EventRecorderOptions): EventRecorder {
  const dir = join(opts.rootDir, '.huu');
  const path = join(dir, `${opts.runId}-copilot-events.jsonl`);
  ensureDir(dir);
  // O_APPEND ('a') so multiple agents writing to the same file (one
  // file per run, shared across agents) interleave atomically — the
  // OS guarantees append writes ≤ PIPE_BUF (4096 bytes) are atomic.
  // Lines are kept under that limit by our truncation policy below.
  const fd = openSync(path, 'a');
  let closed = false;
  return {
    path,
    write(rawEvent: unknown): void {
      if (closed) return;
      try {
        const envelope = wrapEvent(rawEvent, opts.agentId);
        const line = safeStringify(envelope) + '\n';
        // writeSync is synchronous in Node when the fd is a regular
        // file (it bypasses the libuv worker pool). For stdout/pipes
        // this would be a perf concern; for files it's the simplest
        // way to guarantee ordering across concurrent writers.
        writeSync(fd, line);
      } catch {
        /* best effort — recorder must not crash the run */
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      try {
        closeSync(fd);
      } catch {
        /* best effort */
      }
    },
  };
}

function wrapEvent(raw: unknown, agentId: number): unknown {
  const huu = { agentId, ts: new Date().toISOString() };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { _huu: huu, ...(raw as Record<string, unknown>) };
  }
  return { _huu: huu, _raw: raw };
}

const LINE_HARD_CAP_BYTES = 4 * 1024; // PIPE_BUF on Linux/macOS — guarantees atomic append

/**
 * `JSON.stringify` can throw on circular refs or BigInt; both are
 * non-fatal here. We also clamp lines to PIPE_BUF so concurrent
 * agent appends remain atomic. Truncated content is signalled by a
 * trailing `_truncated: true` so readers don't silently parse a
 * mangled record.
 */
function safeStringify(value: unknown): string {
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch (err) {
    raw = JSON.stringify({
      _serialize_error: err instanceof Error ? err.message : String(err),
    });
  }
  if (raw.length <= LINE_HARD_CAP_BYTES) return raw;
  // Replace the original `data` payload (where the bulk lives) with a
  // marker. Keeps the envelope (timestamp, type, ids) intact for
  // readers building timeline indexes.
  const v = value as { type?: string; _huu?: unknown };
  const truncated = JSON.stringify({
    _huu: v?._huu,
    type: v?.type,
    _truncated: true,
    _originalSize: raw.length,
  });
  return truncated.length <= LINE_HARD_CAP_BYTES ? truncated : truncated.slice(0, LINE_HARD_CAP_BYTES);
}

function ensureDir(dir: PathLike): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* writeSync below will surface a useful error if mkdir failed */
  }
}
