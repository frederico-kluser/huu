/**
 * Git / preflight types.
 *
 * Re-exported from the `lib/types` barrel so existing callers that import
 * `../lib/types.js` keep type-checking. New code may import directly from
 * `../lib/types/git.js`.
 */

// --- Preflight ---

export interface PreflightResult {
  valid: boolean;
  repoRoot: string;
  baseBranch: string;
  baseCommit: string;
  isDirty: boolean;
  hasRemote: boolean;
  canPush: boolean;
  errors: string[];
  warnings: string[];
}
