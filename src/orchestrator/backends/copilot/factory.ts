import { join } from 'node:path';
import type { AgentFactory, AgentEvent, SpawnedAgent } from '../../types.js';
import { createDisposableState } from '../_shared/lifecycle.js';
import { buildCopilotMessageHeader } from './system-prompt.js';
import { createCopilotEventTranslator } from './event-mapper.js';
import { resolveCopilotCreds } from './auth.js';
import { TerminationTracker } from './termination-tracker.js';
import { createEventRecorder, type EventRecorder } from './event-recorder.js';
import { sweepOrphanLocks } from './lock-sweep.js';

/**
 * Local mirrors of the @github/copilot-sdk surface we touch. Kept in
 * the file (instead of `import type`-ing the package directly) because
 * the SDK is an `optionalDependency` — typecheck on machines that
 * skipped optional installs must still pass. The shapes match v0.3.0
 * (Apr 2026, dist/types.d.ts); if the SDK breaks compatibility, the
 * factory's runtime dynamic import resolves to the real types and the
 * cast surfaces the mismatch loudly. Mirrors are deliberately narrow
 * (only the fields we touch) to keep drift surface small.
 */
type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

interface PermissionRequest {
  // Eight kinds per @github/copilot-sdk@0.3.0 dist/types.d.ts
  // PermissionRequest interface — `hook` is a real permission kind
  // emitted when SessionHooks return `permissionDecision: 'ask'`. We
  // approve all kinds via `sdk.approveAll`, but mirror the full union
  // so a future narrower handler doesn't silently drop a kind.
  kind:
    | 'shell'
    | 'write'
    | 'mcp'
    | 'read'
    | 'url'
    | 'custom-tool'
    | 'memory'
    | 'hook';
  toolCallId?: string;
}
type PermissionHandler = (
  request: PermissionRequest,
  invocation: { sessionId: string },
) => unknown;

interface CopilotClientOptions {
  cliPath?: string;
  cliArgs?: string[];
  cwd?: string;
  port?: number;
  useStdio?: boolean;
  autoStart?: boolean;
  /**
   * Per CopilotClientOptions docstring: "GitHub token to use for
   * authentication. When provided, the token is passed to the CLI
   * server via environment variable. This takes priority over other
   * authentication methods." We use this only for file-based sources
   * (Docker secret / `_FILE` env pattern) where the spawned CLI
   * cannot inherit from process.env.
   */
  gitHubToken?: string;
}
interface SessionConfig {
  sessionId?: string;
  clientName?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  configDir?: string;
  // SessionConfig.workingDirectory (SDK 0.3.0): "Tool operations will
  // be relative to this directory." Distinct from CopilotClient.cwd
  // which is the spawned CLI process's working directory. We set both
  // to the worktree path: the client cwd anchors `git status` /
  // similar process-cwd-aware tools, and workingDirectory anchors
  // SDK-level file ops.
  workingDirectory?: string;
  onPermissionRequest?: PermissionHandler;
  // Registering an event handler here (instead of via session.on after
  // createSession resolves) guarantees we capture early events emitted
  // during session creation — notably session.context_changed, which
  // can fire before createSession's promise resolves on slow CLI
  // startups. Listed in SessionConfig (SDK 0.3.0).
  onEvent?: (ev: unknown) => void;
  systemMessage?:
    | { mode?: 'append'; content?: string }
    | { mode: 'replace'; content: string };
}
interface MessageOptions {
  prompt: string;
}

interface CopilotSdkModule {
  CopilotClient: new (opts?: CopilotClientOptions) => CopilotClientInstance;
  approveAll: PermissionHandler;
}

interface CopilotClientInstance {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  forceStop?(): Promise<void>;
  createSession(opts: SessionConfig): Promise<CopilotSessionInstance>;
}

