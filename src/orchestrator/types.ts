import type { AgentTask, AppConfig } from '../lib/types.js';
import type { AgentPortBundle } from './port-allocator.js';

export type AgentEvent =
  | { type: 'log'; level?: 'info' | 'warn' | 'error'; message: string }
  | { type: 'state_change'; state: 'streaming' | 'tool_running' }
  | { type: 'file_write'; file: string }
  | {
      /**
       * Incremental text the agent is STREAMING back, token by token, as the
       * provider produces it. `assistant` is the model's visible reply text;
       * `thinking` is its reasoning trace. Backends emit one of these per
       * streamed delta (pi `message_update` → `text_delta`/`thinking_delta`).
       *
       * The orchestrator coalesces deltas into whole lines and (a) surfaces
       * assistant lines in the live run log and (b) fans EVERY line — both
       * channels — to `subscribeAgentOutput` so a presentation layer can
       * mirror the raw agent output (e.g. the web UI streams it to the
       * browser console). This is what makes the run log advance in real time
       * instead of only at tool/turn boundaries.
       */
      type: 'stream';
      channel: 'assistant' | 'thinking';
      delta: string;
    }
  | {
      type: 'usage';
      /**
       * Token / cost telemetry. Emitted by backends whenever the underlying
       * SDK exposes usage info (Pi `message_end`, Copilot `assistant.usage`).
       * The orchestrator accumulates these into AgentStatus so the dashboard
       * and run-logger have real numbers instead of zeros. All fields are
       * optional because backends differ in what they report.
       */
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      cost?: number;
      model?: string;
    }
  | {
      /**
       * The backend is COMPACTING this agent's context — dropping or
       * summarizing earlier turns to make room.
       *
       * It is the one moment huu can act on the failure mode it otherwise only
       * warns about in prose ("tool results may be compacted away later; the
       * files are the memory that survives"): the constraints the agent was
       * given at turn one — its spec path, the files it owns — are exactly the
       * kind of early instruction compaction is documented to lose.
       *
       * Two responses, both in `handleCompaction`: re-state the constraint into
       * the SAME session on the first event, and stop the card on the third,
       * rather than let it thrash to the wall-clock timeout.
       */
      type: 'compaction';
      /** Backend-reported cause, e.g. pi's `manual` | `threshold` | `overflow`. */
      reason: string;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * One coalesced line of an agent's streamed output, fanned out to
 * `Orchestrator.subscribeAgentOutput` consumers. Distinct from the throttled
 * state snapshot: this is an append-only firehose of exactly what the agent
 * emitted, so a UI can mirror it verbatim (the web server forwards it to the
 * browser console). `text` carries no trailing newline.
 */
export interface AgentOutputChunk {
  agentId: number;
  channel: 'assistant' | 'thinking';
  text: string;
}

export type AgentOutputSubscriber = (chunk: AgentOutputChunk) => void;

/**
 * Prefix tagging a reasoning ("thinking") line where it shares a log buffer
 * with normal reply text — the per-agent log the web card drawer renders. The
 * firehose / browser-console mirror tags thinking with the same brain glyph, so
 * the drawer and the console read consistently. Defined here (the shared
 * orchestrator IO-types module) so the real path, the SimulationEngine and the
 * tests all reference ONE literal.
 */
export const THINKING_LOG_PREFIX = '🧠 ';

/**
 * A spawned worker — abstracts both stub and real LLM agents so the
 * orchestrator stays agnostic of the SDK.
 */
export interface SpawnedAgent {
  agentId: number;
  task: AgentTask;
  /** Sends the user prompt; resolves once the agent reaches a terminal state. */
  prompt(message: string): Promise<void>;
  /**
   * Best-effort cancel of an in-flight prompt. Idempotent. Distinct from
   * dispose(): abort tells the SDK to stop the current request (so the
   * provider stops billing tokens) but leaves listeners and resources
   * alive so dispose() can still publish final teardown events. Used by
   * the orchestrator when a card timeout fires and we want to stop the
   * HTTP request immediately, instead of waiting for it to settle on its
   * own while we tear the agent down.
   */
  abort(): Promise<void>;
  /** Releases resources (LLM session, listeners). */
  dispose(): Promise<void>;
  /**
   * OPTIONAL pause hook (Fase 2.3). Capture a resumable pointer to the agent's
   * persisted session and return a path the orchestrator can later hand back as
   * {@link AgentRuntimeContext.restoreSessionPath} to reconstruct it — so a
   * memory-guard preemption can PAUSE the agent (free its RAM, keep its
   * worktree + transcript) instead of killing it. Returns `null` when no
   * durable checkpoint exists yet (nothing written, backend can't persist):
   * the caller then falls back to the proven kill+requeue (`destroyAgent`), so
   * a missing/failed checkpoint NEVER regresses below today's behavior. Does
   * NOT dispose — the caller disposes immediately after. Backends without
   * persistent sessions omit this method entirely (⇒ always kill+requeue).
   */
  checkpoint?(): Promise<string | null>;
  /**
   * OPTIONAL mid-flight steering. Queues a message that the SDK delivers after
   * the current assistant turn finishes its tool calls and BEFORE the next
   * model call — without cancelling anything and without a second concurrent
   * `prompt()`, which the SDK rejects outright.
   *
   * huu uses it for exactly one thing today: re-stating an agent's write scope
   * immediately after its context was compacted, because that is when the
   * turn-one instructions are documented to go missing. Backends without a
   * steering channel omit the method, and the orchestrator simply logs instead.
   */
  steer?(message: string): Promise<void>;
  /**
   * OPTIONAL transcript capture. Returns the agent's complete visible output
   * — every assistant answer text block, oldest first, as ONE blob — the
   * authoritative record of what the agent produced, independent of which
   * events happened to be forwarded through `onEvent`.
   *
   * The CheckStep judge uses it as the SECOND verdict source (the streamed
   * deltas are the first): backends can drop, truncate or reshape their
   * stream, but the final transcript is the agent's actual answer. Read it
   * AFTER `prompt()` resolves; it must never throw (callers degrade to
   * event-based capture). Backends without a readable transcript omit this
   * method entirely (⇒ event-based capture only, today's behavior).
   */
  getTranscript?(): Promise<string>;
}

/**
 * Per-spawn context the orchestrator threads to the factory: things derived
 * from the agent's worktree that the agent itself needs to know about (port
 * bundle, future: dedicated socket dirs, scratch caches, etc.).
 *
 * Optional so existing callers and stub agents stay source-compatible.
 */
export interface AgentRuntimeContext {
  ports?: AgentPortBundle;
  /**
   * Whether the native bind() interceptor is loaded for this agent's process.
   * Used by the system-prompt generator to tell the LLM whether hardcoded
   * ports in the customer code will be silently remapped or will collide.
   */
  shimAvailable?: boolean;
  /**
   * Request the maximum thinking/reasoning level the chosen model supports.
   * Set by the orchestrator ONLY for the integration (conflict-resolver)
   * agent — resolving merge conflicts is a hard cross-file reasoning task,
   * so the resolver always runs at max thinking regardless of the per-run
   * model. Ignored by models without reasoning support and by the stub.
   */
  maxThinking?: boolean;
  /**
   * Fase 2.3 resume. When set, the factory RECONSTRUCTS the agent's prior
   * session from this path (a checkpoint earlier returned by
   * {@link SpawnedAgent.checkpoint}) instead of starting fresh — the resumed
   * agent sees its earlier transcript and won't redo completed tool calls. Set
   * by the orchestrator's pause→resume path when respawning a paused task into
   * its preserved worktree. Ignored by backends without persistent sessions
   * (they start fresh, idempotently).
   */
  restoreSessionPath?: string;
}

export type AgentFactory = (
  task: AgentTask,
  config: AppConfig,
  systemPromptHint: string,
  cwd: string,
  onEvent: (event: AgentEvent) => void,
  runtimeContext?: AgentRuntimeContext,
) => Promise<SpawnedAgent>;
