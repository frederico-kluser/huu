import { readFileSync } from 'node:fs';

/**
 * Resolves Copilot auth surface presence — does NOT mutate
 * `process.env`. Parallel agents would race on shared process.env
 * mutations; for env-var paths the spawned Copilot CLI inherits the
 * parent process env automatically. For file-based paths we return
 * the token via {@link CopilotCredsResolution.token} so the factory
 * can pass it to `CopilotClient({ gitHubToken })` explicitly.
 *
 * Resolution order (first hit wins, all checks read-only):
 *   1. `/run/secrets/copilot_token` — Docker secret tmpfs (Swarm/Compose
 *      `secrets:` block). The Copilot CLI does NOT read this path
 *      natively (verified against github/copilot-cli docs Apr 2026 — only
 *      `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN` are recognised),
 *      so we read it ourselves and pass the token to the SDK via
 *      `gitHubToken`. This is huu's convention, not the CLI's.
 *   2. file pointed to by `COPILOT_GITHUB_TOKEN_FILE` — `_FILE` pattern
 *      mirroring postgres/mysql Docker images. Same caveat as (1):
 *      huu's convention, read by us, then forwarded to the SDK.
 *   3. `COPILOT_GITHUB_TOKEN` env var (CLI native).
 *   4. `GH_TOKEN` env var (CLI native, gh CLI compatibility).
 *   5. `GITHUB_TOKEN` env var (CLI native, Actions compatibility).
 *   6. BYOK: `COPILOT_PROVIDER_API_KEY` + `COPILOT_PROVIDER_BASE_URL`
 *      both set. Token is optional in this case because the provider
 *      auth replaces it; configured via SessionConfig.provider rather
 *      than gitHubToken.
 *
 * The factory uses `hasAuth` to fail loud-and-early when nothing is
 * resolvable; `source` is logged for diagnostics ("which env path did
 * we authenticate against?"); `token` is forwarded to the SDK only
 * for file-based sources (env-var sources are inherited natively).
 */
export interface CopilotCredsResolution {
  /** Where the auth signal came from, for log/diagnostic purposes. */
  source:
    | 'docker_secret'
    | 'env_file'
    | 'COPILOT_GITHUB_TOKEN'
    | 'GH_TOKEN'
    | 'GITHUB_TOKEN'
    | 'byok_only'
    | 'none';
  /** True when at least one auth path is populated. */
  hasAuth: boolean;
  /**
   * Resolved token value. Populated only for file-based sources
   * (`docker_secret`, `env_file`) where the spawned Copilot CLI cannot
   * see the token without explicit forwarding. For env-var sources
   * (`COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN`) and BYOK, the
   * spawned process inherits the value natively via process.env, so
   * we leave this undefined to avoid duplicating it on the wire.
   */
  token?: string;
}

const DOCKER_SECRET_PATH = '/run/secrets/copilot_token';

export function resolveCopilotCreds(
  env: NodeJS.ProcessEnv = process.env,
): CopilotCredsResolution {
  const dockerSecretToken = readKeyFile(DOCKER_SECRET_PATH);
  if (dockerSecretToken) {
    return { source: 'docker_secret', hasAuth: true, token: dockerSecretToken };
  }

  const filePath = env.COPILOT_GITHUB_TOKEN_FILE?.trim();
  if (filePath) {
    const fileToken = readKeyFile(filePath);
    if (fileToken) {
      return { source: 'env_file', hasAuth: true, token: fileToken };
    }
  }

  const tokenSources: Array<['COPILOT_GITHUB_TOKEN' | 'GH_TOKEN' | 'GITHUB_TOKEN', string]> = [
    ['COPILOT_GITHUB_TOKEN', (env.COPILOT_GITHUB_TOKEN ?? '').trim()],
    ['GH_TOKEN', (env.GH_TOKEN ?? '').trim()],
    ['GITHUB_TOKEN', (env.GITHUB_TOKEN ?? '').trim()],
  ];
  for (const [name, value] of tokenSources) {
    if (value) return { source: name, hasAuth: true };
  }

  // BYOK is valid auth when both the API key and base URL are set —
  // having only one is a misconfiguration we should not silently
  // accept.
  const byokKey = env.COPILOT_PROVIDER_API_KEY?.trim();
  const byokBase = env.COPILOT_PROVIDER_BASE_URL?.trim();
  if (byokKey && byokBase) {
    return { source: 'byok_only', hasAuth: true };
  }

  return { source: 'none', hasAuth: false };
}

function readKeyFile(path: string): string {
  // No existsSync precheck: readFileSync throws ENOENT/EACCES which
  // we catch — and the precheck would TOCTOU with the next read.
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}
