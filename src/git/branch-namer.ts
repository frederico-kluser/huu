import { isAbsolute, join } from 'node:path';

const WORKTREE_BASE_DIR = '.huu-worktrees';
const BRANCH_PREFIX = 'huu';

// HUU_WORKTREE_BASE lets the operator put worktrees outside the repo —
// useful in container modes where the repo lives on a slow bind mount and
// worktrees need to be on a fast volume. An absolute path is taken
// verbatim; a relative path is resolved against repoRoot, preserving the
// pre-env-var behavior when someone sets it to e.g. ".huu-cache".
function resolveBase(repoRoot: string): string {
  const override = process.env.HUU_WORKTREE_BASE;
  if (!override) return join(repoRoot, WORKTREE_BASE_DIR);
  return isAbsolute(override) ? override : join(repoRoot, override);
}

export function agentBranchName(runId: string, agentId: number, attempt = 1): string {
  const suffix = attempt > 1 ? '-retry' : '';
  return `${BRANCH_PREFIX}/${runId}/agent-${agentId}${suffix}`;
}

export function agentWorktreePath(
  repoRoot: string,
  runId: string,
  agentId: number,
  attempt = 1,
): string {
  const suffix = attempt > 1 ? '-retry' : '';
  return join(resolveBase(repoRoot), runId, `agent-${agentId}${suffix}`);
}

export function integrationBranchName(runId: string): string {
  return `${BRANCH_PREFIX}/${runId}/integration`;
}

export function integrationWorktreePath(repoRoot: string, runId: string): string {
  return join(resolveBase(repoRoot), runId, 'integration');
}

export function worktreeBaseDir(repoRoot: string, runId: string): string {
  return join(resolveBase(repoRoot), runId);
}
