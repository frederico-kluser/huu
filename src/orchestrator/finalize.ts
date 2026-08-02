/** finalize.ts — Extracted from orchestrator/index.ts (M7-02). */

import type {
  AgentStatus,
  AgentTask,
  AppConfig,
  CheckStep,
  ExecutionTraceEntry,
  IntegrationStatus,
  LogEntry,
  OrchestratorResult,
  OrchestratorState,
  Pipeline,
  PipelineStep,
  PreflightResult,
  PromptStep,
  RunManifest,
  StageIntegration,
  CheckRun,
  AgentManifestEntry,
  AgentLifecyclePhase,
  WorkStep,
  ReviewFinding,
  ReviewSpec,
  ReviewStats,
} from '../lib/types.js';
import {
  DEFAULT_CARD_TIMEOUT_MS,
  DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_NODE_EXECUTIONS,
  DEFAULT_REVIEW_MAX_ROUNDS,
  DEFAULT_REVIEW_TIMEOUT_MS,
  isCheckStep,
  isWorkStep,
} from '../lib/types.js';
import { runPreflight } from '../git/preflight.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { agentBranchName, agentWorktreePath } from '../git/branch-namer.js';
import { mergeAgentBranches } from '../git/integration-merge.js';
import { decomposeTasks } from './task-decomposer.js';
import { resolveMemoryFiles, MemoryFileError } from './memory-files.js';
import { memoryContract, memoryCapForPath } from '../lib/memory-contract.js';
import { hasDagEdges, computeWave, descendantsOf } from './wave-scheduler.js';
import { validateTopology } from '../lib/pipeline-io.js';
import { TimeoutError, withTimeout } from '../lib/with-timeout.js';
import type {
  AgentEvent,
  AgentFactory,
  AgentOutputChunk,
  AgentOutputSubscriber,
  SpawnedAgent,
} from './types.js';
import { StreamLineBuffer } from './stream-line-buffer.js';
import { THINKING_LOG_PREFIX } from './types.js';
import { generateRunId } from '../lib/run-id.js';
import { RunLogger, RUN_LOG_DIR } from '../lib/run-logger.js';
import { runStageIntegrationWithResolver } from './integration-agent.js';
import { evaluateCheckStep } from './check-evaluator.js';
import { runAcceptGate } from './accept-gate.js';
import { checkWriteSetViolations } from './write-sets.js';
import {
  buildFixMessage,
  parseOwnedPaths,
  reviewAgentId,
  runReviewRound,
  writeSetViolations,
} from './review-agent.js';
import { availableTaskSlots } from './task-slots.js';
import { PortAllocator } from './port-allocator.js';
import {
  AGENT_BIN_DIR,
  AGENT_ENV_FILE,
  writeAgentBinShim,
  writeAgentEnvFile,
} from './agent-env.js';
import { ensureNativeShim, type NativeShim } from './native-shim.js';
import { AutoScaler, MATURE_AGE_MS } from './auto-scaler.js';
import { PressureLadder } from './pressure-ladder.js';
import type { GlobalScheduler, RunDriverHandle } from './global-scheduler.js';
import { getSystemMetrics } from '../lib/resource-monitor.js';
import { resolveRamPercent } from '../lib/budget.js';
import { noKernelCeilingWarning } from '../lib/ram-doctor.js';
import {
  DEFAULT_PAUSE_BACKOFF_CAP_MS,
  parsePauseBackoffBaseMs,
  pauseBackoffRemainingMs,
} from './pause-backoff.js';
import { resolveRamTuning } from '../lib/ram-tuning.js';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute } from 'node:path';
import { log, scopedDebugLog } from '../lib/debug-logger.js';
import { attachProcessLogSink } from '../lib/process-log-bridge.js';
import { checkOpenRouterReachable } from '../lib/openrouter.js';
import { AuthError } from '../lib/auth-error.js';
import { findSpec, keyRemedyHint, resolveApiKeyWithSource } from '../lib/api-key.js';
import type { KeyPoolHandle } from '../lib/api-key-pool.js';
import { classifyProviderError } from '../lib/provider-error.js';

