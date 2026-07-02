/**
 * Hermetic pi-session composition — huu's OWN clean pi runtime.
 *
 * Why this exists: `createAgentSession` fills every option huu omits with
 * HOST-GLOBAL defaults — it reads `~/.pi/agent/settings.json` (whose `packages`
 * list resolves through `npm root -g` and loads GLOBAL npm `pi-*` extensions
 * into every huu agent), reads/writes `~/.pi/agent/auth.json` and
 * `models.json`, auto-discovers skills/prompts/themes under `~/.pi` and every
 * ancestor `.agents/skills`, and injects AGENTS.md/CLAUDE.md from every
 * directory up to `/`. One such global extension (`pi-animations`) crashed a
 * whole multi-run fleet via a detached timer huu never asked for.
 *
 * This module builds the four injection objects (auth, model registry,
 * settings, resource loader) so a pi session loads ONLY what huu needs:
 * in-memory auth fed by the run's key, in-memory model registry, empty
 * in-memory settings (no `packages` ⇒ the loader never shells `npm root -g`),
 * and a resource loader with every discovery surface disabled. The single
 * deliberate re-addition is SCOPED repo context: AGENTS.md/CLAUDE.md from the
 * agent worktree ROOT only (never `$HOME`, never `~/.pi`, never ancestors).
 *
 * Default ON for every pi-backed session (openrouter AND azure — both
 * factories compose sessions here). Escape hatch for debugging:
 * `HUU_PI_HERMETIC=0` reproduces the legacy host-global behavior byte-for-byte.
 */
import { mkdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  DefaultResourceLoader,
  type ResourceLoader,
} from '@mariozechner/pi-coding-agent';
import { resolveHermeticEnabled, hermeticAgentDir } from '../../../lib/pi-runtime-config.js';

// Re-exported so backend code (and tests) keep one import surface for the seam.
export { resolveHermeticEnabled, hermeticAgentDir };

/** The provider-config shape `ModelRegistry.registerProvider` accepts. */
type ProviderConfig = Parameters<ModelRegistry['registerProvider']>[1];

/** Context filenames pi itself recognizes — matched case-variants included. */
const REPO_CONTEXT_FILES = ['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'];

/**
 * SCOPED replacement for pi's ancestor walk: read AGENTS.md/CLAUDE.md from the
 * repo checkout root ONLY (the agent worktree root). Deduped by realpath so a
 * `CLAUDE.md -> AGENTS.md` symlink (a common layout, including huu's own repo)
 * doesn't inject the same content twice. Best-effort: unreadable files are
 * skipped — context loading must never block an agent from spawning.
 */
export function loadRepoContextFiles(cwd: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();
  for (const name of REPO_CONTEXT_FILES) {
    const path = join(cwd, name);
    try {
      if (!existsSync(path)) continue;
      let key = path;
      try {
        key = realpathSync(path);
      } catch {
        /* dangling symlink etc. — fall back to the literal path */
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const content = readFileSync(path, 'utf8');
      if (content.trim().length > 0) out.push({ path, content });
    } catch {
      /* unreadable — skip, never block */
    }
  }
  return out;
}

export interface PiSessionEnvironment {
  /** False only under the HUU_PI_HERMETIC=0 escape hatch. */
  hermetic: boolean;
  /** huu-owned agent dir; set only when hermetic. */
  agentDir?: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  /** Deterministic in-memory settings; set only when hermetic. */
  settingsManager?: SettingsManager;
  /** Already reload()ed — the SDK does NOT reload caller-supplied loaders. */
  resourceLoader?: ResourceLoader;
}

export interface BuildPiSessionEnvironmentOptions {
  /** pi provider id the runtime key registers under (e.g. 'openrouter'). */
  provider: string;
  apiKey: string;
  /** Extra provider config (e.g. OpenRouter attribution headers). */
  providerConfig?: ProviderConfig;
  /** The agent worktree root — also the scoped repo-context source. */
  cwd: string;
  /** Default true: inject AGENTS.md/CLAUDE.md from the worktree ROOT only. */
  includeRepoContext?: boolean;
  /** Injectable for tests; mutated for the PI_CODING_AGENT_DIR defense. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Compose the session-injection objects for `createAgentSession`.
 *
 * Hermetic branch: nothing under `$HOME` is read or written by pi — auth,
 * registry and settings are in-memory; the resource loader has every
 * discovery flag off (and empty in-memory settings mean `packages` is `[]`,
 * so `DefaultPackageManager.resolve()` never shells out to `npm root -g`).
 * The loader is reload()ed HERE because `createAgentSession` only reloads
 * loaders it constructed itself (sdk.js: caller-supplied ⇒ caller reloads).
 *
 * Defense in depth: `PI_CODING_AGENT_DIR` is exported (only when unset) so any
 * SDK-internal `getAgentDir()` caller not covered by explicit options — and
 * any `pi` a tool subprocess might invoke inside the worktree — still lands in
 * huu-owned space instead of `~/.pi/agent`.
 */
export async function buildPiSessionEnvironment(
  opts: BuildPiSessionEnvironmentOptions,
): Promise<PiSessionEnvironment> {
  const env = opts.env ?? process.env;

  if (!resolveHermeticEnabled(env)) {
    // Legacy escape hatch: exactly the pre-hermetic composition (host-global
    // ~/.pi/agent auth + models.json, SDK-default settings/loader discovery).
    const authStorage = AuthStorage.create();
    authStorage.setRuntimeApiKey(opts.provider, opts.apiKey);
    const modelRegistry = ModelRegistry.create(authStorage);
    modelRegistry.registerProvider(opts.provider, opts.providerConfig ?? {});
    return { hermetic: false, authStorage, modelRegistry };
  }

  const agentDir = hermeticAgentDir();
  try {
    mkdirSync(agentDir, { recursive: true });
  } catch {
    /* best-effort — nothing is ever written there; scans of a missing dir are empty */
  }
  if (!env.PI_CODING_AGENT_DIR) env.PI_CODING_AGENT_DIR = agentDir;

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(opts.provider, opts.apiKey);

  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(opts.provider, opts.providerConfig ?? {});

  const settingsManager = SettingsManager.inMemory({});

  const includeRepoContext = opts.includeRepoContext !== false;
  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    ...(includeRepoContext
      ? { agentsFilesOverride: () => ({ agentsFiles: loadRepoContextFiles(opts.cwd) }) }
      : {}),
  });
  await resourceLoader.reload();

  return {
    hermetic: true,
    agentDir,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader,
  };
}
