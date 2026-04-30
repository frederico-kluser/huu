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

/**
 * Generic resolver / saver for the API keys declared in the registry.
 *
 * Resolution order for `resolveApiKey(spec)` (first non-empty wins):
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
export function resolveApiKey(spec: ApiKeySpec): string {
  const fromMount = readKeyFile(spec.secretMountPath);
  if (fromMount) return fromMount;

  const fileVar = process.env[spec.envFileVar];
  if (fileVar) {
    const fromFile = readKeyFile(fileVar);
    if (fromFile) return fromFile;
  }

  const fromEnv = (process.env[spec.envVar] ?? '').trim();
  if (fromEnv) return fromEnv;

  return loadStoredApiKey(spec);
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
 *      those are universal (e.g. `artificialAnalysis` for catalog
 *      enrichment), enforced regardless of which backend runs.
 *
 * Specs bound to a DIFFERENT backend are skipped so a Copilot run
 * doesn't ask for an OpenRouter key the user will never use.
 */
export function findMissingKeysForBackend(
  backend: 'pi' | 'copilot',
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
