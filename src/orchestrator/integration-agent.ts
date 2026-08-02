import type {
  AgentManifestEntry,
  AppConfig,
  IntegrationStatus,
} from '../lib/types.js';
import { GitClient } from '../git/git-client.js';
import { TimeoutError, resolveResolverTimeoutMs, withTimeout } from '../lib/with-timeout.js';
import { mergeAgentBranches, getConflictedBranches, type VerifyResult } from '../git/integration-merge.js';
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
  /**
   * Fired once, right before the LLM conflict resolver is spawned (i.e. the
   * deterministic merge left conflicts). Lets the orchestrator flip the
   * merge card from `merging` to `conflict_resolving`.
   */
  onPhase?: (phase: 'conflict_resolving') => void;
  /**
   * Fired per branch as it lands in the integration worktree (deterministic
   * path AND post-resolver verification) — drives the per-card merged ripple.
   */
  onBranchMerged?: (branchName: string) => void;
  /**
   * Fired 'spawn' right before the conflict-resolver agent is created and
   * 'exit' after it is disposed — symmetric even when the factory throws.
   * Lets the orchestrator count the reserved resolver (9999) in the global
   * RAM budget while it lives. The deterministic-merge-only path never fires
   * (no agent is spawned).
   */
  onReservedLifecycle?: (ev: 'spawn' | 'exit', agentId: number) => void;
  /**
   * Optional verify gate called after every successful branch merge (both
   * the deterministic pass AND the post-resolver re-merge). Same contract
   * as `mergeAgentBranches`'s `verify` parameter.
   */
  mergeVerify?: (worktreePath: string, branchName: string) => Promise<VerifyResult>;
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
  const status = await mergeAgentBranches(
    entries,
    ctx.integrationWorktreePath,
    ctx.repoRoot,
    ctx.onBranchMerged,
    ctx.mergeVerify,
  );

  if (status.phase === 'done') {
    return { success: true, status, resolvedConflicts: 0 };
  }

  // Non-conflict merge failure: branchesPending populated, but conflicts empty.
  // The integration agent has nothing to resolve here — git merge failed for
  // some other reason (timeout, hook, refusal). Spawning the agent would loop
  // over an empty conflictedBranches list and falsely report success, leaving
  // the integration HEAD unchanged while the orchestrator believes the stage
  // landed. Fail loud instead.
  if (status.conflicts.length === 0 && status.branchesPending.length > 0) {
    return {
      success: false,
      status: { ...status, phase: 'error' },
      resolvedConflicts: 0,
      errorMessage: `merge failed for non-conflict reason on ${status.branchesPending.length} branch(es): ${status.branchesPending.join(', ')}`,
    };
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
  let announced = false;

  try {
    ctx.onPhase?.('conflict_resolving');
    // Announce BEFORE the factory (charge the RAM the spawn will allocate);
    // the local flag keeps spawn/exit symmetric on a factory throw.
    ctx.onReservedLifecycle?.('spawn', INTEGRATION_AGENT_ID);
    announced = true;
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
      // Conflict resolution is a hard reasoning task — always run the resolver
      // at the maximum thinking level its model supports.
      { maxThinking: true },
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

    // The ONLY agent call in a run that used to have no wall-clock bound. A
    // hung resolver stalled the stage — and therefore the whole run — forever,
    // with no card to retry and no error to report. On timeout we abort the
    // resolver so it stops burning tokens in the background, then let the
    // verification below decide the stage's fate: branches it did manage to
    // merge still count, and the ones it didn't are retried deterministically.
    try {
      await withTimeout(agent.prompt(message), resolveResolverTimeoutMs(), 'conflict resolver');
    } catch (err) {
      if (!(err instanceof TimeoutError)) throw err;
      ctx.onEvent(INTEGRATION_AGENT_ID, {
        type: 'log',
        level: 'warn',
        message: `conflict resolver timed out after ${resolveResolverTimeoutMs()}ms — falling back to the deterministic re-merge of the branches it left pending`,
      });
      try {
        await agent.abort();
      } catch {
        /* best-effort — the verification below is what actually decides */
      }
    }

    // 3. Verify resolution: any remaining unstaged/unmerged changes?
    const git = new GitClient(ctx.repoRoot);

    // First: are any agent branches still unmerged? Check via merge-base or
    // simply the branchesPending list — if non-empty, the agent didn't run all
    // the merges. We try to merge them now; if any still conflicts, fail.
    for (const branch of conflictedBranches) {
      // The agent should already have merged these; if there's still no merge
      // commit, attempt a final merge here.
      try {
        const mergeResult = await git.merge(ctx.integrationWorktreePath, branch);
        if (mergeResult.success) {
          status.branchesMerged.push(branch);
          status.branchesPending = status.branchesPending.filter((b) => b !== branch);
          ctx.onBranchMerged?.(branch);
        } else if (mergeResult.conflicts.length === 0) {
          // Branch was already merged by the agent — that's the success case.
          status.branchesMerged.push(branch);
          status.branchesPending = status.branchesPending.filter((b) => b !== branch);
          ctx.onBranchMerged?.(branch);
        } else {
          // Still conflicts after the resolver ran — give up.
          await git.abortMerge(ctx.integrationWorktreePath);
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
          ctx.onBranchMerged?.(branch);
        } else {
          // Otherwise propagate.
          throw err;
        }
      }
    }

    // 3b. After the resolver loop, every branch the agent was asked to handle
    // must be in branchesMerged. If any branch is still pending, fail loudly
    // instead of returning success with a partial integration — that would
    // leave the integration HEAD missing this stage's work and the orchestrator
    // would happily branch the next stage from a stale base.
    if (status.branchesPending.length > 0) {
      return {
        success: false,
        status: { ...status, phase: 'error' },
        resolvedConflicts: 0,
        errorMessage: `${status.branchesPending.length} branch(es) still pending after resolver: ${status.branchesPending.join(', ')}`,
      };
    }

    // 4. If there are uncommitted changes (e.g., agent staged but didn't commit),
    // finalize them with a sentinel commit.
    if (await git.hasChanges(ctx.integrationWorktreePath)) {
      await git.stageAll(ctx.integrationWorktreePath);
      const sha = await git.commitNoVerify(
        ctx.integrationWorktreePath,
        `[huu] Integration merge — ${ctx.runId}\n\nResolved conflicts from: ${conflictedBranches.join(', ')}`,
      );
      status.finalCommitSha = sha;
    } else {
      try {
        status.finalCommitSha = await git.getHead(ctx.integrationWorktreePath);
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
    if (announced) ctx.onReservedLifecycle?.('exit', INTEGRATION_AGENT_ID);
  }
}
