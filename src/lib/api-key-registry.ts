/**
 * Declarative registry of API keys huu knows how to resolve, prompt for,
 * persist globally, and forward into the container.
 *
 * Adding a new key in the future is a one-entry append:
 *
 *   {
 *     name: 'fooApi',
 *     envVar: 'FOO_API_KEY',
 *     envFileVar: 'FOO_API_KEY_FILE',
 *     secretMountPath: '/run/secrets/foo_api_key',
 *     hostSecretScope: 'huu-foo-key',
 *     label: 'Foo',
 *     hint: 'starts with foo-',
 *     required: false,
 *   }
 *
 * Everything downstream (resolver, TUI prompt, docker re-exec mounts,
 * env passthrough, orphan cleanup) iterates this list — no other files
 * need to learn about the new key.
 */
export interface ApiKeySpec {
  /**
   * Internal identifier. Used as the JSON property name in the persisted
   * global store (`~/.config/huu/config.json`). camelCase by convention.
   */
  name: string;
  /** Primary env var. Resolution order step 3. */
  envVar: string;
  /** `_FILE` companion: path to a file containing the value. Step 2. */
  envFileVar: string;
  /**
   * Path the value is bind-mounted to inside the container. Mirrors the
   * postgres / mysql Docker images' `_FILE` convention. Step 1 of the
   * resolver. Convention: `/run/secrets/<snake_case_name>`.
   */
  secretMountPath: string;
  /**
   * Filename prefix used when the host-side wrapper writes the value
   * to /dev/shm (or os.tmpdir()) before bind-mounting into the container.
   * Lower-case kebab. Used by the orphan sweeper to clean up stale files.
   */
  hostSecretScope: string;
  /** Human-friendly title shown in the TUI prompt. */
  label: string;
  /** Short hint shown above the input ("starts with sk-or-"). */
  hint?: string;
  /**
   * Optional prefix used for cheap client-side validation (warns the
   * user if they paste something that doesn't start with this). The
   * resolver/saver does not enforce — purely a UX guardrail.
   */
  validatePrefix?: string;
  /**
   * Whether the run path should block when this key is missing. `false`
   * means "nice to have, plumb it but don't pop the prompt".
   */
  required: boolean;
}

export const API_KEY_REGISTRY: readonly ApiKeySpec[] = [
  {
    name: 'openrouter',
    envVar: 'OPENROUTER_API_KEY',
    envFileVar: 'OPENROUTER_API_KEY_FILE',
    secretMountPath: '/run/secrets/openrouter_api_key',
    hostSecretScope: 'huu-openrouter-key',
    label: 'OpenRouter',
    hint: 'starts with sk-or-',
    validatePrefix: 'sk-or-',
    required: true,
  },
  {
    name: 'artificialAnalysis',
    envVar: 'ARTIFICIAL_ANALYSIS_API_KEY',
    envFileVar: 'ARTIFICIAL_ANALYSIS_API_KEY_FILE',
    secretMountPath: '/run/secrets/artificial_analysis_api_key',
    hostSecretScope: 'huu-artificial-analysis-key',
    label: 'Artificial Analysis',
    hint: 'API key from artificialanalysis.ai',
    required: true,
  },
  {
    // Used when --backend=copilot. Marked `required: false` because the
    // OpenRouter spec also has `required: true` and only ONE of the
    // two is needed for any given run. The App's missing-key check is
    // backend-aware (see app.tsx) — it only blocks on the spec that
    // matches the active backend.
    name: 'copilot',
    envVar: 'COPILOT_GITHUB_TOKEN',
    envFileVar: 'COPILOT_GITHUB_TOKEN_FILE',
    secretMountPath: '/run/secrets/copilot_token',
    hostSecretScope: 'huu-copilot-token',
    label: 'GitHub Copilot',
    hint: 'GitHub fine-grained PAT with "Copilot Requests" scope, or COPILOT_GITHUB_TOKEN/GH_TOKEN',
    required: false,
  },
];

export function findSpec(name: string): ApiKeySpec | undefined {
  return API_KEY_REGISTRY.find((s) => s.name === name);
}
