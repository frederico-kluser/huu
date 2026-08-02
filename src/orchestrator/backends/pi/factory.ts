import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import { getModel, clampThinkingLevel, type ModelThinkingLevel } from '@mariozechner/pi-ai';
import type { AgentEvent, AgentFactory, SpawnedAgent } from '../../types.js';
import { supportsThinking } from '../../../lib/model-factory.js';
import {
  fetchModelCapabilities,
  modelSupportsReasoning,
} from '../../../lib/openrouter.js';
import { buildAgentMessageHeader } from '../_shared/build-message.js';
import { createDisposableState } from '../_shared/lifecycle.js';
import { translatePiEvent } from './event-mapper.js';
import { buildPiSessionEnvironment } from './hermetic.js';

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/huu',
  'X-OpenRouter-Title': 'huu',
};

/**
 * The tool allowlist huu hands pi for a REPORT-ONLY role.
 *
 * pi's `tools` option is an allowlist of NAMES and a HARD filter: names not on
 * it never enter the tool registry, and the system prompt is rebuilt from the
 * surviving set — so the model is not even told the missing tools exist
 * (`core/agent-session.js`). That is what turns "You do NOT write code" from a
 * sentence the model may weigh against its instructions into a capability it
 * does not have.
 *
 * `bash` stays, deliberately, and this is therefore a REDUCTION, not a sandbox:
 * `cat > file` still writes. The critic and the judge are both REQUIRED to run
 * the project's own build/test commands before they may conclude anything, and
 * withholding `bash` would break the one rule that anchors them to something
 * executable. What it does remove is the tool a reporter reaches for by reflex
 * when it notices a defect — and an accidental edit inside the INTEGRATION
 * worktree, where it would ride into the landing merge as if an agent had
 * authored it. Do not describe it as a guarantee.
 *
 * (pi's own `createReadOnlyTools` preset is read+grep+find+ls — no bash — which
 * is why this list is spelled out here rather than borrowed.)
 */
export const READ_ONLY_TOOL_NAMES = ['read', 'bash', 'grep', 'find', 'ls'] as const;

/**
 * Pick the allowlist for one spawn.
 *
 * A WRITING agent gets `undefined` — "leave pi's default alone" — and that is a
 * deliberate refusal to smuggle a capability EXPANSION inside a restriction
 * change. pi ships `grep`, `find` and `ls` unenabled, and turning them on for
 * every agent of every existing pipeline would change each one's system prompt,
 * token profile and tool-choice behavior with no option set and no measurement
 * behind it. huu's rule is that an absent option produces byte-identical
 * behavior; that rule does not have an exception for improvements. Enabling the
 * search tools is its own change, with its own justification.
 *
 * A read-only role is restricted on every path, hermetic or not: passing an
 * allowlist also disables extension tools, and the `HUU_PI_HERMETIC=0` escape
 * hatch exists to reproduce plain pi — but a judge standing in the integration
 * worktree with `write` is a correctness problem, and correctness outranks
 * debug parity.
 */
export function pickToolAllowlist(readOnly: boolean, _hermetic: boolean): string[] | undefined {
  return readOnly ? [...READ_ONLY_TOOL_NAMES] : undefined;
}

async function resolveThinkingLevel(
  modelId: string,
  apiKey: string,
  onEvent: (e: AgentEvent) => void,
): Promise<'medium' | 'off'> {
  if (supportsThinking(modelId)) return 'medium';
  try {
    const capabilities = await fetchModelCapabilities(apiKey);
    if (modelSupportsReasoning(modelId, capabilities)) return 'medium';
    return 'off';
  } catch (err) {
    // Capability probe failed (network blip, OpenRouter 5xx, rate limit).
    // Without this log, the user picks a thinking-capable model, pays for
    // it, and silently gets non-thinking responses.
    onEvent({
      type: 'log',
      level: 'warn',
      message: `thinking capability check failed for ${modelId}: ${
        err instanceof Error ? err.message : String(err)
      } — defaulting to thinkingLevel='off'`,
    });
    return 'off';
  }
}

/** Ascending strength order of the Pi SDK thinking levels. */
const THINKING_LEVEL_ORDER: ModelThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

/**
 * Pick the effective thinking level for an agent. `base` is what we'd use
 * normally (from `resolveThinkingLevel`). When `maxThinking` is requested
 * (the conflict-resolver agent) and the model actually reasons, bump up to
 * the model's true maximum (`modelMax`, from `clampThinkingLevel(model,
 * 'xhigh')`) — but NEVER below `base`, so a model that only supports a low
 * level can't accidentally downgrade the resolver, and a non-thinking model
 * (`base === 'off'`) stays off. Pure + networkless, so it is unit-tested.
 */
