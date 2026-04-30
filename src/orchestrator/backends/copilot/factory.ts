import type { AgentFactory, SpawnedAgent } from '../../types.js';
import { createDisposableState } from '../_shared/lifecycle.js';
import { buildCopilotMessageHeader } from './system-prompt.js';
import { translateCopilotEvent } from './event-mapper.js';
import { resolveCopilotCreds } from './auth.js';
import { TerminationTracker } from './termination-tracker.js';

/**
 * Local structural typing of the bits of `@github/copilot-sdk` we touch.
 * We deliberately don't `import type` the SDK so the package can be an
 * optionalDependency — typecheck must pass on machines that haven't
 * installed it. The runtime behavior comes from the dynamic import in
 * `loadSdk()`. If the SDK changes shape, our adapter breaks loud at
 * runtime (clear error in the factory) rather than silently at typecheck
 * with a confusing message.
 */
interface CopilotSdkModule {
  CopilotClient: new (opts: {
    autoStart?: boolean;
    cliArgs?: string[];
    cliPath?: string;
    cliUrl?: string;
  }) => CopilotClientInstance;
  approveAll: unknown;
}

interface CopilotClientInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  createSession(opts: unknown): Promise<CopilotSessionInstance>;
}

interface CopilotSessionInstance {
  on(handler: (ev: unknown) => void): () => void;
  send(opts: unknown): Promise<void>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Maps the orchestrator's notion of "thinking" to Copilot's
 * `reasoningEffort`. Pi has `medium | off`; Copilot accepts
 * `low | medium | high | xhigh`. The orchestrator currently only ever
 * passes `medium | off`, so a 1:1 mapping is enough.
 */
function thinkingToReasoning(level: 'medium' | 'off'): 'low' | 'medium' {
  return level === 'medium' ? 'medium' : 'low';
}

/**
 * Decides if a model id looks like one Copilot can serve directly. We do
 * NOT block: Copilot accepts arbitrary `--model` and the SDK forwards.
 * The check is only used to emit a clear warning when the user tries
 * `claude-sonnet-4.6` (Copilot id) on Pi or `deepseek/deepseek-v4-pro`
 * (OpenRouter id) on Copilot.
 */
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
 * The dynamic import path is built at runtime so TypeScript's
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
            `Run \`npm i @github/copilot-sdk\` (or rebuild the Docker image). ` +
            `Original error: ${msg}`,
        );
      }
    })();
  }
  return sdkLoadPromise;
}

/**
 * One CopilotClient per agent. Sharing a client across worktrees works
 * for small N but breaks the LD_PRELOAD-per-agent model: the bind()
 * shim's port range comes from the spawned process env, and a shared
 * client only spawns once. Per-agent isolation costs ~1 process per
 * agent, which is the same overhead the Pi backend already accepts via
 * its in-memory session.
 */
async function createCopilotClient(env: Record<string, string>): Promise<{
  client: CopilotClientInstance;
  shutdown: () => Promise<void>;
}> {
  const sdk = await loadSdk();
  const client = new sdk.CopilotClient({
    autoStart: false,
    // The SDK's CLI server inherits the parent process env. Merging here
    // means any LD_PRELOAD / .env.huu / BYOK vars set by the orchestrator
    // before this call propagate to the underlying `copilot` binary.
    // Note: the public `CopilotClientOptions` does not formally document
    // an `env` field. If a future SDK version exposes it, switch to
    // passing `env` directly here.
    cliArgs: [],
  });

  // process.env mutation is scoped to this call only; the factory
  // restores prior values on dispose. We do this because the SDK's
  // documented surface (Apr 2026) accepts no env override.
  const previousEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previousEnv[k] = process.env[k];
    process.env[k] = v;
  }

  await client.start();

  return {
    client,
    shutdown: async () => {
      try {
        await client.stop();
      } catch {
        // best effort — `forceStop` exists on some versions but is not
        // part of the public type; cast and try.
        const maybe = client as unknown as { forceStop?: () => Promise<void> };
        if (typeof maybe.forceStop === 'function') {
          try {
            await maybe.forceStop();
          } catch {
            /* swallow */
          }
        }
      }
      for (const [k, v] of Object.entries(previousEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

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
        'COPILOT_PROVIDER_BASE_URL). See backends/copilot/auth.ts.',
    );
  }

  const env: Record<string, string> = { ...creds.env };
  // Isolate per-run state so `huu prune` (future PR) can target it
  // without nuking the user's interactive Copilot home.
  if (!process.env.COPILOT_HOME) {
    env.COPILOT_HOME = `${cwd}/.huu/copilot-state`;
  }

  const { client, shutdown } = await createCopilotClient(env);

  const sdk = await loadSdk();
  const tracker = new TerminationTracker();

  // Each session gets a deterministic id so debugging via the persisted
  // events.jsonl is straightforward. Keys with `huu-` prefix make the
  // future `huu prune --copilot-state` filter trivial.
  const sessionId = `huu-${task.agentId}-${Date.now()}`;

  const session = await client.createSession({
    sessionId,
    model: modelId as never,
    streaming: true,
    reasoningEffort: thinkingToReasoning(
      // Pi-style label. The orchestrator doesn't pass `thinkingLevel`
      // through `AppConfig` today, so we default to 'medium' until that
      // wiring lands. This mirrors what the Pi factory does.
      'medium',
    ),
    onPermissionRequest: sdk.approveAll,
    systemMessage: { mode: 'append', content: '' },
    // Tools default to the CLI's built-ins (bash, edit_file, view, ...).
    // Custom tools could be added here once the orchestrator needs to
    // emit signals (see plan §B.4).
  } as never);

  const unsubscribe = session.on((ev: unknown) => {
    try {
      translateCopilotEvent(ev, onEvent);
    } catch (err) {
      onEvent({
        type: 'log',
        level: 'warn',
        message: `event translate error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  const lifecycle = createDisposableState([
    () => {
      try {
        unsubscribe();
      } catch {
        /* */
      }
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
    () => shutdown(),
  ]);

  // Ports + shim availability go into the Copilot system prompt the same
  // way Pi consumes them. Backends are agnostic about WHO consumes the
  // ports; both LLM and the agent's spawned bash inherit the same env.
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

      try {
        await session.send({ prompt: fullMessage } as never);
        await waitIdleOrShutdown(session);
      } catch (err) {
        tracker.markError(err);
        const msg = err instanceof Error ? err.message : String(err);
        onEvent({ type: 'error', message: msg });
        throw err;
      }

      const final = tracker.finalize();
      if (final.reason === 'error' || final.reason === 'timeout') {
        const text = final.message ?? `terminated: ${final.reason}`;
        onEvent({ type: 'error', message: text });
        throw new Error(text);
      }
      onEvent({ type: 'done' });
    },
    dispose: lifecycle.dispose,
  };

  return spawned;
};

/**
 * Resolves on the first `session.idle` (turn end) or `session.shutdown`
 * (real terminal). Returns even if the session emits an error event —
 * the factory's prompt() inspects the TerminationTracker afterwards.
 */
async function waitIdleOrShutdown(session: {
  on: (cb: (ev: unknown) => void) => () => void;
}): Promise<void> {
  return new Promise<void>((resolve) => {
    const off = session.on((ev: unknown) => {
      const t = (ev as { type?: string })?.type;
      if (t === 'session.idle' || t === 'session.shutdown' || t === 'session.error') {
        try {
          off();
        } catch {
          /* */
        }
        resolve();
      }
    });
  });
}
