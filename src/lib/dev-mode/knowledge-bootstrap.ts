// Knowledge-skill bootstrap via a pi agent.
//
// Replaces the former multi-step `huu Knowledge System` pipeline. Instead of
// decomposing the bootstrap into separate agents, a SINGLE pi agent with
// deepseek-v4-pro (thinking xhigh) runs the full knowledge-skills-architect
// prompt. The agent creates `.agents/skills/` in the target repo directly —
// no worktree, no pipeline, no merge. A worktree would add no safety here
// (every file the agent creates is new) and would cost one worktree lifecycle
// per bootstrap.
//
// The prompt lives in `docs/knowledge-skills-architect-prompt.md` (~30 KB) and
// is read synchronously on first use, then cached. It was designed for Claude
// Code but is stack-agnostic — the agent uses the pi SDK's built-in tools
// (read, write, edit, bash) to execute all five phases.
//
// Only `dist/` ships (Docker image + npm tarball carry no `docs/`), so the
// build copies the prompt into `dist/assets/`. See PROMPT_CANDIDATES.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import { getModel, clampThinkingLevel } from '@mariozechner/pi-ai';
import { buildPiSessionEnvironment } from '../../orchestrator/backends/pi/hermetic.js';
import type { AppConfig } from '../types.js';
import { detectKnowledge, type KnowledgeStatus } from '../knowledge-detect.js';

// --- Prompt ----------------------------------------------------------------

// ESM: no `__dirname`. `import.meta.url` resolves under tsx (src/…) and after
// compilation (dist/…) alike.
const HERE = dirname(fileURLToPath(import.meta.url));

const PROMPT_FILE = 'knowledge-skills-architect-prompt.md';

// Order matters only for speed — the two layouts never coexist at runtime.
export const PROMPT_CANDIDATES = [
  // Compiled: dist/lib/dev-mode → dist/assets/. This is the ONLY layout that
  // exists inside the Docker image and the npm tarball, both of which ship
  // `dist/` and nothing else. `npm run build` populates it.
  join(HERE, '..', '..', 'assets', PROMPT_FILE),
  // Source checkout under tsx: src/lib/dev-mode → <repo>/docs/.
  join(HERE, '..', '..', '..', 'docs', PROMPT_FILE),
];

let _promptCache: string | undefined;

/**
 * Load the prompt once; never fails after the first successful read.
 * Returns '' when no candidate path resolves — the caller then reports a
 * hard error rather than sending an empty prompt to the model.
 */
export function loadArchitectPrompt(): string {
  if (_promptCache !== undefined) return _promptCache;
  for (const candidate of PROMPT_CANDIDATES) {
    try {
      _promptCache = readFileSync(candidate, 'utf8');
      return _promptCache;
    } catch {
      /* try the next layout */
    }
  }
  _promptCache = '';
  return _promptCache;
}

// --- Types ----------------------------------------------------------------

export type BootstrapEvent =
  | { type: 'bootstrap-start'; model: string }
  | { type: 'bootstrap-progress'; message: string }
  | { type: 'bootstrap-done'; ok: boolean; knowledge: KnowledgeStatus }
  | { type: 'bootstrap-log'; level: 'info' | 'warn' | 'error'; message: string };

export interface BootstrapOptions {
  /** The target repo root — the agent's cwd. */
  cwd: string;
  /** Resolved API key, model, backend kind, etc. */
  config: AppConfig;
  /** Override the bundled prompt. Absent ⇒ load from docs/. */
  prompt?: string;
  /** Where the persistent pi session is stored. Created if absent. */
  sessionDir: string;
  signal?: AbortSignal;
  onEvent?: (event: BootstrapEvent) => void;
}

export interface BootstrapResult {
  ok: boolean;
  error?: string;
  knowledge: KnowledgeStatus;
}

// --- Implementation -------------------------------------------------------

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/huu',
  'X-OpenRouter-Title': 'huu',
};

/**
 * Run the knowledge-skills bootstrap agent on `cwd`. Creates `.agents/skills/`
 * with a project-router, domain skills, catalog, and meta-skills.
 *
 * The agent is a single pi session. It receives the full architect prompt as
 * its first user message and works through all five phases autonomously.
 * Progress is forwarded via `onEvent`; the caller can abort via `signal`.
 *
 * This function is deliberately NOT an AgentFactory — it does not go through
 * the orchestrator, it owns its own session lifecycle, and it writes directly
 * to the target repo (no worktree isolation).
 */
