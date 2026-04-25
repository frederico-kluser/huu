import type {
  AgentManifestEntry,
  AppConfig,
  IntegrationStatus,
} from '../lib/types.js';
import { GitClient } from '../git/git-client.js';
import { mergeAgentBranches, getConflictedBranches } from '../git/integration-merge.js';
import type { AgentFactory, AgentEvent } from './types.js';
import { generateIntegrationSystemPrompt } from './agents-md-generator.js';
import { buildIntegrationPrompt } from '../prompts/integration-task.js';

const INTEGRATION_AGENT_ID = 9999;

export interface IntegrationContext {
  repoRoot: string;
  integrationWorktreePath: string;
  integrationBranch: string;
  runId: string;
  config: AppConfig;
  resolverFactory: AgentFactory;
  /** Forwarded so the orchestrator can render integration-agent logs in the dashboard. */
  onEvent: (agentId: number, event: AgentEvent) => void;
}

export interface IntegrationResolution {
  success: boolean;
  status: IntegrationStatus;
  resolvedConflicts: number;
  errorMessage?: string;
}

/**
 * Runs the integration phase for a stage:
 *  1. Tries `mergeAgentBranches` (deterministic, fast path).
 *  2. If conflicts remain AND a resolver factory is provided, spawns an integration
 *     agent in the integration worktree. The agent is allowed to run git commands
 *     to resolve conflicts.
 *  3. After the agent finishes: stage and commit any leftover changes; return a
 *     resolved IntegrationStatus.
 *
 * If no resolver is provided, returns the status as-is (orchestrator decides whether
 * to abort the run).
 */
export async function runStageIntegrationWithResolver(
  entries: AgentManifestEntry[],
  ctx: IntegrationContext,
): Promise<IntegrationResolution> {
  // 1. Deterministic merge attempt
  const status = mergeAgentBranches(entries, ctx.integrationWorktreePath, ctx.repoRoot);

  if (status.phase === 'done') {
    return { success: true, status, resolvedConflicts: 0 };
  }

  // 2. Conflicts present — spawn integration agent
  const conflictedBranches = getConflictedBranches(status);
  const initialConflictCount = status.conflicts.length;

  // Build a fake task so the AgentFactory contract is satisfied. The agent
  // runs in the integration worktree (not in a per-agent worktree).
  const integrationTask = {
    agentId: INTEGRATION_AGENT_ID,
    files: [],
    branchName: ctx.integrationBranch,
    worktreePath: ctx.integrationWorktreePath,
    stageIndex: -1,
    stageName: 'integration',
  };

  const eventForwarder = (event: AgentEvent) => ctx.onEvent(INTEGRATION_AGENT_ID, event);

  let agent: Awaited<ReturnType<AgentFactory>> | null = null;

  try {
    agent = await ctx.resolverFactory(
      integrationTask,
      ctx.config,
      generateIntegrationSystemPrompt(
        INTEGRATION_AGENT_ID,
        ctx.integrationBranch,
        ctx.integrationWorktreePath,
      ),
      ctx.integrationWorktreePath,
      eventForwarder,
    );

    const message =
      generateIntegrationSystemPrompt(
        INTEGRATION_AGENT_ID,
        ctx.integrationBranch,
        ctx.integrationWorktreePath,
      ) +
      '\n\n---\n\n' +
      buildIntegrationPrompt(
        status.branchesMerged,
        conflictedBranches,
        status.conflicts,
        ctx.integrationBranch,
      );

    await agent.prompt(message);

    // 3. Verify resolution: any remaining unstaged/unmerged changes?
    const git = new GitClient(ctx.repoRoot);

    // First: are any agent branches still unmerged? Check via merge-base or
    // simply the branchesPending list — if non-empty, the agent didn't run all
    // the merges. We try to merge them now; if any still conflicts, fail.
    for (const branch of conflictedBranches) {
      // The agent should already have merged these; if there's still no merge
      // commit, attempt a final merge here.
      try {
        const mergeResult = git.merge(ctx.integrationWorktreePath, branch);
        if (mergeResult.success) {
          status.branchesMerged.push(branch);
          status.branchesPending = status.branchesPending.filter((b) => b !== branch);
        } else if (mergeResult.conflicts.length === 0) {
          // Branch was already merged by the agent — that's the success case.
          status.branchesMerged.push(branch);
          status.branchesPending = status.branchesPending.filter((b) => b !== branch);
        } else {
          // Still conflicts after the resolver ran — give up.
          git.abortMerge(ctx.integrationWorktreePath);
          return {
            success: false,
            status: { ...status, phase: 'error' },
            resolvedConflicts: 0,
            errorMessage: `Integration agent left ${mergeResult.conflicts.length} conflict(s) in ${branch}`,
          };
        }
      } catch (err) {
        // `git merge <branch>` can fail with "Already up to date" — that's fine,
        // the agent already merged it. Treat as merged.
        const msg = err instanceof Error ? err.message : String(err);
        if (/already.*up.to.date/i.test(msg)) {
          status.branchesMerged.push(branch);
          status.branchesPending = status.branchesPending.filter((b) => b !== branch);
        } else {
          // Otherwise propagate.
          throw err;
        }
      }
    }

    // 4. If there are uncommitted changes (e.g., agent staged but didn't commit),
    // finalize them with a sentinel commit.
    if (git.hasChanges(ctx.integrationWorktreePath)) {
      git.stageAll(ctx.integrationWorktreePath);
      const sha = git.commitNoVerify(
        ctx.integrationWorktreePath,
        `[programatic-agent] Integration merge — ${ctx.runId}\n\nResolved conflicts from: ${conflictedBranches.join(', ')}`,
      );
      status.finalCommitSha = sha;
    } else {
      try {
        status.finalCommitSha = git.getHead(ctx.integrationWorktreePath);
      } catch {
        /* keep undefined */
      }
    }

    status.phase = 'done';
    status.conflicts = status.conflicts.map((c) => ({ ...c, resolved: true }));

    return {
      success: true,
      status,
      resolvedConflicts: initialConflictCount,
    };
  } catch (err) {
    return {
      success: false,
      status: { ...status, phase: 'error' },
      resolvedConflicts: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (agent) {
      try {
        await agent.dispose();
      } catch {
        /* best effort */
      }
    }
  }
}
