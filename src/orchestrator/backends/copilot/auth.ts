import { readFileSync } from 'node:fs';

/**
 * Resolves credentials for the Copilot CLI / SDK in the same precedence
 * order as `lib/api-key.ts` uses for OpenRouter. Returns the env vars
 * that should be merged into the spawned process — never modifies
 * `process.env` here so the caller can decide scoping.
 *
 * Resolution order (first non-empty wins):
 *   1. `/run/secrets/copilot_token` (Docker secret tmpfs)
 *   2. file pointed to by `COPILOT_GITHUB_TOKEN_FILE`
 *   3. `COPILOT_GITHUB_TOKEN` env var
 *   4. `GH_TOKEN` env var (gh CLI compatibility)
 *   5. `GITHUB_TOKEN` env var (Actions compatibility)
 *   6. BYOK fallback: `COPILOT_PROVIDER_API_KEY` (presence indicates
 *      the user set up Bring-Your-Own-Key — token is OPTIONAL in this case
 *      because the provider auth replaces it).
 *
 * Returns an object describing what was found so the factory can emit
 * a clear error or warning when nothing is set.
 */
export interface CopilotCredsResolution {
  /** Env vars to merge into the spawned process. Empty if nothing resolved. */
  env: Record<string, string>;
  /** Where the token came from, for log/diagnostic purposes. */
  source:
    | 'docker_secret'
    | 'env_file'
    | 'COPILOT_GITHUB_TOKEN'
    | 'GH_TOKEN'
    | 'GITHUB_TOKEN'
    | 'byok_only'
    | 'none';
  /** True when `env` carries enough to authenticate the SDK/CLI. */
  hasAuth: boolean;
}

const DOCKER_SECRET_PATH = '/run/secrets/copilot_token';

export function resolveCopilotCreds(
  env: NodeJS.ProcessEnv = process.env,
): CopilotCredsResolution {
  // 1. Docker secret mount
  const fromMount = readKeyFile(DOCKER_SECRET_PATH);
  if (fromMount) {
    return {
      env: { COPILOT_GITHUB_TOKEN: fromMount },
      source: 'docker_secret',
      hasAuth: true,
    };
  }

  // 2. _FILE env var
  const filePath = env.COPILOT_GITHUB_TOKEN_FILE?.trim();
  if (filePath) {
    const fromFile = readKeyFile(filePath);
    if (fromFile) {
      return {
        env: { COPILOT_GITHUB_TOKEN: fromFile },
        source: 'env_file',
        hasAuth: true,
      };
    }
  }

  // 3-5. Plain env vars
  const tokenSources: Array<['COPILOT_GITHUB_TOKEN' | 'GH_TOKEN' | 'GITHUB_TOKEN', string]> = [
    ['COPILOT_GITHUB_TOKEN', (env.COPILOT_GITHUB_TOKEN ?? '').trim()],
    ['GH_TOKEN', (env.GH_TOKEN ?? '').trim()],
    ['GITHUB_TOKEN', (env.GITHUB_TOKEN ?? '').trim()],
  ];
  for (const [name, value] of tokenSources) {
    if (value) {
      return {
        env: { [name]: value },
        source: name,
        hasAuth: true,
      };
    }
  }

  // 6. BYOK (token optional when a provider is configured)
  const byokKey = env.COPILOT_PROVIDER_API_KEY?.trim();
  const byokBase = env.COPILOT_PROVIDER_BASE_URL?.trim();
  if (byokKey && byokBase) {
    return {
      env: {},
      source: 'byok_only',
      hasAuth: true,
    };
  }

  return { env: {}, source: 'none', hasAuth: false };
}

function readKeyFile(path: string): string {
  // No existsSync precheck: readFileSync throws ENOENT/EACCES which we
  // catch — the precheck would TOCTOU with the next read anyway.
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}
