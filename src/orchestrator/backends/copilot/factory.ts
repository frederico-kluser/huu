import type { AgentFactory, AgentEvent, SpawnedAgent } from '../../types.js';
import { createDisposableState } from '../_shared/lifecycle.js';
import { buildCopilotMessageHeader } from './system-prompt.js';
import { translateCopilotEvent } from './event-mapper.js';
import { resolveCopilotCreds } from './auth.js';
import { TerminationTracker } from './termination-tracker.js';

/**
 * Local mirrors of the @github/copilot-sdk surface we touch. Kept in
 * the file (instead of `import type`-ing the package directly) because
 * the SDK is an `optionalDependency` — typecheck on machines that
 * skipped optional installs must still pass. The shapes match v0.3.0
 * (Apr 2026); if the SDK breaks compatibility, the factory's runtime
 * dynamic import resolves to the real types and the cast surfaces the
 * mismatch loudly. Mirrors are deliberately narrow (only the methods
 * we call) to keep drift surface small.
 */
type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

interface PermissionRequest {
  kind: 'shell' | 'write' | 'mcp' | 'read' | 'url' | 'custom-tool' | 'memory' | 'hook';
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
}
interface SessionConfig {
  sessionId?: string;
  clientName?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  configDir?: string;
  onPermissionRequest?: PermissionHandler;
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

/**
 * Models known to support reasoning_effort. List comes from the Copilot
 * CLI changelog (Apr 2026) — bare-name shapes (no `<provider>/` prefix).
 * Pi's heuristic in `lib/model-factory.ts` uses OpenRouter-shaped IDs;
 * we can't reuse it as-is.
 *
 * When the user picks a model not on this list (e.g. a future bare-name
 * we haven't catalogued, or a BYOK-only model), we fall back to 'low'
 * so the SDK doesn't reject the request. The orchestrator's behavior
 * is unchanged — thinking is opt-in, not required.
 */
const COPILOT_THINKING_PREFIXES: ReadonlyArray<string> = [
  'claude-opus',
  'claude-sonnet',
  'claude-haiku',
  'gpt-5',
  'gpt-5.3',
  'gpt-5.5',
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
 * One CopilotClient per agent. The client constructor takes `cwd` —
 * which directs the spawned CLI process at the agent's worktree. That's
 * how Copilot gets per-agent filesystem isolation (the SDK's session
 * config has no `workspacePath`, contrary to some early docs). Sharing
 * a client across worktrees would force every session into the same
 * cwd, breaking the orchestrator's worktree-per-task model.
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
        'COPILOT_PROVIDER_BASE_URL). The huu CLI passes these through ' +
        'to the spawned Copilot CLI process automatically when present ' +
        'in the parent environment; we do not mutate process.env here.',
    );
  }
  // Note: creds.env is informational only. We don't mutate process.env
  // because the SDK spawns the CLI subprocess inheriting the parent
  // env — and parallel Copilot agents would race on shared process.env
  // mutations. Whoever launched huu must already have the token in env
  // (or in /run/secrets/copilot_token, which copilot CLI reads
  // directly). resolveCopilotCreds.hasAuth verifies that's true.

  const sdk = await loadSdk();
  const client = new sdk.CopilotClient({ cwd, autoStart: false });
  await client.start();

  const tracker = new TerminationTracker();
  // Stable, agent-scoped session id makes debugging via the persisted
  // events.jsonl trivial: `ls $cwd/.huu/copilot-state/session-state/huu-*`.
  const sessionId = `huu-${task.agentId}-${Date.now()}`;
  // Per-agent configDir prevents collisions on session-store.db
  // (issue copilot-cli/2609). Lives under the agent's worktree so
  // worktree teardown reclaims the space automatically.
  const configDir = `${cwd}/.huu/copilot-state`;

  let session: CopilotSessionInstance;
  try {
    session = await client.createSession({
      sessionId,
      clientName: 'huu',
      model: modelId,
      reasoningEffort: reasoningEffortFor(modelId),
      configDir,
      onPermissionRequest: sdk.approveAll,
      // We embed the role/scope/git-context header inside the user
      // message (same approach as Pi >= 0.70). This keeps the SDK's
      // built-in coding-agent persona and adds our task-specific rules
      // on top. A future PR can move the header to systemMessage.append.
    });
  } catch (err) {
    await client.stop().catch(() => {});
    throw err;
  }

  // Translation handler: install IMMEDIATELY after createSession so we
  // capture early events (some SDK versions emit `session.start` before
  // returning from createSession; capturing it here is best-effort).
  const unsubscribeTranslator = session.on((event: unknown) => {
    try {
      translateCopilotEvent(event, onEvent);
    } catch (err) {
      onEvent({
        type: 'log',
        level: 'warn',
        message: `event translate error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Completion-waiter listener cleanups must be reachable from
  // dispose() so a forced teardown (orchestrator timeout, SIGINT) can
  // unhook them — otherwise the inner Promise leaks.
  let completionUnsubscribers: Array<() => void> = [];

  const lifecycle = createDisposableState([
    () => unsubscribeTranslator(),
    () => {
      for (const off of completionUnsubscribers) {
        try {
          off();
        } catch {
          /* */
        }
      }
      completionUnsubscribers = [];
    },
    async () => {
      try {
        await session.abort();
      } catch {
        /* */
      }
    },
    async () => {
      try {
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
  ]);

  const spawned: SpawnedAgent = {
    agentId: task.agentId,
    task,
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
      // The SDK fires `session.idle` once the assistant finishes.
      // For very fast turns (BYOK to a local model, cached responses)
      // idle can fire synchronously with send's promise resolving;
      // attaching afterwards would miss it and the await-completion
      // promise would hang forever.
      const completion = new Promise<void>((resolve, reject) => {
        const offIdle = session.on('session.idle', () => {
          cleanupCompletionListeners();
          resolve();
        });
        const offError = session.on('session.error', (ev) => {
          cleanupCompletionListeners();
          const data =
            ev && typeof ev === 'object' && 'data' in ev
              ? (ev as { data?: { message?: string } }).data
              : undefined;
          const msg = data?.message ?? 'session error';
          tracker.markError(new Error(msg));
          reject(new Error(msg));
        });
        const offShutdown = session.on('session.shutdown', () => {
          cleanupCompletionListeners();
          // session.shutdown collapses true reason into routine|error
          // (issue copilot-cli/2852). We treat it as success here and
          // let the tracker carry whatever was already marked (timeout,
          // abort) by the time we get here.
          resolve();
        });
        completionUnsubscribers = [offIdle, offError, offShutdown];
        function cleanupCompletionListeners(): void {
          for (const off of completionUnsubscribers) {
            try {
              off();
            } catch {
              /* */
            }
          }
          completionUnsubscribers = [];
        }
      });

      try {
        await session.send({ prompt: fullMessage });
        await completion;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/timeout/i.test(msg)) tracker.markTimeout();
        else if (!tracker.finalize().reason || tracker.finalize().reason === 'complete') {
          tracker.markError(err);
        }
        emitError(onEvent, msg);
        throw err;
      }

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