import type { OrchCtx } from './context.js';
import { unionPaths } from './orch-consts.js';

// ─── commitAgentWork ──
  export async function commitAgentWork(this: OrchCtx, agentId: number, label: string): Promise<string | null> {
    const status = this.agents.get(agentId);
    if (!status?.worktreePath) return null;
    const git = this.worktreeManager!.getGitClient();
    if (!(await git.hasChanges(status.worktreePath))) return null;

    await git.stageAll(status.worktreePath);
    const commitSha = await git.commitNoVerify(
      status.worktreePath,
      `[${this.pipeline.name}] ${status.stageName} (agent ${agentId}) — ${label}`,
    );
    const changed = await this.branchChangedFiles(agentId);
    this.dlog('orch', 'agent_work_committed', { agentId, label, commitSha, files: changed.length });
    this.updateAgentStatus(agentId, {
      commitSha,
      filesModified: unionPaths(status.filesModified, changed),
    });
    return commitSha;
  }

// ─── branchAhead ──
  export async function branchAhead(this: OrchCtx, agentId: number): Promise<boolean> {
    const status = this.agents.get(agentId);
    if (!status?.branchName) return false;
    const baseRef = status.baseRef ?? this.stageBaseRef;
    if (!baseRef) return false;
    try {
      const out = await this.worktreeManager!
        .getGitClient()
        .exec(`rev-list --count ${baseRef}..${status.branchName}`);
      return Number(out.trim()) > 0;
    } catch (err) {
      this.dlog('orch', 'branch_ahead_failed', {
        agentId,
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

// ─── branchChangedFiles ──
  export async function branchChangedFiles(this: OrchCtx, agentId: number): Promise<string[]> {
    const status = this.agents.get(agentId);
    if (!status?.branchName) return [];
    const baseRef = status.baseRef ?? this.stageBaseRef;
    if (!baseRef) return [];
    try {
      const out = await this.worktreeManager!
        .getGitClient()
        .exec(`diff --name-only ${baseRef}..${status.branchName}`);
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

// ─── recordWriteSetViolations ──
  export async function recordWriteSetViolations(this: OrchCtx, agentId: number): Promise<void> {
    const status = this.agents.get(agentId);
    if (!status?.worktreePath) return;
    const task = this.tasksById.get(agentId);
    const specRel = task?.files[0];
    if (!specRel) return;
    try {
      const specPath = join(status.worktreePath, specRel);
      if (!existsSync(specPath)) return;
      const owned = parseOwnedPaths(readFileSync(specPath, 'utf8'));
      if (owned.length === 0) return;
      // GIT TRUTH, not `filesModified`: the metric is about which FILES the
      // agent wrote, and `git status --porcelain` collapses a new directory to
      // `src/`, which matches no declaration and would read as a violation of
      // itself. The spec file is excluded — the agent is expected to read it,
      // and some flows keep it inside the reviewed tree.
      const changed = (await this.branchChangedFiles(agentId)).filter((f) => f !== specRel);
      const violations = writeSetViolations(changed, owned);
      if (violations.length === 0) return;
      this.updateAgentStatus(agentId, { writeSetViolations: violations });
      this.log({
        level: 'warn',
        message: `agent ${agentId} wrote ${violations.length} file(s) outside its declared ownership: ${violations.join(', ')}`,
        agentId,
      });
      this.dlog('orch', 'write_set_violation', { agentId, owned, violations });
    } catch (err) {
      this.dlog('orch', 'write_set_check_failed', {
        agentId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

// ─── finalizeAgent ──
  export async function finalizeAgent(this: OrchCtx, agentId: number): Promise<void> {
    const status = this.agents.get(agentId);
    if (!status || !status.worktreePath) return;
    const git = this.worktreeManager!.getGitClient();
    let noChanges = false;

    this.dlog('orch', 'finalize_start', {
      agentId,
      worktreePath: status.worktreePath,
      stageIndex: status.stageIndex,
      stageName: status.stageName,
    });

    try {
      this.updateAgentStatus(agentId, { phase: 'finalizing' });
      // "DID THIS TASK PRODUCE ANYTHING" IS A GIT QUESTION, NOT A STATUS ONE.
      // Deciding it from `hasChanges(worktree)` alone was a work-LOSS trap the
      // moment anything commits mid-task: the tree goes clean, the card is
      // marked `no_changes`, and `runStageIntegration` then silently excludes
      // the branch (it only merges `commitSha && state === 'done'`) — the whole
      // agent's output dropped without a single error. The review loop commits
      // per round, so it would hit this on EVERY reviewed card; pause→resume
      // already hits it today (`pauseAgent` clears `commitSha` on a branch that
      // has commits). The `rev-list` only runs when the worktree is clean,
      // which is exactly the case that used to mean `no_changes` — so this
      // costs nothing on the common path.
      const dirty = await git.hasChanges(status.worktreePath);
      const ahead = dirty ? true : await this.branchAhead(agentId);
      const produced = dirty || ahead;
      noChanges = !produced;
      this.dlog('orch', 'finalize_changes_check', { agentId, noChanges, dirty, ahead });
      if (noChanges) {
        this.updateAgentStatus(agentId, { phase: 'no_changes' });
      } else if (dirty) {
        this.updateAgentStatus(agentId, { phase: 'committing' });
        const changed = await git.getChangedFiles(status.worktreePath);
        await git.stageAll(status.worktreePath);
        const commitMsg = `[${this.pipeline.name}] ${status.stageName} (agent ${agentId})`;
        const commitSha = await git.commitNoVerify(status.worktreePath, commitMsg);
        this.dlog('orch', 'finalize_committed', {
          agentId,
          commitSha,
          fileCount: changed.length,
        });
        this.updateAgentStatus(agentId, {
          commitSha,
          // Union, not replace: with a review loop the earlier rounds are
          // already committed, so this delta is only the tail of the work.
          filesModified: unionPaths(this.agents.get(agentId)?.filesModified, changed),
        });
      } else {
        // Clean tree, branch ahead — the work is already committed (review
        // rounds, or a pause that cleared the sha). Re-derive both fields from
        // git so the merge filter and the manifest see the truth.
        const head = await git.getHead(status.worktreePath);
        this.dlog('orch', 'finalize_precommitted', { agentId, commitSha: head });
        this.updateAgentStatus(agentId, {
          commitSha: head,
          filesModified: unionPaths(
            this.agents.get(agentId)?.filesModified,
            await this.branchChangedFiles(agentId),
          ),
        });
      }

      // Write-set instrumentation (§8.1) — MUST run before the worktree goes
      // away, since the task spec is read from inside it.
      await this.recordWriteSetViolations(agentId);

      this.updateAgentStatus(agentId, { phase: 'cleaning_up' });
      await this.worktreeManager!.removeAgentWorktree(agentId);
      this.dlog('orch', 'finalize_done', {
        agentId,
        noChanges,
        commitSha: status.commitSha,
      });
      // Preserve the no_changes phase as the terminal state for "agent ran
      // but produced nothing". Overwriting it with `done` collapsed two
      // distinct outcomes into one in the manifest and the kanban, making
      // diagnosis ("did the agent skip silently?") harder.
      // merged:false marks "finished, branch NOT yet merged" — the card
      // renders READY (doing column) until runStageIntegration lands its
      // branch. no_changes has nothing to merge, so it stays flag-free.
      this.updateAgentStatus(agentId, {
        phase: noChanges ? 'no_changes' : 'done',
        state: 'done',
        merged: noChanges ? undefined : false,
      });
    } catch (err) {
      // Capture the failure with full context so post-mortem can tell
      // "commit failed because the worktree was already gone" from
      // "git lock contention" — the bare error message often elides
      // which step we were on when it threw.
      this.dlog('orch', 'finalize_failed', {
        agentId,
        worktreePath: status.worktreePath,
        commitSoFar: status.commitSha,
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      this.updateAgentStatus(agentId, {
        phase: 'error',
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.portAllocator.release(agentId);
      this.completedTasks++;
      this.appendManifestEntry(agentId);
      this.autoScaler.notifyAgentCompleted();
      this.announceAgentExit(agentId, 'completed');
      this.emit();
    }
  }

