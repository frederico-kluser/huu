/** guard-pause.ts — Extracted from orchestrator/index.ts (M7-02). */

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
import { POLL_INTERVAL_MS, PRESSURE_POLL_INTERVAL_MS, computeCardTimeoutMs, unionPaths } from './orch-consts.js';

// ─── destroyAgent ──
  export async function destroyAgent(this: OrchCtx, agentId: number, reason?: string): Promise<void> {
    const agent = this.activeAgents.get(agentId);
    if (!agent) return;
    // A review-locked agent is off limits: its worktree is being READ by the
    // critic right now, and deleting it mid-diff would produce a garbage
    // verdict on top of throwing the work away. The victim scans already skip
    // these ids; this is the backstop for every OTHER caller (the multi-run
    // scheduler, a test, a future path) — see reviewLockedIds.
    if (this.reviewLockedIds.has(agentId)) {
      this.dlog('orch', 'preempt_skipped_review_locked', { agentId, op: 'destroy', reason });
      return;
    }

    // Marker consumed by spawnAndRun's catch so the killed attempt's
    // rejection skips retry accounting (see killedAgentIds doc).
    this.killedAgentIds.add(agentId);

    // Dispose causes agent.prompt() to reject in spawnAndRun.
    try {
      await agent.dispose();
    } catch {
      /* best-effort */
    }

    this.activeAgents.delete(agentId);
    this.spawningIds.delete(agentId);

    const status = this.agents.get(agentId);
    const worktreePath = status?.worktreePath;
    const branchName = status?.branchName;

    if (worktreePath) {
      try {
        await this.worktreeManager!.removeAgentWorktree(agentId);
      } catch {
        /* best-effort */
      }
    }

    if (branchName) {
      try {
        const git = this.worktreeManager!.getGitClient();
        await git.deleteBranch(branchName);
      } catch {
        /* best-effort */
      }
    }

    this.portAllocator.release(agentId);

    // Back to the TODO column — the card visibly returns to `pending` with
    // a requeue counter, and work restarts from zero on the next spawn.
    // Older agents are never the victim, so their finished work is kept.
    const task = agent.task;
    this.updateAgentStatus(agentId, {
      state: 'idle',
      phase: 'pending',
      currentFile: task.files.length > 0 ? task.files[0]! : null,
      filesModified: [],
      pushStatus: 'pending',
      branchName: task.branchName,
      worktreePath: task.worktreePath,
      commitSha: undefined,
      error: undefined,
      errorKind: undefined,
      attempt: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      merged: undefined,
      mergedAt: undefined,
      mergeFailed: undefined,
      requeues: (this.agents.get(agentId)?.requeues ?? 0) + 1,
    });
    const ramPercent = Math.round(this.autoScaler.getStatus().ramPercent);
    // Name the LADDER verdict that fired: the container's RAM% alone is
    // misleading (a host-side trigger — swap-in, PSI full, host avail — can
    // preempt at single-digit container RAM% and used to read as insanity).
    this.log({
      level: 'warn',
      message: `agent ${agentId} killed by memory guard${reason ? ` — ${reason}` : ''} (container RAM ${ramPercent}%); task requeued to TODO`,
      agentId,
    });

    this.pendingTasks.unshift(task);
    this.poolWakeup?.();
    this.announceAgentExit(agentId, 'killed');
    // log() deliberately doesn't emit; publish the kill line + queue change
    // now instead of piggybacking on the NEXT status emit (which could be a
    // whole spawn away — the UI's log pane lagged one snapshot).
    this.emit();
  }

