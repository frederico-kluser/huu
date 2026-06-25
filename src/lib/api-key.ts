import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  API_KEY_REGISTRY,
  findSpec,
  type ApiKeySpec,
} from './api-key-registry.js';
import { providerToBackend } from './providers.js';
import type { AgentBackendKind, LlmProvider } from './types.js';

export { API_KEY_REGISTRY, findSpec };
export type { ApiKeySpec };

/** Which precedence tier of the resolver supplied a key value. */
export type ApiKeySource =
  | 'secret-mount'
  | 'env-file'
  | 'env'
  | 'stored'
  | 'none';

export interface ApiKeyResolution {
  /** The resolved value (already trimmed). Empty string if none. */
  value: string;
  /** Which precedence tier supplied `value`. */
  source: ApiKeySource;
  /**
   * True when the user's EXPLICITLY SAVED key won (`source === 'stored'`) AND a
   * DIFFERENT non-empty ambient credential is also present (an `<NAME>_FILE`
   * file, or the `<NAME>` env var) — i.e. huu is deliberately IGNORING an
   * ambient value in favor of what the user saved in Options. This is the
   * inverted successor to the old `shadowsStored`: the resolver now ranks the
   * saved store ABOVE the env var (the explicit choice beats the ambient one),
   * so the old "a stale `OPENROUTER_API_KEY` exported from a shell profile
   * silently shadows the saved key → 401" foot-gun is gone and the diagnostic
   * points the other way. Only ever true when `source === 'stored'`.
   */
  storedOverridesEnv: boolean;
}

/**
 * The ambient (non-explicit) credential for a spec: the `<NAME>_FILE` file
 * contents if set, else the plain `<NAME>` env var (trimmed). Used only to
 * tell whether a winning stored key is overriding something the environment
 * also offers — never as a resolved value on its own.
 */
function ambientEnvValue(spec: ApiKeySpec): string {
  const fileVar = process.env[spec.envFileVar];
  if (fileVar) {
    const fromFile = readKeyFile(fileVar);
    if (fromFile) return fromFile;
  }
  return (process.env[spec.envVar] ?? '').trim();
}

/**
 * Generic resolver for the API keys declared in the registry, reporting
 * WHICH tier won so callers can give an actionable error.
 *
 * Resolution order (first non-empty wins) — the EXPLICIT choice beats the
 * AMBIENT one:
 *   1. Container secret mount (`spec.secretMountPath`). In Docker the host
 *      resolves the key with this same order and re-mounts it here, so the
 *      mount already reflects the host's decision.
 *   2. Persisted global store at `$XDG_CONFIG_HOME/huu/config.json`
 *      (fallback `~/.config/huu/config.json`) — the key the user explicitly
 *      saved via the TUI's "save key globally" path. This now OUTRANKS the
 *      env var, so a stale `OPENROUTER_API_KEY` left in a shell profile no
 *      longer shadows what the user deliberately saved.
 *   3. `<NAME>_FILE` env var pointing at a file with the value.
 *   4. `<NAME>` env var (plain) — the fallback when nothing is saved (the
 *      standard CI / headless path: no Options save, so the env var wins).
 *
 * Never throws on missing files — callers (TUI, agent factory, docker
 * re-exec) handle the empty case explicitly.
 */
export function resolveApiKeyWithSource(spec: ApiKeySpec): ApiKeyResolution {
  const fromMount = readKeyFile(spec.secretMountPath);
  if (fromMount) {
    return { value: fromMount, source: 'secret-mount', storedOverridesEnv: false };
  }

  // The explicitly saved key wins over the ambient env var/file. When it does,
  // flag whether a DIFFERENT ambient value is being ignored so the UI/CLI can
  // say so, instead of leaving the user wondering which key huu used.
  const stored = loadStoredApiKey(spec);
  if (stored !== '') {
    const ambient = ambientEnvValue(spec);
    return {
      value: stored,
      source: 'stored',
      storedOverridesEnv: ambient !== '' && ambient !== stored,
    };
  }

  const fileVar = process.env[spec.envFileVar];
  if (fileVar) {
    const fromFile = readKeyFile(fileVar);
    if (fromFile) {
      return { value: fromFile, source: 'env-file', storedOverridesEnv: false };
    }
  }

  const fromEnv = (process.env[spec.envVar] ?? '').trim();
  if (fromEnv) {
    return { value: fromEnv, source: 'env', storedOverridesEnv: false };
  }

  return { value: '', source: 'none', storedOverridesEnv: false };
}

/** Value-only resolver. Thin wrapper over {@link resolveApiKeyWithSource}. */
export function resolveApiKey(spec: ApiKeySpec): string {
  return resolveApiKeyWithSource(spec).value;
}

/**
 * Human-facing, value-free remediation hint for a key that was rejected
 * (401/403) or is needed. Names the ACTUAL winning source so the fix is
 * actionable. Because the saved store now OUTRANKS the env var, the foot-gun
 * message lives on the `stored` case: an env var can be present but ignored
 * in favor of the key the user explicitly saved in Options.
 */
