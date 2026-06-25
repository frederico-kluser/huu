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
   * True when a NON-EMPTY value also exists in the persisted store (the
   * Options screen's "save key globally" path) AND it differs from the
   * winning value — i.e. a higher-precedence source is silently shadowing
   * what the user saved in Options. This is the #1 cause of the
   * "I updated the key in Options but it still returns 401" support case:
   * a stale `OPENROUTER_API_KEY` exported from a shell profile (or a
   * `~/.secrets` it sources) outranks the stored key (env is step 3, the
   * store is step 4). When `source` is already `'stored'` this is always
   * false — nothing outranks it.
   */
  shadowsStored: boolean;
}

/**
 * Generic resolver for the API keys declared in the registry, reporting
 * WHICH tier won so callers can give an actionable error instead of a
 * blanket "update it in Options" (which is a no-op when an env var
 * shadows the saved key).
 *
 * Resolution order (first non-empty wins):
 *   1. Container secret mount (`spec.secretMountPath`).
 *   2. `<NAME>_FILE` env var pointing at a file with the value.
 *   3. `<NAME>` env var (plain).
 *   4. Persisted global store at `$XDG_CONFIG_HOME/huu/config.json`
 *      (fallback `~/.config/huu/config.json`). Populated by the TUI's
 *      "save key globally" path. Lives on the HOST and is reachable
 *      from the container only because the wrapper re-mounts the
 *      resolved value as a secret file.
 *
 * Never throws on missing files — callers (TUI, agent factory, docker
 * re-exec) handle the empty case explicitly.
 */
export function resolveApiKeyWithSource(spec: ApiKeySpec): ApiKeyResolution {
  // Read the store up front so we can flag shadowing of a saved key no
  // matter which higher tier wins. Read-only + cheap (a small JSON file);
  // the returned `value` is identical to the lazy walk below.
  const stored = loadStoredApiKey(spec);
  const shadows = (winning: string): boolean => stored !== '' && stored !== winning;

  const fromMount = readKeyFile(spec.secretMountPath);
  if (fromMount) {
    return { value: fromMount, source: 'secret-mount', shadowsStored: shadows(fromMount) };
  }

  const fileVar = process.env[spec.envFileVar];
  if (fileVar) {
    const fromFile = readKeyFile(fileVar);
    if (fromFile) {
      return { value: fromFile, source: 'env-file', shadowsStored: shadows(fromFile) };
    }
  }

  const fromEnv = (process.env[spec.envVar] ?? '').trim();
  if (fromEnv) {
    return { value: fromEnv, source: 'env', shadowsStored: shadows(fromEnv) };
  }

  if (stored !== '') return { value: stored, source: 'stored', shadowsStored: false };
  return { value: '', source: 'none', shadowsStored: false };
}

/** Value-only resolver. Thin wrapper over {@link resolveApiKeyWithSource}. */
export function resolveApiKey(spec: ApiKeySpec): string {
  return resolveApiKeyWithSource(spec).value;
}

/**
 * Human-facing, value-free remediation hint for a key that was rejected
 * (401/403) or is needed. Names the ACTUAL winning source so the fix is
 * actionable — the whole point is to stop telling users to "update it in
 * Options" when an env var is shadowing what they already saved there.
 */
export function keyRemedyHint(spec: ApiKeySpec, res: ApiKeyResolution): string {
  const saved = 'the different key saved in the Options screen';
  switch (res.source) {
    case 'env':
      return res.shadowsStored
        ? `huu used the ${spec.envVar} environment variable, which OVERRIDES ${saved}. ` +
            `Unset ${spec.envVar} — it is often exported from a shell profile ` +
            `(~/.zshenv, ~/.bashrc, ~/.profile) or a ~/.secrets file one of them sources — ` +
            `so huu falls back to the saved key, or correct its value there.`
        : `huu used the ${spec.envVar} environment variable. Correct it where it is ` +
            `exported (shell profile, ~/.secrets, CI secret), or unset it and save a key in the Options screen.`;
    case 'env-file':
      return (
        `huu read the key from the file named by ${spec.envFileVar}` +
        (res.shadowsStored ? `, which OVERRIDES ${saved}` : '') +
        `. Fix that file or unset ${spec.envFileVar}.`
      );
    case 'secret-mount':
      return (
        `huu read the key from the mounted secret ${spec.secretMountPath}` +
        (res.shadowsStored ? ` (it OVERRIDES ${saved})` : '') +
        `. On a Docker run the host resolved this value (from ${spec.envVar} or the global ` +
        `store) before forwarding it — fix ${spec.envVar} on the host.`
      );
    case 'stored':
      return `Update ${spec.envVar} in the Options screen — the saved key was rejected.`;
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
 * Specs bound to a DIFFERENT backend are skipped so a Copilot run
 * doesn't ask for an OpenRouter key the user will never use.
 */
export function findMissingKeysForBackend(
  backend: 'pi' | 'copilot' | 'azure',
): ApiKeySpec[] {
  const out: ApiKeySpec[] = [];
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