export function pickThinkingLevel(
  base: ModelThinkingLevel,
  maxThinking: boolean,
  modelMax: ModelThinkingLevel,
): ModelThinkingLevel {
  if (!maxThinking || base === 'off') return base;
  return THINKING_LEVEL_ORDER.indexOf(modelMax) > THINKING_LEVEL_ORDER.indexOf(base)
    ? modelMax
    : base;
}

export type PiSessionPlan =
  | { mode: 'open'; sessionFile: string }
  | { mode: 'create'; sessionDir: string };

/**
 * Fase 2.3 session-plan decision, pure (injectable `exists` for tests):
 * resume from a checkpoint (`open`) when the orchestrator threaded a
 * `restoreSessionPath` that still exists on disk; otherwise `create` a fresh
 * persisted session. Two load-bearing properties, both pinned by tests:
 *  - the fresh `sessionDir` is a SIBLING of the worktree
 *    (`<worktree-root>/.huu-sessions/<agent-dir>` — `dirname(cwd)` is the
 *    run's `.huu-worktrees/<runId>/`), NEVER inside `cwd`: finalize's
 *    `git stageAll` would otherwise commit pi's transcript into the user's
 *    repo.
 *  - a restore path whose file vanished (session dir swept) DEGRADES to
 *    create-fresh in the still-preserved worktree — files on disk survive,
 *    only the transcript restarts. Never throws.
 */
export function resolvePiSessionPlan(
  cwd: string,
  restoreSessionPath: string | undefined,
  exists: (p: string) => boolean = existsSync,
): PiSessionPlan {
  if (restoreSessionPath && exists(restoreSessionPath)) {
    return { mode: 'open', sessionFile: restoreSessionPath };
  }
  return { mode: 'create', sessionDir: join(dirname(cwd), '.huu-sessions', basename(cwd)) };
}

/**
 * Reduce a pi session's message array to the agent's visible output: the
 * `text` content blocks of every assistant message, oldest first, joined
 * into one blob. Thinking blocks, tool calls, user prompts and tool
 * results are excluded — the judge's verdict is delivered as ANSWER text
 * (the output contract demands a final JSON block in the final message),
 * and the reasoning trace is deliberately not a verdict source (huu
 * already ignores the thinking stream for the same reason).
 *
 * Structurally typed on purpose: pi's `AgentMessage` shape comes from
 * `@mariozechner/pi-agent-core`, a TRANSITIVE dependency of
 * `pi-coding-agent` — importing it directly here would be a phantom
 * dependency. The shape is stable (role + content blocks with
 * `type: 'text'`).
 */
export function sessionTranscriptText(messages: readonly unknown[]): string {
  const parts: string[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as { role?: unknown; content?: unknown };
    if (msg.role !== 'assistant') continue;
    const content = msg.content;
    if (typeof content === 'string') {
      parts.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: unknown; text?: unknown };
        if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      }
    }
  }
  return parts.join('\n');
}

