import { GitClient } from './git-client.js';
import type {
  AgentManifestEntry,
  IntegrationStatus,
  IntegrationConflict,
} from '../lib/types.js';

/**
 * Merges eligible agent branches into the integration worktree, sorted by agentId.
 * Conflicts are recorded; the caller (orchestrator) decides whether to spawn an
 * integration agent to resolve them or to abort the run.
 */
export function mergeAgentBranches(
  entries: AgentManifestEntry[],
  integrationWorktreePath: string,
  repoRoot: string,
): IntegrationStatus {
  const git = new GitClient(repoRoot);
  const status: IntegrationStatus = {
    phase: 'merging',
    branchesMerged: [],
    branchesPending: entries.map((e) => e.branchName),
    conflicts: [],
  };

  const sorted = [...entries].sort((a, b) => a.agentId - b.agentId);

  for (const entry of sorted) {
    status.branchesPending = status.branchesPending.filter((b) => b !== entry.branchName);

    const result = git.merge(integrationWorktreePath, entry.branchName);
    if (result.success) {
      status.branchesMerged.push(entry.branchName);
    } else {
      const conflictEntries: IntegrationConflict[] = result.conflicts.map((file) => ({
        file,
        branches: [entry.branchName],
        resolved: false,
      }));
      status.conflicts.push(...conflictEntries);
      git.abortMerge(integrationWorktreePath);
      status.branchesPending.push(entry.branchName);
    }
  }

  status.phase = status.conflicts.length > 0 ? 'conflict_resolving' : 'done';

  if (status.phase === 'done') {
    try {
      status.finalCommitSha = git.getHead(integrationWorktreePath);
    } catch {
      /* could not get head */
    }
  }

  return status;
}

export function getConflictedBranches(status: IntegrationStatus): string[] {
  return [...new Set(status.conflicts.flatMap((c) => c.branches))];
}
