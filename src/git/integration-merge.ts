import { GitClient } from './git-client.js';
import { execFileSync } from 'node:child_process';
import type {
  AgentManifestEntry,
  IntegrationStatus,
  IntegrationConflict,
} from '../lib/types.js';
import { log as dlog } from '../lib/debug-logger.js';

/**
 * Merges eligible agent branches into the integration worktree, sorted by agentId.
 * Conflicts are recorded; the caller (orchestrator) decides whether to spawn an
 * integration agent to resolve them or to abort the run.
 *
 * `onBranchMerged` fires right after each branch lands — the orchestrator uses
 * it to flip that agent's card to merged (the kanban's DONE ripple) while the
 * rest of the stage is still merging. Callback errors are the caller's problem
 * to avoid; the merge itself must never depend on it.
 *
 * `verify` (optional) runs after every successful merge, with the integration
 * worktree path and the branch that just landed. An `ok: false` result causes
 * `git reset --hard HEAD~1` in the integration worktree (undoing ONLY huu's own
 * merge commit) and puts the branch back in `branchesPending` so the caller
 * marks it `mergeFailed`. Thrown errors are treated the same as `ok: false`.
 */
export interface VerifyResult {
  ok: boolean;
  output: string;
}

export async function mergeAgentBranches(
  entries: AgentManifestEntry[],
  integrationWorktreePath: string,
  repoRoot: string,
  onBranchMerged?: (branchName: string) => void,
  verify?: (worktreePath: string, branchName: string) => Promise<VerifyResult>,
): Promise<IntegrationStatus> {
  const git = new GitClient(repoRoot);
  const status: IntegrationStatus = {
    phase: 'merging',
    branchesMerged: [],
    branchesPending: entries.map((e) => e.branchName),
    conflicts: [],
  };

  const sorted = [...entries].sort((a, b) => a.agentId - b.agentId);
  dlog('merge', 'stage_start', {
    integrationWorktreePath,
    branchCount: sorted.length,
    branches: sorted.map((e) => e.branchName),
  });

  for (const entry of sorted) {
    status.branchesPending = status.branchesPending.filter((b) => b !== entry.branchName);

    dlog('merge', 'attempt', {
      branch: entry.branchName,
      agentId: entry.agentId,
    });
    const result = await git.merge(integrationWorktreePath, entry.branchName);
    if (result.success) {
      // Optional verify gate: shell command runs after the merge lands.
      // A red gate undoes huu's own merge commit (the ONLY defensive
      // reset in the system — the merge was never pushed) and sends the
      // branch back to pending so the caller marks it mergeFailed.
      let gated = false;
      if (verify) {
        const v = await verify(integrationWorktreePath, entry.branchName).catch(
          (err: unknown) => ({
            ok: false as const,
            output: err instanceof Error ? err.message : String(err),
          }),
        );
        if (!v.ok) {
          dlog('merge', 'verify_failed', {
            branch: entry.branchName,
            agentId: entry.agentId,
            output: v.output,
          });
          execFileSync('git', ['reset', '--hard', 'HEAD~1'], { cwd: integrationWorktreePath });
          status.branchesPending.push(entry.branchName);
          gated = true;
        }
      }
      if (!gated) {
        status.branchesMerged.push(entry.branchName);
        onBranchMerged?.(entry.branchName);
        dlog('merge', 'ok', { branch: entry.branchName });
      }
    } else {
      const conflictEntries: IntegrationConflict[] = result.conflicts.map((file) => ({
        file,
        branches: [entry.branchName],
        resolved: false,
      }));
      status.conflicts.push(...conflictEntries);
      await git.abortMerge(integrationWorktreePath);
      status.branchesPending.push(entry.branchName);
      dlog('merge', 'conflict', {
        branch: entry.branchName,
        agentId: entry.agentId,
        conflictFiles: result.conflicts,
        // `error` is non-empty even on a clean conflict (it carries the
        // underlying git stderr); surfacing it makes "merge failed for an
        // unexpected reason" distinguishable from "files conflicted".
        gitError: result.error,
      });
    }
  }

  status.phase =
    status.conflicts.length > 0
      ? 'conflict_resolving'
      : status.branchesPending.length > 0
        ? 'error'
        : 'done';

  if (status.phase === 'done') {
    try {
      status.finalCommitSha = await git.getHead(integrationWorktreePath);
    } catch (err) {
      dlog('merge', 'head_read_failed', {
        integrationWorktreePath,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  dlog('merge', 'stage_end', {
    phase: status.phase,
    merged: status.branchesMerged.length,
    pending: status.branchesPending.length,
    conflicts: status.conflicts.length,
  });
  return status;
}

export function getConflictedBranches(status: IntegrationStatus): string[] {
  return [...new Set(status.conflicts.flatMap((c) => c.branches))];
}