// ─── pauseAgent ──
  export async function pauseAgent(this: OrchCtx, agentId: number, reason?: string): Promise<void> {
    const agent = this.activeAgents.get(agentId);
    if (!agent) return;
    // See destroyAgent: a review-locked agent is not a preemption victim.
    if (this.reviewLockedIds.has(agentId)) {
      this.dlog('orch', 'preempt_skipped_review_locked', { agentId, op: 'pause', reason });
      return;
    }

    // Try to capture a resumable checkpoint. ANY failure → kill+requeue.
    let sessionPath: string | null = null;
    try {
      sessionPath = (await agent.checkpoint?.()) ?? null;
    } catch (err) {
      this.dlog('orch', 'checkpoint_failed', {
        agentId,
        err: err instanceof Error ? err.message : String(err),
      });
      sessionPath = null;
    }
    if (!sessionPath) {
      await this.destroyAgent(agentId, reason);
      return;
    }

    // Mark BEFORE dispose so spawnAndRun's prompt interception skips the
    // disposed attempt's retry/finalize accounting (mirrors killedAgentIds;
    // dispose makes the in-flight prompt() reject — or resolve, both covered).
    this.pausedAgentIds.add(agentId);
    try {
      await agent.dispose();
    } catch {
      /* best-effort — the session file is already flushed on disk */
    }

    this.activeAgents.delete(agentId);
    this.spawningIds.delete(agentId);
    this.portAllocator.release(agentId);

    // PRESERVE worktree + branch (do NOT remove) — they hold the agent's file
    // writes; the session file holds its transcript. Record the restore pointer
    // so the next spawn reconstructs the session in that same worktree.
    this.restoreSessionPaths.set(agentId, sessionPath);

    const task = agent.task;
    const prev = this.agents.get(agentId);
    this.updateAgentStatus(agentId, {
      state: 'idle',
      phase: 'paused',
      currentFile: task.files.length > 0 ? task.files[0]! : null,
      // filesModified intentionally NOT reset — the work is preserved on disk.
      commitSha: undefined,
      error: undefined,
      errorKind: undefined,
      attempt: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      merged: undefined,
      mergedAt: undefined,
      mergeFailed: undefined,
      pauses: (prev?.pauses ?? 0) + 1,
      pausedAt: Date.now(),
    });
    const ramPercent = Math.round(this.autoScaler.getStatus().ramPercent);
    // Name the LADDER verdict that fired (see the destroyAgent counterpart):
    // "paused (RAM 9%)" without the host-side reason reads as insanity.
    this.log({
      level: 'warn',
      message: `agent ${agentId} paused by memory guard${reason ? ` — ${reason}` : ''} (container RAM ${ramPercent}%); worktree + session preserved, task requeued — resumes when headroom returns`,
      agentId,
    });

    // Back to the queue. The normal spawn-gating (shouldSpawn: PSI + budget)
    // resumes it automatically once RAM frees — no separate resume path.
    this.pendingTasks.unshift(task);
    this.poolWakeup?.();
    // A pause keeps the demand (active → pending) but frees the agent's RAM —
    // an immediate re-grant lets another run use it while the backoff holds.
    this.announceAgentExit(agentId, 'paused');
    // See destroyAgent: publish the pause log line immediately.
    this.emit();
  }