interface CopilotSessionInstance {
  on(handler: (ev: unknown) => void): () => void;
  on(eventType: string, handler: (ev: unknown) => void): () => void;
  send(opts: MessageOptions): Promise<string>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

const COPILOT_THINKING_PREFIXES: ReadonlyArray<string> = [
  'claude-opus',
  'claude-sonnet',
  'claude-haiku',
  'gpt-5',
  'gemini-3',
  'o1',
  'o3',
  'o4',
];

function copilotSupportsThinking(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return COPILOT_THINKING_PREFIXES.some((p) => lower.startsWith(p));
}

function reasoningEffortFor(modelId: string): ReasoningEffort {
  return copilotSupportsThinking(modelId) ? 'medium' : 'low';
}

function looksLikeCopilotModel(id: string): boolean {
  // Copilot uses bare names without a `<provider>/` prefix.
  return !id.includes('/');
}

/**
 * Extract the run id from a worktree's branch name. The orchestrator's
 * branch convention is `huu/<runId>/agent-<id>` (regular) or
 * `huu/<runId>/integration` (integration agent). We use this to scope
 * the event-recorder file to a single run, even though AgentTask
 * doesn't carry runId directly. Falls back to a timestamp so the
 * recorder always has a filename.
 */
function runIdFromBranch(branchName: string): string {
  const m = /^huu\/([^/]+)\//.exec(branchName);
  return m?.[1] ?? `unknown-${Date.now()}`;
}

/**
 * The Copilot SDK is loaded lazily so a `huu --backend=pi` run never
 * pays for it (and a missing optional dep doesn't break the import
 * graph). The cached promise dedupes concurrent loads when the user
 * launches multiple Copilot agents at once.
 *
 * The dynamic-import target is built from a local string so TypeScript's
 * resolver doesn't try to verify the module exists at typecheck time
 * (the package is an optionalDependency).
 */
let sdkLoadPromise: Promise<CopilotSdkModule> | null = null;
async function loadSdk(): Promise<CopilotSdkModule> {
  if (!sdkLoadPromise) {
    sdkLoadPromise = (async () => {
      try {
        const moduleName = '@github/copilot-sdk';
        const mod = (await import(moduleName)) as CopilotSdkModule;
        return mod;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Copilot backend selected but @github/copilot-sdk is not installed. ` +
            `Run \`npm install @github/copilot-sdk\` (it's an optionalDependency, ` +
            `so npm may have skipped it). Original error: ${msg}`,
        );
      }
    })();
  }
  return sdkLoadPromise;
}

/**
 * One CopilotClient per agent. Per-worktree filesystem isolation comes
 * from setting BOTH:
 *   - `CopilotClient({ cwd })`     — spawned CLI process working dir
 *   - `createSession({ workingDirectory })` — SDK-level tool op anchor
 * Sharing a client across worktrees would force every session into the
 * same cwd, breaking the orchestrator's worktree-per-task model.
 *
 * NOTE: SessionConfig.configDir is being superseded by the SessionFs
 * abstraction (CopilotClientOptions.sessionFs in SDK 0.3.0). Migrating
 * is a future PR — the current behavior (per-worktree configDir) is
 * correct for v0.3.0 but may break in a future major.
 */
