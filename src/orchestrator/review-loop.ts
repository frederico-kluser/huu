/** review-loop.ts — Extracted from orchestrator/index.ts (M7-02). */

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
  buildWorkerReport,
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

// ─── runReviewLoop ──
  export async function runReviewLoop(this: OrchCtx,
    task: AgentTask,
    review: ReviewSpec,
    agent: SpawnedAgent,
    cardTimeoutMs: number,
  ): Promise<{ preempted: boolean; blocked: boolean }> {
    const agentId = task.agentId;
    const status = this.agents.get(agentId);
    if (!status?.worktreePath || !status.branchName) return { preempted: false, blocked: false };

    const git = this.worktreeManager!.getGitClient();
    // Step 0 — a clean worktree AND a branch that isn't ahead means the agent
    // wrote nothing. There is nothing to criticise, and spawning a critic to
    // say so would cost a slot and a model call for a guaranteed answer.
    const dirty = await git.hasChanges(status.worktreePath);
    if (!dirty && !(await this.branchAhead(agentId))) {
      this.dlog('orch', 'review_skipped_no_work', { agentId });
      return { preempted: false, blocked: false };
    }

    const maxRounds = Math.max(1, review.maxRounds ?? DEFAULT_REVIEW_MAX_ROUNDS);
    // An explicit timeout wins; the default is the per-card budget capped at
    // the review ceiling, so a review can never outlive the work it reviews by
    // more than one card's worth of wall clock per round.
    const roundTimeoutMs = review.timeoutMs ?? Math.min(cardTimeoutMs, DEFAULT_REVIEW_TIMEOUT_MS);
    const findings: ReviewFinding[] = [...(status.reviewFindings ?? [])];
    const stats: ReviewStats = {
      provedBlocking: status.reviewStats?.provedBlocking ?? 0,
      unprovedBlocking: status.reviewStats?.unprovedBlocking ?? 0,
    };

    let blocked = false;
    this.reviewLockedIds.add(agentId);
    try {
      for (let round = 1; round <= maxRounds; round++) {
        if (this.aborted) break;
        if (this.consumePreemptMarker(agentId)) return { preempted: true, blocked: false };
        // The L3 valve dropped the lock while we were between rounds.
        if (!this.reviewLockedIds.has(agentId)) break;

        // Commit the round BEFORE reviewing: the critic then reads a real
        // `git diff <baseRef>..HEAD` range instead of a dirty worktree, which
        // is the only way NEW files show up in the diff at all — and it leaves
        // a per-round trail of what each pass changed.
        await this.commitAgentWork(agentId, `review round ${round}`);
        this.updateAgentStatus(agentId, { phase: 'reviewing', reviewRounds: round });

        // Snapshotted BEFORE the round: `findings` accumulates across rounds,
        // so taking it after would hand the critic its own output back.
        const priorFindings = [...findings];
        // The worker's own account, filtered out of the shared log buffer (it
        // also holds the previous critic's output and the thinking trace).
        const workerReport = buildWorkerReport(this.agents.get(agentId)?.logs ?? []);

        const controller = new AbortController();
        this.reviewAborters.set(agentId, controller);
        let result: Awaited<ReturnType<typeof runReviewRound>>;
        try {
          result = await runReviewRound({
            review,
            round,
            task,
            ...(workerReport ? { workerReport } : {}),
            ...(priorFindings.length > 0 ? { previousFindings: priorFindings } : {}),
            worktreePath: status.worktreePath,
            branchName: status.branchName,
            baseRef: this.agents.get(agentId)?.baseRef ?? this.stageBaseRef,
            config: this.config,
            factory: this.agentFactory,
            timeoutMs: roundTimeoutMs,
            signal: controller.signal,
            // The critic is a RESERVED agent (id -agentId): it consumes budget
            // and a pool slot exactly like the judge, and is never a
            // preemption victim.
            onReservedLifecycle: (ev, id) => this.trackReservedAgent(ev, id),
            onEvent: (revId, event) => this.handleReviewEvent(agentId, revId, event),
          });
        } finally {
          this.reviewAborters.delete(agentId);
        }

        findings.push(...result.findings);
        for (const w of result.warnings) {
          this.log({ level: 'warn', message: `🔍 review: ${w}`, agentId });
        }
        this.updateAgentStatus(agentId, { reviewFindings: [...findings] });
        this.persistReviewFindings(agentId, review, findings);
        this.log({
          level: 'info',
          message: `🔍 agent ${agentId} review round ${round}/${maxRounds}: ${result.verdict}, ${result.findings.length} finding(s), ${result.blocking.length} blocking${result.reason ? ` — ${result.reason}` : ''}`,
          agentId,
        });

        // Convergence is MECHANICAL and reads severities only — the critic's
        // own `verdict` string never decides. `unavailable` lands here too,
        // with zero blocking: that IS the forward default.
        if (result.blocking.length === 0) break;

        if (round >= maxRounds) {
          // onBlocked:'hold' with an interactive channel wired: DON'T waive —
          // report `blocked` so the caller parks the card as a retriable
          // failure carrying the open findings, and the run's end-of-walk
          // `awaiting_retry` hold surfaces it for a human (retry re-runs the
          // task; abandoning waives). Without interactiveRetry — headless,
          // run-many, smoke tests — fall through to the waive path EXACTLY as
          // before: this field can never deadlock a headless run.
          if (review.onBlocked === 'hold' && this.interactiveRetry) {
            this.persistReviewFindings(agentId, review, findings);
            // The findings shard (when declared) dirties the tree AFTER this
            // round's commit — fold it in so the preserved branch is complete.
            await this.commitAgentWork(agentId, 'review hold');
            this.log({
              level: 'warn',
              message: `agent ${agentId} hit the review cap (${maxRounds} rounds) with ${result.blocking.length} blocking finding(s) still open — HELD for a human decision (onBlocked: 'hold'); the branch is preserved and the run will park in awaiting_retry`,
              agentId,
            });
            blocked = true;
            break;
          }
          this.updateAgentStatus(agentId, { reviewWaived: true });
          this.persistReviewFindings(agentId, review, findings, true);
          this.log({
            level: 'warn',
            message: `agent ${agentId} hit the review cap (${maxRounds} rounds) with ${result.blocking.length} blocking finding(s) still open — WAIVED; the branch merges and the findings are recorded`,
            agentId,
          });
          break;
        }

        // Instrumentation (§8.1): count only blockers that actually TRIGGERED a
        // fix round. Proved-vs-unproved is the one number that lets this
        // project re-decide "block by severity" with its own data instead of
        // literature measured on another workload.
        for (const f of result.blocking) {
          if (f.proof) stats.provedBlocking++;
          else stats.unprovedBlocking++;
        }
        this.updateAgentStatus(agentId, { phase: 'fixing', reviewStats: { ...stats } });

        try {
          await withTimeout(
            agent.prompt(buildFixMessage(result.blocking, round, maxRounds)),
            cardTimeoutMs,
            'card',
          );
        } catch (err) {
          if (this.consumePreemptMarker(agentId)) return { preempted: true, blocked: false };
          try {
            await withTimeout(agent.abort(), 3_000);
          } catch {
            /* best-effort */
          }
          this.updateAgentStatus(agentId, { reviewWaived: true });
          this.persistReviewFindings(agentId, review, findings, true);
          this.log({
            level: 'warn',
            message: `agent ${agentId} failed to apply review fixes (${err instanceof Error ? err.message : String(err)}) — remaining findings WAIVED; the work so far still merges`,
            agentId,
          });
          break;
        }
      }
    } finally {
      this.reviewLockedIds.delete(agentId);
      this.reviewAborters.delete(agentId);
    }
    // FINAL marker check. The in-loop checks cover a preemption that lands
    // BETWEEN rounds; this one covers a preemption that lands DURING one —
    // reachable once the L3 valve has released the lock, where the critic (or
    // the commit) simply fails against a worktree that is already gone. Without
    // it the loop would fall through to finalize on a task the guard has
    // already requeued, counting it twice. A preemption WINS over a blocked
    // outcome from the last round — the guard owns the card state either way.
    return { preempted: this.consumePreemptMarker(agentId), blocked };
  }