// ─── executeTaskPool ──
  export async function executeTaskPool(this: OrchCtx, tasks: AgentTask[]): Promise<void> {
    this.pendingTasks = [...tasks];

    while (
      !this.aborted &&
      (this.pendingTasks.length > 0 || this.activeAgents.size > 0 || this.spawningIds.size > 0 || this.finalizingIds.size > 0)
    ) {
      // Per-tick pressure snapshot (single-run path; the scheduler owns it in
      // subordinate mode): freezes spawns at L1+ and shortens the tick at L2+.
      let poolPressureLevel = 0;
      let pressureBlocked = false;
      if (this.scheduler) {
        // SUBORDINATE (multi-run): the GlobalScheduler owns the concurrency
        // target AND the cross-run, priority-ordered memory-guard kill. Refresh
        // grants so this run's current demand is reflected, then read our slice.
        // No in-pool guard here — selectGlobalVictim() runs in the scheduler
        // tick so the victim is the LOWEST-priority run's newest agent.
        this.scheduler.recomputeGrants();
        this.instanceCount = this.scheduler.grantFor(this.manifest!.runId);
      } else {
        this.autoScaler.notifyTaskQueued(this.pendingTasks.length);
        // Reservation accounting: report in-flight spawns + young agents so
        // budgetAdditional() charges the RAM they will still grow into.
        const spawnStats = this.spawnStats();
        this.autoScaler.syncReservations(spawnStats.spawning, spawnStats.young);
        // Auto mode drives the concurrency target from memory headroom; greedy
        // (MAX) mode drives it from the queue depth; manual mode keeps the
        // user's pinned value. Both scaler modes recompute every tick.
        const scaleMode = this.autoScaler.getMode();
        if (scaleMode === 'auto' || scaleMode === 'greedy') {
          this.instanceCount = this.autoScaler.targetConcurrency();
        }

        // Graded memory guard (PressureLadder — replaces the single ≥95%
        // trigger that a swapping host never crosses): L1 = usage sustained
        // over the RAM-budget dial (enforced for auto/greedy; a user-pinned
        // manual pool ignores the dial), L2/L3 = host pressure/thrash
        // (avail+swap floors, PSI full, sustained swap-in, legacy ≥95%) —
        // enforced in EVERY mode. Preempt the NEWEST agent — the one with the
        // least work done — so older agents' progress is never lost. Fase 2.3:
        // PAUSE it (preserve worktree + session, requeue to resume on headroom)
        // by default; HUU_NO_PAUSE=1 reverts to the legacy kill+requeue.
        // pauseAgent itself falls back to a kill when no checkpoint is
        // possible, so this never loses the backstop.
        const verdict = this.pressureLadder.evaluate(
          this.autoScaler.metrics(),
          this.autoScaler.budgetBytes(),
        );
        poolPressureLevel = verdict.level;
        const budgetEnforced = scaleMode !== 'manual';
        const poolBusy = this.activeAgents.size + this.spawningIds.size;
        // Spawn freeze: full at L2/L3 (host pressure); at L1/budget only while
        // something is already running — FLOOR OF ONE, or an overshoot caused
        // by OTHER processes (browser/IDE past a low dial) would freeze the
        // run at zero agents forever. 'cpu'-kind L1 defers to the scaler's own
        // per-mode CPU gates (CPU saturation is normal during test stages).
        pressureBlocked =
          verdict.level >= 2 ||
          // Post-storm calm hold: keep admission frozen for a while after the
          // last L2/L3 verdict so the paused herd doesn't resume all at once
          // the instant avg10 dips (it re-spiked within ~15s and re-drained).
          this.pressureLadder.spawnHold() ||
          (verdict.level === 1 && verdict.kind === 'budget' && budgetEnforced && poolBusy > 0);
        const guardFires =
          verdict.level >= 2 ||
          (verdict.level === 1 &&
            (verdict.kind === 'cpu' || (verdict.kind === 'budget' && budgetEnforced)));
        // L1 progress guarantee: budget enforcement never preempts the last
        // live agent — degrade to sequential, never to zero. L2/L3 may drain
        // fully; the pool self-resumes once pressure clears.
        const minSurvivors = verdict.level === 1 ? 1 : 0;
        if (
          guardFires &&
          this.activeAgents.size > minSurvivors &&
          this.pressureLadder.preemptAllowed(verdict.level)
        ) {
          // L3 escape valve, BEFORE the scan: when every live agent is under
          // review the scan below has no candidate at all, so the guard would
          // be silent while the machine thrashes. Dropping the newest critic
          // frees a reserved slot AND makes its worker eligible again on this
          // very tick. See abandonReview.
          if (
            verdict.level >= 3 &&
            this.reviewLockedIds.size > 0 &&
            this.reviewLockedIds.size === this.activeAgents.size
          ) {
            this.abandonReview(verdict.reason);
          }
          let newestId = -1;
          let newestTime = 0;
          for (const [id, _agent] of this.activeAgents) {
            // A review-locked agent is not preemptible (destroyAgent/pauseAgent
            // would refuse anyway) — skip so the guard sheds the next-newest
            // instead of burning the tick.
            if (this.reviewLockedIds.has(id)) continue;
            const status = this.agents.get(id);
            const since = status?.startedAt ?? status?.createdAt;
            if (since && since > newestTime) {
              newestTime = since;
              newestId = id;
            }
          }
          if (newestId >= 0) {
            this.dlog('orch', 'guard_preempt', {
              level: verdict.level,
              reason: verdict.reason,
              agentId: newestId,
            });
            if (this.pauseInsteadOfKill) {
              await this.pauseAgent(newestId, verdict.reason);
            } else {
              await this.destroyAgent(newestId, verdict.reason);
            }
            this.autoScaler.notifyAgentDestroyed();
            this.pressureLadder.notePreempt(verdict.level);
            // Re-evaluation: next poll cycle re-grades the ladder
          }
        }
      }

      // Spawn replacements up to instanceCount, but FAST-RAMP: cap NEW spawns
      // this tick to ≈ +50% of the busy count (min 1) so a single tick can't
      // burst dozens of agents at once — the spike that OOM-killed the process
      // when the whole queue dispatched together. Geometric growth still reaches
      // the target in a few 500 ms ticks, and shouldSpawn() (PSI + budget) is
      // re-checked per spawn. Manual mode (user-pinned pool) fills immediately.
      // Reserved judge/merge agents count as busy: their slot is in the
      // demand-capped grant, so leaving them out would read as a free task
      // slot and spawn past the budget (see task-slots.ts for the invariant).
      const busyCount =
        this.activeAgents.size + this.spawningIds.size + this.reservedAges.size;
      const slotsAvailable = availableTaskSlots(
        this.instanceCount,
        this.activeAgents.size,
        this.spawningIds.size,
        this.reservedAges.size,
      );
      const ramping = this.scheduler != null || this.autoScaler.getMode() !== 'manual';
      const perTickCap = ramping ? Math.max(1, Math.ceil(busyCount * 0.5)) : slotsAvailable;
      const toSpawn = pressureBlocked ? 0 : Math.min(slotsAvailable, perTickCap);
      for (let i = 0; i < toSpawn && this.pendingTasks.length > 0; i++) {
        if (!(this.scheduler ? this.scheduler.shouldSpawn() : this.autoScaler.shouldSpawn())) {
          break;
        }
        // Anti-churn pause backoff: a PAUSED task is only re-pulled after its
        // exponential window since pausedAt elapsed (a resume re-issues the
        // in-flight LLM turn — thrash-cycling it is expensive). findIndex
        // instead of a plain shift lets tasks queued BEHIND a backing-off
        // resume run meanwhile (no head-of-line blocking); on expiry the
        // paused task is index 0 again (pauseAgent unshifts) so resume-first
        // priority returns. `-1` breaks BEFORE dequeuing anything: the task
        // stays in pendingTasks (pool-exit liveness intact) and the 500 ms
        // poll tick re-observes expiry — no wakeup needed, no deadlock when
        // it is the only pending task. Kill-requeues/user retries reset to
        // `pending`, so only genuine pauses are ever delayed.
        const eligibleIdx =
          this.pauseBackoffBaseMs > 0
            ? this.pendingTasks.findIndex(
                (t) =>
                  pauseBackoffRemainingMs(
                    this.agents.get(t.agentId),
                    Date.now(),
                    this.pauseBackoffBaseMs,
                    this.pauseBackoffCapMs,
                    // Anti-herd jitter key: runId de-correlates ACROSS runs (a
                    // multi-run storm pauses every run's "agent 1" in the same
                    // second — same id, same count → same window without this).
                    `${this.manifest?.runId ?? ''}#${t.agentId}`,
                  ) === 0,
              )
            : 0;
        if (eligibleIdx === -1) break;
        const task = this.pendingTasks.splice(eligibleIdx, 1)[0]!;
        // spawnAndRun owns its own try/catches; this outer .catch() is the
        // safety net for an error that escapes ALL of them — typically a
        // synchronous throw before the first await (e.g., an unexpected
        // factory shape, or getGitClient() blowing up). Without bumping
        // completedTasks and clearing every queue here, the pool's poll loop
        // could otherwise see a "ghost" task forever and never exit.
        this.spawnAndRun(task).catch((err) => {
          this.spawningIds.delete(task.agentId);
          this.activeAgents.delete(task.agentId);
          this.finalizingIds.delete(task.agentId);
          this.portAllocator.release(task.agentId);
          this.updateAgentStatus(task.agentId, {
            state: 'error',
            phase: 'error',
            error: err instanceof Error ? err.message : String(err),
            errorKind: 'failed',
          });
          this.completedTasks++;
          this.appendManifestEntry(task.agentId);
          this.poolWakeup?.();
        });
      }

      // Wait with wakeup. Under host pressure (L2+) tick faster so the
      // one-victim-per-tick guard drains a runaway pool in seconds.
      const tickMs = poolPressureLevel >= 2 ? PRESSURE_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, tickMs);
        this.poolWakeup = () => {
          clearTimeout(timer);
          this.poolWakeup = null;
          resolve();
        };
      });
    }
  }

