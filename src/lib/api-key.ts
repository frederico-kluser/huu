import { readFileSync } from 'node:fs';

/**
 * Resolve the OpenRouter API key from a hierarchy of sources, mirroring
 * the postgres / mysql Docker images' `_FILE` convention so the tool
 * plays well with `docker secret` and Compose's `secrets:` block.
 *
 * Resolution order (first non-empty wins):
 *   1. `/run/secrets/openrouter_api_key` — the canonical Docker secret
 *      mount path. tmpfs-backed inside the container; never committed
 *      into images via `docker commit`.
 *   2. `OPENROUTER_API_KEY_FILE` — explicit path pointing at any file
 *      that contains the key. Useful when secrets are mounted at a
 *      non-default path or when running outside Docker.
 *   3. `OPENROUTER_API_KEY` — plain env var, the legacy path. Still
 *      supported for dev convenience.
 *
 * Returns the trimmed key, or `''` if none of the sources yielded one.
 * Never throws on a missing file — callers (the TUI, the agent factory)
 * already handle the empty case with their own UX.
 */
export function resolveOpenRouterApiKey(): string {
  const fromMount = readKeyFile('/run/secrets/openrouter_api_key');
  if (fromMount) return fromMount;

  const fromFileEnv = process.env.OPENROUTER_API_KEY_FILE;
  if (fromFileEnv) {
    const fromFile = readKeyFile(fromFileEnv);
    if (fromFile) return fromFile;
  }

  return (process.env.OPENROUTER_API_KEY ?? '').trim();
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