export const piAgentFactory: AgentFactory = async (
  task,
  config,
  _systemPromptHint,
  cwd,
  onEvent,
  runtimeContext,
) => {  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error('OpenRouter API key missing. Set OPENROUTER_API_KEY.');
  const modelId = config.modelId.trim();
  if (!modelId) throw new Error('Model ID missing.');

  // Hermetic composition: in-memory auth/registry/settings + a discovery-off
  // resource loader (scoped repo context only). See hermetic.ts for why —
  // the SDK defaults would load host-global ~/.pi config and npm pi-* extensions.
  const piEnv = await buildPiSessionEnvironment({
    provider: 'openrouter',
    apiKey,
    providerConfig: { headers: OPENROUTER_HEADERS },
    cwd,
  });

  const model = getModel('openrouter', modelId as never);
  if (!model) {
    throw new Error(
      `Model "${modelId}" not found in the Pi SDK registry for provider "openrouter". ` +
        `Check the ID or the installed version of @mariozechner/pi-ai.`,
    );
  }

  const baseThinking = await resolveThinkingLevel(modelId, apiKey, onEvent);
  // The conflict-resolver (integration) agent runs at the model's max thinking
  // level; regular agents keep the base level.
  const thinkingLevel = pickThinkingLevel(
    baseThinking,
    runtimeContext?.maxThinking ?? false,
    clampThinkingLevel(model, 'xhigh'),
  );

  // Fase 2.3: persist the session so a memory-guard preemption can PAUSE this
  // agent (checkpoint → reconstruct later) instead of killing it — the plan
  // decision lives in resolvePiSessionPlan (pure, tested). When restoring
  // (resume), OPEN the checkpoint so the agent continues from its prior
  // transcript; `cwdOverride = cwd` re-points it at the (reused) worktree.
  // Verified end to end by the P0 runtime spike (abort mid-task → open →
  // continue, no redo).
  const toolAllowlist = pickToolAllowlist(task.readOnly === true, piEnv.hermetic);

  const plan = resolvePiSessionPlan(cwd, runtimeContext?.restoreSessionPath);
  const sessionManager =
    plan.mode === 'open'
      ? SessionManager.open(plan.sessionFile, undefined, cwd)
      : SessionManager.create(cwd, plan.sessionDir);

  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    sessionManager,
    authStorage: piEnv.authStorage,
    modelRegistry: piEnv.modelRegistry,
    // Hermetic injection (undefined under HUU_PI_HERMETIC=0 → SDK defaults):
    // huu-owned agentDir, in-memory settings, discovery-off resource loader.
    agentDir: piEnv.agentDir,
    settingsManager: piEnv.settingsManager,
    resourceLoader: piEnv.resourceLoader,
    cwd,
    // The role's tool allowlist. Absent ⇒ pi's own default (read/bash/edit/write),
    // which is what a non-hermetic writing agent still gets.
    ...(toolAllowlist ? { tools: toolAllowlist } : {}),
  });

  const unsubscribe = session.subscribe((event: unknown) => {
    try {
      translatePiEvent(event, onEvent);
    } catch (err) {
      onEvent({
        type: 'log',
        level: 'warn',
        message: `event translate error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  const lifecycle = createDisposableState([
    () => unsubscribe(),
    () => session.dispose(),
  ]);

  const spawned: SpawnedAgent = {
    agentId: task.agentId,
    task,
    async abort(): Promise<void> {
      if (lifecycle.isDisposed()) return;
      try {
        await session.abort();
      } catch {
        /* best-effort — dispose() will still try */
      }
    },
    async checkpoint(): Promise<string | null> {
      // Fase 2.3 pause hook. Return a pointer to the persisted transcript so the
      // orchestrator can resume this agent later (via restoreSessionPath).
      // Completed turns are already flushed to the JSONL on each message_end; an
      // in-flight turn is NOT, and is simply re-attempted on resume. We do NOT
      // abort or dispose here — the caller disposes immediately after (mirrors
      // destroyAgent's dispose→reject, so no extra interception is needed). When
      // nothing durable exists yet, return null so the caller falls back to
      // kill+requeue (never a regression).
      if (lifecycle.isDisposed()) return null;
      try {
        const file = session.sessionFile;
        if (file && existsSync(file) && statSync(file).size > 0) return file;
      } catch {
        /* unreadable session file → null → caller falls back to destroyAgent */
      }
      return null;
    },
    async steer(message: string): Promise<void> {
      // Delivered after the current turn's tool calls, before the next model
      // call. Never throws outward: steering is an improvement to a turn that
      // is already running correctly, so a failure to steer must not fail it.
      if (lifecycle.isDisposed()) return;
      try {
        await session.steer(message);
      } catch (err) {
        onEvent({
          type: 'log',
          level: 'warn',
          message: `steer failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    async prompt(message: string): Promise<void> {
      lifecycle.assertLive();
      const fullMessage = buildAgentMessageHeader(
        task,
        message,
        cwd,
        runtimeContext?.ports,
        runtimeContext?.shimAvailable ?? false,
      );
      try {
        await session.prompt(fullMessage);
      } catch (err) {
        onEvent({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      // Defensive: pi 0.73.x propagates most provider errors via `prompt()`
      // rejection (the 0.71 fix for Anthropic SSE truncation), but the
      // public AgentState.errorMessage is still set on aborted/error
      // turns. Reading the public getter (no `as unknown` cast) ensures we
      // surface anything the SDK left without throwing.
      const stateErr = session.state.errorMessage;
      if (stateErr) {
        onEvent({ type: 'error', message: stateErr });
        throw new Error(stateErr);
      }
      onEvent({ type: 'done' });
    },
    async getTranscript(): Promise<string> {
      // The in-memory message array is the authoritative transcript (it is
      // also what gets persisted to `session.sessionFile`). Never throws:
      // verdict capture must degrade to event-based parsing, not fail the
      // check — and this is read AFTER prompt() resolves but BEFORE
      // dispose(), so the session is still fully populated.
      try {
        return sessionTranscriptText(session.messages);
      } catch {
        return '';
      }
    },
    dispose: lifecycle.dispose,
  };

  return spawned;
};