export function keyRemedyHint(spec: ApiKeySpec, res: ApiKeyResolution): string {
  switch (res.source) {
    case 'stored':
      return res.storedOverridesEnv
        ? `huu used the key you saved in the Options screen (a saved key takes precedence), and ` +
            `it was rejected. ${spec.envVar} is also set in your environment but is IGNORED while ` +
            `a saved key exists — update the saved key in the Options screen, or clear it to fall ` +
            `back to ${spec.envVar}.`
        : `huu used the key saved in the Options screen and it was rejected. Update it there.`;
    case 'env':
      return (
        `huu used the ${spec.envVar} environment variable as the fallback (no key is saved in the ` +
        `Options screen). Correct it where it is exported (shell profile, ~/.secrets, CI secret), ` +
        `or save a key in the Options screen — a saved key takes precedence.`
      );
    case 'env-file':
      return (
        `huu read the key from the file named by ${spec.envFileVar} (no key is saved in the Options ` +
        `screen). Fix that file or unset ${spec.envFileVar}, or save a key in the Options screen — ` +
        `a saved key takes precedence.`
      );
    case 'secret-mount':
      return (
        `huu read the key from the mounted secret ${spec.secretMountPath}. On a Docker run the host ` +
        `resolved this value (the key you saved in Options, or ${spec.envVar}) before forwarding ` +
        `it — fix it on the host.`
      );
    case 'none':
    default:
      return `No ${spec.envVar} key is set. Add one in the Options screen.`;
  }
}

/** Resolve every key in the registry. Map keyed by `spec.name`. */
export function resolveAllApiKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of API_KEY_REGISTRY) {
    out[spec.name] = resolveApiKey(spec);
  }
  return out;
}

/** Specs flagged `required: true` whose value couldn't be resolved. */
export function findMissingRequiredKeys(): ApiKeySpec[] {
  return API_KEY_REGISTRY.filter((s) => s.required && !resolveApiKey(s));
}

/**
 * Backend-aware variant of `findMissingRequiredKeys`. Returns specs the
 * given backend would block on:
 *   1. The backend-bound spec for `backend` (regardless of `required`),
 *      because choosing a backend implies its primary credential is
 *      mandatory — even when the registry has `required: false` to
 *      keep legacy callers from blocking other backends.
 *   2. Plus any spec without `backendBound` that is `required: true` —
 *      those are universal, enforced regardless of which backend runs.
 *      (Currently none — AA was demoted to `required: false` so it no
 *      longer gates the run flow after pipeline configuration.)
 *
 * Specs bound to a DIFFERENT backend are skipped so an Azure run
 * doesn't ask for an OpenRouter key the user will never use.
 */
export function findMissingKeysForBackend(
  backend: AgentBackendKind,
): ApiKeySpec[] {
  const out: ApiKeySpec[] = [];
  // stub has no credentials; only universal `required` specs (none today)
  // could surface, and none are bound to it.
  for (const spec of API_KEY_REGISTRY) {
    const bound = spec.backendBound;
    if (bound) {
      if (bound !== backend) continue;
      // Backend-bound spec for the active backend: always enforce.
      if (!resolveApiKey(spec)) out.push(spec);
    } else if (spec.required) {
      if (!resolveApiKey(spec)) out.push(spec);
    }
  }
  return out;
}

/**
 * Provider-keyed wrapper around {@link findMissingKeysForBackend}. The UI
 * picks a provider (OpenRouter / Azure AI Foundry); this resolves it to the
 * backing dispatch kind and returns the credential specs still missing for
 * it (OpenRouter → the openrouter key; Azure → the API key + endpoint URL).
 */
export function findMissingKeysForProvider(provider: LlmProvider): ApiKeySpec[] {
  return findMissingKeysForBackend(providerToBackend(provider));
}

/**
 * Persist `value` for `spec` into the global config file (mode 0600 in a
 * 0700 directory). Subsequent runs on this user/machine will resolve the
 * key without re-prompting.
 */
export function saveApiKey(spec: ApiKeySpec, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  const path = configFilePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const store = readStore();
  store[spec.name] = trimmed;
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 });
  // writeFileSync's `mode` is only honored on creation; chmod again so
  // existing files (created with a wider umask earlier) tighten down.
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows / fs without chmod — best effort */
  }
}

/** Read just one key from the global store. Empty string if absent. */
export function loadStoredApiKey(spec: ApiKeySpec): string {
  const store = readStore();
  const v = store[spec.name];
  return typeof v === 'string' ? v.trim() : '';
}

/** Path to the global config file. Exposed for help text + tests. */
export function configFilePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const dir = xdg ? join(xdg, 'huu') : join(homedir(), '.config', 'huu');
  return join(dir, 'config.json');
}

/**
 * Backwards-compat shim. New code should use
 *   resolveApiKey(findSpec('openrouter')!)
 * but legacy call sites in app.tsx / orchestrator continue to work.
 */
export function resolveOpenRouterApiKey(): string {
  const spec = findSpec('openrouter');
  if (!spec) return '';
  return resolveApiKey(spec);
}

function readStore(): Record<string, unknown> {
  try {
    const raw = readFileSync(configFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readKeyFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    // ENOENT/EACCES/etc. — treat as "not provided" and let the caller
    // fall back. Logging the path here would risk leaking it into
    // .huu/debug-*.log; we deliberately stay silent.
    return '';
  }
}