export async function runKnowledgeBootstrap(
  opts: BootstrapOptions,
): Promise<BootstrapResult> {
  const prompt = opts.prompt ?? loadArchitectPrompt();
  if (!prompt) {
    return {
      ok: false,
      error: `${PROMPT_FILE} not found (looked in ${PROMPT_CANDIDATES.join(', ')}) and no override provided`,
      knowledge: detectKnowledge(opts.cwd),
    };
  }

  const apiKey = opts.config.apiKey.trim();
  if (!apiKey) {
    return { ok: false, error: 'API key missing', knowledge: detectKnowledge(opts.cwd) };
  }

  const modelId = opts.config.modelId?.trim();
  if (!modelId) {
    return { ok: false, error: 'Model ID missing', knowledge: detectKnowledge(opts.cwd) };
  }

  const emit = (event: BootstrapEvent) => {
    try { opts.onEvent?.(event); } catch { /* callbacks must not break the driver */ }
  };

  emit({ type: 'bootstrap-start', model: modelId });

  // --- Resolve model & thinking ------------------------------------------

  const model = getModel('openrouter', modelId as never);
  if (!model) {
    const msg = `Model "${modelId}" not found in the pi SDK registry for provider "openrouter"`;
    emit({ type: 'bootstrap-log', level: 'error', message: msg });
    return { ok: false, error: msg, knowledge: detectKnowledge(opts.cwd) };
  }

  // The bootstrap gets the model's maximum thinking level — it is a one-shot
  // cognition-heavy task with no per-turn cost concern.
  const thinkingLevel = clampThinkingLevel(model, 'xhigh');

  // --- Build hermetic pi environment -------------------------------------

  let piEnv;
  try {
    piEnv = await buildPiSessionEnvironment({
      provider: 'openrouter',
      apiKey,
      providerConfig: { headers: OPENROUTER_HEADERS },
      cwd: opts.cwd,
    });
  } catch (err) {
    const msg = `pi environment setup failed: ${err instanceof Error ? err.message : String(err)}`;
    emit({ type: 'bootstrap-log', level: 'error', message: msg });
    return { ok: false, error: msg, knowledge: detectKnowledge(opts.cwd) };
  }

  // --- Create session ----------------------------------------------------

  let sessionManager;
  try {
    sessionManager = SessionManager.create(opts.cwd, opts.sessionDir);
  } catch (err) {
    const msg = `session creation failed: ${err instanceof Error ? err.message : String(err)}`;
    emit({ type: 'bootstrap-log', level: 'error', message: msg });
    return { ok: false, error: msg, knowledge: detectKnowledge(opts.cwd) };
  }

  let session;
  try {
    const result = await createAgentSession({
      model,
      thinkingLevel,
      sessionManager,
      authStorage: piEnv.authStorage,
      modelRegistry: piEnv.modelRegistry,
      agentDir: piEnv.agentDir,
      settingsManager: piEnv.settingsManager,
      resourceLoader: piEnv.resourceLoader,
      cwd: opts.cwd,
      // tools omitted → default built-ins (read, bash, edit, write)
    });
    session = result.session;
  } catch (err) {
    const msg = `agent session creation failed: ${err instanceof Error ? err.message : String(err)}`;
    emit({ type: 'bootstrap-log', level: 'error', message: msg });
    return { ok: false, error: msg, knowledge: detectKnowledge(opts.cwd) };
  }

  // --- Wire events -------------------------------------------------------

  const unsubscribe = session.subscribe((event: unknown) => {
    try {
      const e = event as Record<string, unknown>;
      if (e.type === 'tool_call' || e.type === 'tool_result') {
        const tool = String(e.name ?? e.tool ?? 'unknown');
        emit({ type: 'bootstrap-progress', message: `tool: ${tool}` });
      } else if (e.type === 'log') {
        emit({
          type: 'bootstrap-log',
          level: (e.level as 'info' | 'warn' | 'error') ?? 'info',
          message: String(e.message ?? ''),
        });
      }
    } catch {
      /* event translation failures are non-fatal */
    }
  });

  // --- Wire abort --------------------------------------------------------

  const onAbort = () => {
    try { session.abort(); } catch { /* best-effort */ }
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  // --- Send the prompt ---------------------------------------------------

  let ok = false;
  let error: string | undefined;

  try {
    if (opts.signal?.aborted) {
      error = 'aborted before prompt';
    } else {
      emit({ type: 'bootstrap-progress', message: 'sending knowledge-skills-architect prompt…' });
      await session.prompt(prompt);

      // Check for SDK-level errors after completion
      const stateErr = (session.state as unknown as Record<string, unknown>).errorMessage as string | undefined;
      if (stateErr) {
        error = stateErr;
      } else {
        ok = true;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    if (error.includes('abort') || error.includes('cancel')) {
      error = 'aborted';
    }
  }

  // --- Cleanup -----------------------------------------------------------

  opts.signal?.removeEventListener('abort', onAbort);
  try { unsubscribe(); } catch { /* best-effort */ }
  try { session.dispose(); } catch { /* best-effort */ }

  // --- Re-detect knowledge -----------------------------------------------

  const knowledge = detectKnowledge(opts.cwd);

  if (ok && !knowledge.present) {
    // The agent ran without error but produced no detectable skills — the
    // prompt may have failed to instruct it to create the expected files.
    ok = false;
    error = `bootstrap agent completed but no knowledge skills were found: ${knowledge.reason}`;
    emit({ type: 'bootstrap-log', level: 'error', message: error });
  }

  emit({ type: 'bootstrap-done', ok, knowledge });

  return { ok, error, knowledge };
}