// ─── spawnAndRun ──
  export async function spawnAndRun(this: OrchCtx, task: AgentTask): Promise<void> {
    // In wave (DAG) mode, tasks of SEVERAL steps share one pool — the
    // owning step is resolved from the task itself (names are unique by
    // topology validation). A miss is an internal bug: the throw lands in
    // executeTaskPool's outer .catch safety net and errors the card.
    const step = this.pipeline.steps.find(
      (s): s is PromptStep => !isCheckStep(s) && s.name === task.stageName,
    );
    if (!step) {
      throw new Error(`internal: task ${task.agentId} references unknown step "${task.stageName}"`);
    }
    // Remember the task so a later USER retry can reconstruct it from the
    // agentId alone (the card doesn't carry files[]/hint).
    this.tasksById.set(task.agentId, task);
    const maxRetries = this.pipeline.maxRetries ?? DEFAULT_MAX_RETRIES;
    // MUTABLE on purpose. With DEFAULT_MAX_RETRIES = 1 there are only two
    // attempts, so a single 429 burns the whole retry budget and the card
    // errors — the retry was meant for a bad ANSWER, not for a key that was
    // merely busy. Each successful key ROTATION therefore grants one EXTRA
    // attempt, capped at `keyPool.size() - 1` (a pool of 3 survives two 429s
    // before spending a real retry). Without a pool nothing below changes.
    let totalAttempts = 1 + maxRetries;
    const maxRotationGrants = Math.max(0, (this.keyPool?.size() ?? 1) - 1);
    let rotationGrants = 0;
    // A user retry of a timed-out card may pin a longer per-task timeout.
    const timeoutMs =
      this.retryTimeoutOverrides.get(task.agentId) ?? computeCardTimeoutMs(task, this.pipeline);
    const git = this.worktreeManager!.getGitClient();
    this.dlog('orch', 'spawn_start', {
      agentId: task.agentId,
      files: task.files,
      totalAttempts,
      timeoutMs,
    });

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      // Re-add at the top of every attempt so the pool poll loop never sees
      // the task as "free" between attempts. spawningIds is moved to
      // activeAgents below once the factory succeeds.
      this.spawningIds.add(task.agentId);
      const isRetry = attempt > 1;
      let agent: SpawnedAgent | null = null;
      let attemptBranchName: string | null = null;

      try {
        this.updateAgentStatus(task.agentId, {
          phase: 'worktree_creating',
          attempt,
          // Leaving a stale pausedAt would re-arm the pause backoff against a
          // card that is no longer paused (and the field doc promises the
          // clear-on-resume).
          pausedAt: undefined,
          ...(isRetry ? { error: undefined, errorKind: undefined } : {}),
        });
        const wtStartedAt = Date.now();
        // Fase 2.3 resume: if this task was PAUSED (a restore record exists) and
        // its preserved worktree is still on disk, REUSE it (createAgentWorktree
        // would fail — branch + worktree already exist) and reconstruct the pi
        // session from the checkpoint. Only on the first attempt; a failed
        // resume degrades to a fresh attempt. Reuse-worktree and restore-session
        // go together: if the worktree vanished, drop the record and start
        // fresh (a dangling session in a fresh tree would be inconsistent).
        const canResume =
          attempt === 1 &&
          this.restoreSessionPaths.has(task.agentId) &&
          !!task.worktreePath &&
          !!task.branchName &&
          existsSync(task.worktreePath);
        const restoreSessionPath = canResume
          ? this.restoreSessionPaths.get(task.agentId)
          : undefined;
        this.restoreSessionPaths.delete(task.agentId); // one-shot, both paths
        let wt: { worktreePath: string; branchName: string };
        if (canResume) {
          wt = { worktreePath: task.worktreePath, branchName: task.branchName };
          this.dlog('orch', 'worktree_resumed', {
            agentId: task.agentId,
            path: wt.worktreePath,
            branch: wt.branchName,
          });
        } else {
          wt = await this.worktreeManager!.createAgentWorktree(
            task.agentId,
            this.stageBaseRef,
            attempt,
          );
          this.dlog('orch', 'worktree_ready', {
            agentId: task.agentId,
            attempt,
            durationMs: Date.now() - wtStartedAt,
            path: wt.worktreePath,
            branch: wt.branchName,
          });
        }
        attemptBranchName = wt.branchName;
        // Keep task in sync so the agent prompt header receives the right
        // branch/worktree on retry.
        task.branchName = wt.branchName;
        task.worktreePath = wt.worktreePath;
        this.updateAgentStatus(task.agentId, {
          phase: 'worktree_ready',
          branchName: wt.branchName,
          worktreePath: wt.worktreePath,
          // Record the commit this worktree was cut from, PER AGENT, instead of
          // reading `this.stageBaseRef` later: in wave mode the cursor has
          // moved on by the time the critic diffs `baseRef..HEAD` or finalize
          // asks "is this branch actually ahead?". A resume reuses the ORIGINAL
          // worktree, so it keeps the base it was created from.
          baseRef: canResume
            ? (this.agents.get(task.agentId)?.baseRef ?? this.stageBaseRef)
            : this.stageBaseRef,
        });

        // Allocate the agent's port window and materialize .env.huu + shim in
        // the (fresh) worktree. Allocator is idempotent per agentId, so retries
        // reuse the same window — but the worktree was destroyed and recreated,
        // so the on-disk artefacts must be rewritten on every attempt.
        let portBundle = this.portAllocator.isEnabled()
          ? this.portAllocator.getBundle(task.agentId)
          : undefined;
        if (this.portAllocator.isEnabled()) {
          try {
            if (!portBundle) {
              portBundle = await this.portAllocator.allocate(task.agentId);
            }
            writeAgentEnvFile(wt.worktreePath, portBundle, this.manifest!.runId, this.nativeShim);
            writeAgentBinShim(wt.worktreePath);
          } catch (envErr) {
            // Port isolation is best-effort: a failure here would otherwise
            // abort the whole attempt over what is, for many pipelines, a
            // non-issue (steps that never bind a socket). Log loud and keep
            // going without injection.
            portBundle = undefined;
            this.log({
              level: 'warn',
              message: `agent ${task.agentId} port allocation failed: ${envErr instanceof Error ? envErr.message : String(envErr)}; continuing without per-agent ports`,
              agentId: task.agentId,
            });
          }
        }

        this.updateAgentStatus(task.agentId, { phase: 'session_starting' });
        // Retries and memory-guard requeues reuse the same agentId, so drop any
        // partial line a previous attempt left buffered — otherwise its tail
        // would prepend to this attempt's first streamed line.
        this.streamBuffers.delete(task.agentId);
        const baseStepConfig = step.modelId
          ? { ...this.config, modelId: step.modelId }
          : this.config;
        // The key for THIS attempt. Per-attempt is the granularity the retry
        // loop makes reachable — `stepConfig` is rebuilt inside the loop, so a
        // rotation lands on the very next try. Finer than that (per-agent
        // inside one attempt, or mid-`prompt()`) would need a much larger
        // refactor of `AppConfig.apiKey`, which ~12 modules depend on.
        const attemptKey = this.keyPool?.current();
        const stepConfig = attemptKey
          ? { ...baseStepConfig, apiKey: attemptKey }
          : baseStepConfig;
        const baseCtx = portBundle
          ? { ports: portBundle, shimAvailable: this.nativeShim !== null }
          : undefined;
        // Thread the resume pointer (Fase 2.3) so the pi factory reconstructs
        // the paused session in the reused worktree instead of starting fresh.
        const runtimeCtx =
          restoreSessionPath !== undefined
            ? { ...(baseCtx ?? {}), restoreSessionPath }
            : baseCtx;
        agent = await this.agentFactory(
          task,
          stepConfig,
          this.buildSystemPromptHint(step, task),
          wt.worktreePath,
          (event) => this.handleAgentEvent(task.agentId, event),
          runtimeCtx,
        );
        this.activeAgents.set(task.agentId, agent);
        this.spawningIds.delete(task.agentId);
        this.autoScaler.notifyAgentSpawned();

        const renderedPrompt = this.renderPrompt(step, task);
        this.updateAgentStatus(task.agentId, { state: 'streaming', phase: 'streaming' });

        try {
          await withTimeout(agent.prompt(renderedPrompt), timeoutMs, 'card');
          // Fase 2.3: a concurrent pauseAgent() disposed this agent mid-prompt.
          // If that made prompt() RESOLVE (rather than reject), bail before
          // finalize — pauseAgent already owns the card state + requeue. (The
          // reject case is handled symmetrically in the catch below.)
          if (this.pausedAgentIds.delete(task.agentId)) {
            this.spawningIds.delete(task.agentId);
            return;
          }
          // If agent didn't emit `done`/`error` itself, we treat resolve as done.
          const status = this.agents.get(task.agentId);
          if (status && status.state !== 'done' && status.state !== 'error') {
            this.updateAgentStatus(task.agentId, { state: 'done' });
          }
        } catch (err) {
          // Hard cancel: dispose the (possibly hung) agent and clean up the
          // attempt's worktree+branch before deciding to retry. Move the task
          // back to spawningIds BEFORE the awaits below so the pool's poll
          // loop doesn't observe all queues empty and exit while we're still
          // in flight (would silently drop the retry).
          if (this.killedAgentIds.delete(task.agentId) || this.pausedAgentIds.delete(task.agentId)) {
            // Memory guard killed OR paused this attempt; destroyAgent/pauseAgent
            // already reset the card and requeued the task. Do NOT retry here, do
            // NOT mark as error, do NOT count as completed.
            this.spawningIds.delete(task.agentId);
            return;
          }

          const isTimeout = err instanceof TimeoutError;
          this.dlog('orch', 'attempt_failed', {
            agentId: task.agentId,
            attempt,
            totalAttempts,
            kind: isTimeout ? 'timeout' : 'failed',
            timeoutMs,
            err: err instanceof Error ? err.message : String(err),
          });
          // Key rotation. A provider failure we can classify sidelines the key
          // that produced it and moves the pool on; when it actually rotated,
          // grant an EXTRA attempt so the retry budget is spent on bad answers,
          // not on a busy key (see the rotationGrants declaration).
          if (!isTimeout && attemptKey && this.keyPool) {
            const kind = classifyProviderError(err);
            if (kind !== 'other' && (await this.reportKeyFailure(kind, attemptKey))) {
              if (rotationGrants < maxRotationGrants) {
                rotationGrants++;
                totalAttempts++;
                this.log({
                  level: 'warn',
                  message: `agent ${task.agentId} hit a ${kind} on its API key; rotated and granted an extra attempt (${rotationGrants}/${maxRotationGrants})`,
                  agentId: task.agentId,
                });
              }
            }
          }
          // Balance the notifyAgentSpawned() of this attempt — a retry
          // re-increments when it respawns. Without this the scaler's
          // active count inflates on every retry/final-fail, skewing the
          // observed per-agent memory estimate.
          if (this.activeAgents.delete(task.agentId)) {
            this.autoScaler.notifyAgentCompleted();
          }
          this.spawningIds.add(task.agentId);
          // On timeout, the in-flight HTTP request is still burning tokens
          // until the provider naturally finishes. Tell the SDK to abort
          // before we tear down listeners. Capped at 3s so a stuck SDK
          // can't push the retry decision back indefinitely.
          if (isTimeout) {
            try {
              await withTimeout(agent.abort(), 3_000);
            } catch (abortErr) {
              this.dlog('orch', 'abort_failed', {
                agentId: task.agentId,
                err: abortErr instanceof Error ? abortErr.message : String(abortErr),
              });
            }
          }
          try {
            await agent.dispose();
          } catch {
            /* best effort */
          }
          try {
            await this.worktreeManager!.removeAgentWorktree(task.agentId, attempt);
          } catch {
            /* best effort */
          }
          try {
            await git.deleteBranch(wt.branchName);
          } catch {
            /* best effort */
          }

          if (attempt >= totalAttempts) {
            this.spawningIds.delete(task.agentId);
            this.portAllocator.release(task.agentId);
            this.updateAgentStatus(task.agentId, {
              state: 'error',
              phase: 'error',
              error: err instanceof Error ? err.message : String(err),
              errorKind: isTimeout ? 'timeout' : 'failed',
            });
            // finalizeAgent won't run for final-fail, so bump the progress
            // counters and persist the manifest entry manually.
            this.completedTasks++;
            this.appendManifestEntry(task.agentId);
            this.poolWakeup?.();
            this.announceAgentExit(task.agentId, 'failed');
            return;
          }

          this.log({
            level: 'warn',
            message: `agent ${task.agentId} ${isTimeout ? 'timed out' : 'failed'} on attempt ${attempt}/${totalAttempts}: ${err instanceof Error ? err.message : String(err)}; retrying`,
            agentId: task.agentId,
          });
          this.emit();
          continue;
        }

        // PER-TASK REVIEW (§1). This is the only window where it can run: the
        // agent's session is still alive (so blocking findings go back to the
        // SAME agent, in the same worktree, as one more turn) and the worktree
        // still exists (finalize removes it a few lines below). The agent stays
        // in `activeAgents` throughout, so the pool's liveness accounting is
        // untouched.
        if (isWorkStep(step) && step.review) {
          const outcome = await this.runReviewLoop(task, step.review, agent, timeoutMs);
          if (outcome.preempted) {
            // The memory guard pre-empted the worker mid-review (only reachable
            // once the L3 valve released the lock). destroyAgent/pauseAgent
            // already own the card state and the requeue — mirror the
            // post-prompt bail exactly: no finalize, no error, no count.
            this.spawningIds.delete(task.agentId);
            return;
          }
          if (outcome.blocked) {
            // onBlocked:'hold' — park the card as a RETRIABLE failure so the
            // end-of-walk `awaiting_retry` hold picks it up (interactiveRetry
            // is guaranteed on here: the loop waives without it). The agent
            // session ends (a retry re-runs the TASK, never the session), but
            // the reviewed work is preserved: the branch is moved aside under
            // a `-held` suffix so the retry's fresh attempt can reuse the
            // canonical name, and the worktree is removed like any finished
            // card's. Abandoning the hold merges the `-held` branch with the
            // findings waived (see start()'s post-gate sweep).
            const held = this.agents.get(task.agentId);
            try {
              // Same git-truth re-derivation finalize does for a self-committing
              // agent: the merge filter reads commitSha, and the loop's per-round
              // commits are all null when the agent committed everything itself.
              if (held && !held.commitSha && held.worktreePath) {
                const head = await git.getHead(held.worktreePath);
                this.updateAgentStatus(task.agentId, {
                  commitSha: head,
                  filesModified: unionPaths(held.filesModified, await this.branchChangedFiles(task.agentId)),
                });
              }
              // Write-set instrumentation MUST run before the worktree goes
              // away (the task spec is read from inside it) — same ordering
              // constraint as finalizeAgent.
              await this.recordWriteSetViolations(task.agentId);
              if (held?.branchName) {
                const heldBranch = `${held.branchName}-held`;
                // A previous hold of this same id (a retry that blocked again)
                // owns the suffix — its branch is superseded by the newest one.
                await git.deleteBranch(heldBranch);
                await git.createBranch(heldBranch, held.branchName);
                // Worktree BEFORE the branch delete: `branch -D` refuses a
                // branch still checked out in a worktree.
                await this.worktreeManager!.removeAgentWorktree(task.agentId, attempt);
                await git.deleteBranch(held.branchName);
                this.updateAgentStatus(task.agentId, { branchName: heldBranch });
              }
            } catch (holdErr) {
              // Preservation is best-effort: the card still parks as retriable
              // (a human can always retry from scratch); only the
              // abandon-merges-the-branch half is lost.
              this.log({
                level: 'warn',
                message: `agent ${task.agentId} review-hold branch preservation failed (${holdErr instanceof Error ? holdErr.message : String(holdErr)}) — an abandon will have no branch to merge`,
                agentId: task.agentId,
              });
            }
            this.activeAgents.delete(task.agentId);
            try {
              await agent.dispose();
            } catch {
              /* best effort */
            }
            // Mirror finalizeAgent's finally block (slot/port/counter/exit
            // accounting), with the final-fail path's error card on top.
            this.portAllocator.release(task.agentId);
            this.updateAgentStatus(task.agentId, {
              state: 'error',
              phase: 'error',
              error: 'review round cap reached with blocking findings open — held for a human decision (onBlocked: hold)',
              errorKind: 'failed',
              reviewHeld: true,
            });
            this.completedTasks++;
            this.appendManifestEntry(task.agentId);
            this.autoScaler.notifyAgentCompleted();
            this.announceAgentExit(task.agentId, 'failed');
            this.poolWakeup?.();
            this.emit();
            return;
          }
        }

        // Success path — hand off to finalize BEFORE releasing the active slot.
        // There must be no `await` between decrementing one queue and
        // incrementing the next, or executeTaskPool's poll loop can observe
        // all queues empty and exit while dispose/finalize are still in flight.
        this.finalizingIds.add(task.agentId);
        this.activeAgents.delete(task.agentId);
        try {
          await agent.dispose();
        } catch (disposeErr) {
          this.log({
            level: 'warn',
            message: `agent ${task.agentId} dispose failed: ${disposeErr instanceof Error ? disposeErr.message : String(disposeErr)}`,
          });
        }

        // Track the finalize promise so abort/start can await it (see
        // finalizingPromises field doc). Catch errors that escape
        // finalizeAgent's own try/catch — those should be impossible
        // (the inner catch maps everything to status), but if a future
        // edit slips an unguarded throw past it we want a loud
        // unhandled-rejection in the run log instead of a silent process
        // exit code 1 from Node's default handler.
        const finalizePromise = this.finalizeAgent(task.agentId);
        this.finalizingPromises.add(finalizePromise);
        finalizePromise
          .catch((err) => {
            this.dlog('orch', 'finalize_unhandled', {
              agentId: task.agentId,
              err: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
            this.log({
              level: 'error',
              message: `agent ${task.agentId} finalize unhandled error: ${err instanceof Error ? err.message : String(err)}`,
              agentId: task.agentId,
            });
          })
          .finally(() => {
            this.finalizingIds.delete(task.agentId);
            this.finalizingPromises.delete(finalizePromise);
            this.poolWakeup?.();
          });
        return;
      } catch (err) {
        // Setup failure (worktree creation, agent factory). Treat as a failed
        // attempt — clean up partials and decide retry vs final-fail. Keep
        // task in spawningIds across the cleanup awaits so the pool's poll
        // loop doesn't drop us mid-retry. On final-fail we delete it.
        this.dlog('orch', 'attempt_setup_failed', {
          agentId: task.agentId,
          attempt,
          totalAttempts,
          err: err instanceof Error ? err.message : String(err),
        });
        if (this.activeAgents.delete(task.agentId)) {
          this.autoScaler.notifyAgentCompleted();
        }
        this.spawningIds.add(task.agentId);
        if (agent) {
          try {
            await agent.dispose();
          } catch {
            /* best effort */
          }
        }
        try {
          await this.worktreeManager!.removeAgentWorktree(task.agentId, attempt);
        } catch {
          /* best effort */
        }
        if (attemptBranchName) {
          try {
            await git.deleteBranch(attemptBranchName);
          } catch {
            /* best effort */
          }
        }

        if (attempt >= totalAttempts) {
          this.spawningIds.delete(task.agentId);
          this.portAllocator.release(task.agentId);
          this.updateAgentStatus(task.agentId, {
            state: 'error',
            phase: 'error',
            error: err instanceof Error ? err.message : String(err),
            errorKind: 'failed',
          });
          this.completedTasks++;
          this.appendManifestEntry(task.agentId);
          this.poolWakeup?.();
          this.announceAgentExit(task.agentId, 'failed');
          return;
        }

        this.log({
          level: 'warn',
          message: `agent ${task.agentId} setup failed on attempt ${attempt}/${totalAttempts}: ${err instanceof Error ? err.message : String(err)}; retrying`,
          agentId: task.agentId,
        });
        this.emit();
      }
    }
  }

// ─── getDemand ──
  export function getDemand(this: OrchCtx, ): number {
    return (
      this.activeAgents.size +
      this.spawningIds.size +
      this.pendingTasks.length +
      this.reservedAges.size
    );
  }

// ─── activeAgentAges ──
  export function activeAgentAges(this: OrchCtx, ): Array<{ agentId: number; startedAt: number }> {
    const out: Array<{ agentId: number; startedAt: number }> = [];
    for (const id of this.activeAgents.keys()) {
      if (this.reviewLockedIds.has(id)) continue;
      const st = this.agents.get(id);
      out.push({ agentId: id, startedAt: st?.startedAt ?? st?.createdAt ?? 0 });
    }
    return out;
  }

// ─── abandonReview ──
  export function abandonReview(this: OrchCtx, reason: string): boolean {
    let newestId = -1;
    let newestTime = -1;
    for (const id of this.reviewLockedIds) {
      const st = this.agents.get(id);
      const since = st?.startedAt ?? st?.createdAt ?? 0;
      if (since >= newestTime) {
        newestTime = since;
        newestId = id;
      }
    }
    if (newestId < 0) return false;

    this.reviewLockedIds.delete(newestId);
    this.reviewAborters.get(newestId)?.abort();
    this.updateAgentStatus(newestId, { reviewWaived: true });
    this.log({
      level: 'warn',
      message: `agent ${newestId} review ABANDONED under memory pressure — ${reason}; findings so far are waived and the work still merges`,
      agentId: newestId,
    });
    this.dlog('orch', 'review_abandoned', { agentId: newestId, reason });
    return true;
  }

// ─── spawnStats ──
  export function spawnStats(this: OrchCtx, ): { spawning: number; young: number } {
    const now = Date.now();
    let young = 0;
    for (const id of this.activeAgents.keys()) {
      const st = this.agents.get(id);
      const since = st?.startedAt ?? st?.createdAt ?? 0;
      if (since > 0 && now - since < MATURE_AGE_MS) young++;
    }
    // Reserved judge/merge agents grow into their RAM like any fresh spawn —
    // half-charge them through the same maturation window.
    for (const since of this.reservedAges.values()) {
      if (now - since < MATURE_AGE_MS) young++;
    }
    return { spawning: this.spawningIds.size, young };
  }

// ─── trackReservedAgent ──
  export function trackReservedAgent(this: OrchCtx, ev: 'spawn' | 'exit', agentId: number): void {
    if (ev === 'spawn') this.reservedAges.set(agentId, Date.now());
    else this.reservedAges.delete(agentId);
    this.scheduler?.notifyAgentLifecycle({
      runId: this.manifest?.runId ?? '',
      agentId,
      event: ev,
      reserved: true,
      cause: ev === 'exit' ? 'completed' : undefined,
    });
  }

// ─── announceAgentExit ──
  export function announceAgentExit(this: OrchCtx, agentId: number, cause: string): void {
    this.scheduler?.notifyAgentLifecycle({
      runId: this.manifest?.runId ?? '',
      agentId,
      event: 'exit',
      cause,
    });
  }

// ─── consumePreemptMarker ──
  export function consumePreemptMarker(this: OrchCtx, agentId: number): boolean {
    return this.killedAgentIds.delete(agentId) || this.pausedAgentIds.delete(agentId);
  }