export const copilotAgentFactory: AgentFactory = async (
  task,
  config,
  _systemPromptHint,
  cwd,
  onEvent,
  runtimeContext,
) => {
  const modelId = config.modelId.trim();
  if (!modelId) throw new Error('Model ID ausente.');

  if (!looksLikeCopilotModel(modelId)) {
    onEvent({
      type: 'log',
      level: 'warn',
      message: `Copilot backend with non-Copilot model id "${modelId}". Expected bare names like "claude-sonnet-4.6". Forwarding anyway.`,
    });
  }

  const creds = resolveCopilotCreds();
  if (!creds.hasAuth) {
    throw new Error(
      'Copilot credentials missing. Set COPILOT_GITHUB_TOKEN, GH_TOKEN, ' +
        'GITHUB_TOKEN, or BYOK env vars (COPILOT_PROVIDER_API_KEY + ' +
        'COPILOT_PROVIDER_BASE_URL). For Docker, mount a secret at ' +
        '/run/secrets/copilot_token or set COPILOT_GITHUB_TOKEN_FILE. ' +
        'Env-var sources are inherited by the spawned Copilot CLI ' +
        'natively; file-based sources are forwarded via the SDK\'s ' +
        '`gitHubToken` option (we do not mutate process.env here).',
    );
  }
  onEvent({
    type: 'log',
    message: `copilot auth: ${creds.source}`,
  });

  // Sweep orphan inuse.<pid>.lock files left behind by previous
  // SIGTERM'd runs in this worktree. Issue copilot-cli/2609: the SDK
  // hangs on the mutex if a stale lock exists. Cheap, bounded — at
  // most a few dirs to scan in a fresh worktree.
  const configDir = join(cwd, '.huu', 'copilot-state');
  const swept = sweepOrphanLocks(join(configDir, 'session-state'));
  if (swept > 0) {
    onEvent({
      type: 'log',
      level: 'warn',
      message: `swept ${swept} orphan inuse.*.lock file(s) (#2609 workaround)`,
    });
  }

  const sdk = await loadSdk();
  // Forward file-based tokens explicitly — the spawned CLI can't see
  // /run/secrets/copilot_token or COPILOT_GITHUB_TOKEN_FILE on its
  // own. For env-var sources, creds.token is undefined and the CLI
  // inherits via process.env naturally.
  const client = new sdk.CopilotClient({
    cwd,
    autoStart: false,
    ...(creds.token ? { gitHubToken: creds.token } : {}),
  });
  await client.start();

  const tracker = new TerminationTracker();
  const sessionId = `huu-${task.agentId}-${Date.now()}`;

  // Mirror raw events to a project-owned JSONL file. Reading the SDK's
  // own events.jsonl is risky (issues #2012, #2217, #2490, #2609,
  // #2649 all corrupt or block it). Our mirror sidesteps those by
  // writing what we see on the wire.
  const recorder: EventRecorder = createEventRecorder({
    rootDir: cwd,
    runId: runIdFromBranch(task.branchName),
    agentId: task.agentId,
  });
  onEvent({ type: 'log', message: `copilot events → ${recorder.path}` });

  // Stateful translator: tracks toolCallId → toolName from
  // tool.execution_start so tool.execution_complete (which carries
  // only toolCallId per SDK 0.3.0) can be reported with a real name.
  const translate = createCopilotEventTranslator();
  const dispatchEvent = (event: unknown): void => {
    try {
      recorder.write(event);
    } catch {
      /* recorder is best-effort */
    }
    try {
      translate(event, onEvent);
    } catch (err) {
      onEvent({
        type: 'log',
        level: 'warn',
        message: `event translate error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  let session: CopilotSessionInstance;
  try {
    session = await client.createSession({
      sessionId,
      clientName: 'huu',
      model: modelId,
      reasoningEffort: reasoningEffortFor(modelId),
      configDir,
      // Anchor SDK tool operations to the agent's worktree. Distinct
      // from CopilotClient.cwd above — see class docstring.
      workingDirectory: cwd,
      onPermissionRequest: sdk.approveAll,
      // onEvent hooks BEFORE session.create so early events emitted
      // during creation (session.context_changed, the first
      // session.usage_info) are not lost. Equivalent to session.on(fn)
      // but executes earlier in the lifecycle.
      onEvent: dispatchEvent,
      // Role/scope/git-context header is embedded in the user message
      // (parity with Pi >=0.70). Keeps SDK's coding-agent persona and
      // adds task-specific rules on top. Future PR can move to
      // systemMessage.append once we tune the SDK guardrails.
    });
  } catch (err) {
    recorder.close();
    await client.stop().catch(() => {});
    throw err;
  }

  // Completion-waiter listener cleanups must be reachable from
  // dispose() so a forced teardown (orchestrator timeout, SIGINT) can
  // unhook them — otherwise the inner Promise leaks. Initialised here
  // and PUSHED into (not assigned) so a synchronous SDK callback fired
  // during session.on() registration always sees the unsubscribe in
  // the array (assignment-after-three-on-calls had a TOCTOU window).
  const completionUnsubscribers: Array<() => void> = [];
  const cleanupCompletionListeners = (): void => {
    while (completionUnsubscribers.length > 0) {
      const off = completionUnsubscribers.pop();
      if (!off) continue;
      try {
        off();
      } catch {
        /* */
      }
    }
  };

  // Dispose ordering matters. abort() may emit final session.idle /
  // session.shutdown events that the translator and recorder must
  // still capture — so we KEEP the dispatcher alive across abort and
  // rely on session.disconnect() to release in-memory handlers (the
  // SDK guarantees this per CopilotSession.disconnect docstring).
  // The previous order (unsubscribe → abort) silently dropped final
  // events from BOTH the live UI stream and the mirrored JSONL file.
  const lifecycle = createDisposableState([
    async () => {
      try {
        await session.abort();
      } catch {
        /* */
      }
    },
    // Most often a no-op: when abort emits session.idle, the
    // completion listener's own callback already cleaned itself up.
    // This catches the "abort emitted no events" case.
    () => cleanupCompletionListeners(),
    async () => {
      try {
        // disconnect() releases all session handlers (the dispatch
        // handler registered via SessionConfig.onEvent and any
        // session.on registrations made later). After this returns,
        // no more events will arrive.
        await session.disconnect();
      } catch {
        /* */
      }
    },
    async () => {
      try {
        await client.stop();
      } catch {
        if (typeof client.forceStop === 'function') {
          try {
            await client.forceStop();
          } catch {
            /* */
          }
        }
      }
    },
    () => recorder.close(),
  ]);

  const spawned: SpawnedAgent = {
    agentId: task.agentId,
    task,
    async abort(): Promise<void> {
      if (lifecycle.isDisposed()) return;
      try {
        await session.abort();
      } catch {
        /* best-effort — dispose() chain still calls abort as a safety net */
      }
    },
    async prompt(message: string): Promise<void> {
      lifecycle.assertLive();
      const fullMessage = buildCopilotMessageHeader(
        task,
        message,
        cwd,
        runtimeContext?.ports,
        runtimeContext?.shimAvailable ?? false,
      );

      // CRITICAL: install completion listeners BEFORE calling send().
      // The SDK fires `session.idle` once the assistant finishes. For
      // very fast turns (BYOK to a local model, cached responses) idle
      // can fire synchronously with send's promise resolving;
      // attaching afterwards would miss it and the await-completion
      // promise would hang forever.
      const completion = new Promise<void>((resolve, reject) => {
        completionUnsubscribers.push(
          session.on('session.idle', () => {
            cleanupCompletionListeners();
            resolve();
          }),
        );
        completionUnsubscribers.push(
          session.on('session.error', (ev) => {
            cleanupCompletionListeners();
            const data =
              ev && typeof ev === 'object' && 'data' in ev
                ? (ev as { data?: { message?: string } }).data
                : undefined;
            const msg = data?.message ?? 'session error';
            tracker.markError(new Error(msg));
            reject(new Error(msg));
          }),
        );
        completionUnsubscribers.push(
          session.on('session.shutdown', () => {
            cleanupCompletionListeners();
            // session.shutdown collapses true reason into routine|error
            // (issue copilot-cli/2852). Treat as success here; the
            // tracker carries whatever was already marked (timeout,
            // abort) by the time we get here.
            resolve();
          }),
        );
      });

      try {
        await session.send({ prompt: fullMessage });
        await completion;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // `reasonBeforeMark` distinguishes "we are the first to know
        // about this error" from "the SDK already emitted session.error
        // upstream and the translator already published it as an
        // AgentEvent". In the latter case, emitting again here makes
        // the orchestrator process the agent as errored twice.
        const reasonBeforeMark = tracker.finalize().reason;
        let weMarked = false;
        if (/timeout/i.test(msg)) {
          tracker.markTimeout();
          weMarked = true;
        } else if (reasonBeforeMark === 'complete') {
          tracker.markError(err);
          weMarked = true;
        }
        // Only emit when the translator hasn't beaten us to it. The
        // session.error path through the translator is the canonical
        // emitter when the SDK reports a session-level error; otherwise
        // (RPC failure, our own bug) we are the canonical emitter.
        if (weMarked) emitError(onEvent, msg);
        throw err;
      }

      // Reached only when send + completion both resolved cleanly.
      // tracker.finalize() is called once here; previous code called
      // it twice for no benefit.
      const final = tracker.finalize();
      if (final.reason === 'error' || final.reason === 'timeout') {
        const text = final.message ?? `terminated: ${final.reason}`;
        emitError(onEvent, text);
        throw new Error(text);
      }
      onEvent({ type: 'done' });
    },
    dispose: lifecycle.dispose,
  };

  return spawned;
};

function emitError(
  onEvent: (e: AgentEvent) => void,
  message: string,
): void {
  onEvent({ type: 'error', message });
}