// ─── handleReviewEvent ──
  export function handleReviewEvent(this: OrchCtx, taskAgentId: number, reviewId: number, event: AgentEvent): void {
    if (event.type !== 'log' && event.type !== 'error') return;
    const message = `🔍 ${event.message}`;
    this.log({
      level: event.type === 'error' ? 'error' : (event.level ?? 'info'),
      message,
      agentId: taskAgentId,
    });
    this.appendAgentLog(taskAgentId, message);
    this.dlog('orch', 'review_event', { taskAgentId, reviewId, type: event.type });
    this.emit();
  }

// ─── persistReviewFindings ──
  export function persistReviewFindings(this: OrchCtx, 
    agentId: number,
    review: ReviewSpec,
    findings: readonly ReviewFinding[],
    waived = false,
  ): void {
    if (!review.findingsDir) return;
    const status = this.agents.get(agentId);
    if (!status?.worktreePath) return;
    try {
      const dir = join(status.worktreePath, review.findingsDir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `agent-${agentId}.json`),
        JSON.stringify(
          {
            _format: 'huu-review-v1',
            agentId,
            stageName: status.stageName,
            rounds: status.reviewRounds ?? 0,
            waived: waived || status.reviewWaived === true,
            findings,
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
    } catch (err) {
      this.dlog('orch', 'review_shard_write_failed', {
        agentId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

