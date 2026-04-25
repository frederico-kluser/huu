import { join } from 'node:path';

const WORKTREE_BASE_DIR = '.programatic-agent-worktrees';
const BRANCH_PREFIX = 'programatic-agent';

export function agentBranchName(runId: string, agentId: number): string {
  return `${BRANCH_PREFIX}/${runId}/agent-${agentId}`;
}

export function agentWorktreePath(repoRoot: string, runId: string, agentId: number): string {
  return join(repoRoot, WORKTREE_BASE_DIR, runId, `agent-${agentId}`);
}

export function integrationBranchName(runId: string): string {
  return `${BRANCH_PREFIX}/${runId}/integration`;
}

export function integrationWorktreePath(repoRoot: string, runId: string): string {
  return join(repoRoot, WORKTREE_BASE_DIR, runId, 'integration');
}

export function worktreeBaseDir(repoRoot: string, runId: string): string {
  return join(repoRoot, WORKTREE_BASE_DIR, runId);
}
