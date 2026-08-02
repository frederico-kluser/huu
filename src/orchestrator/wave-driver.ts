/** wave-driver.ts — Extracted from orchestrator/index.ts (M7-02). */

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

// ─── runDagWaves ──
  export async function runDagWaves(this: OrchCtx, args: {
    runId: string;
    integration: { worktreePath: string; branchName: string };
    tasksByStepName: Map<string, AgentTask[]>;
    stepIndexByName: Map<string, number>;
    maxNodeExecutions: number;
  }): Promise<void> {
    const { runId, integration, tasksByStepName, stepIndexByName, maxNodeExecutions } = args;
    const steps = this.pipeline.steps;
    const done = new Set<string>();
    const pending = new Set(steps.map((s) => s.name));
    let visitIndex = 0;
    let wave = 0;

    const activate = (target: string): void => {
      if (!stepIndexByName.has(target)) {
        this.log({ level: 'warn', message: `activation target "${target}" is not a step; ignoring` });
        return;
      }
      for (const name of [target, ...descendantsOf(steps, target)]) {
        done.delete(name);
        pending.add(name);
      }
    };

    while (pending.size > 0 && !this.aborted) {
      const ready = computeWave(steps, done, pending);
      if (ready.length === 0) {
        // M3-04: unreachable steps with pending work are a hard error, not a
        // silent 'done'. The old warn + break let the run complete as if
        // nothing was wrong while steps were skipped.
        this.recordRunError(
          `no runnable step remains; ${pending.size} step(s) skipped: ${[...pending].join(', ')}`,
        );
        return;
      }
      if (visitIndex + ready.length > maxNodeExecutions) {
        this.recordRunError(
          `pipeline exceeded maxNodeExecutions=${maxNodeExecutions} — raise pipeline.maxNodeExecutions, or break the activation loop: an outcome/next that keeps re-pending its downstream cone re-runs it every wave (docs/troubleshooting.md#runaway-loop)`,
        );
        return;
      }
      wave += 1;
      this.currentWave = wave;

      const first = ready[0]!;
      if (isCheckStep(first)) {
        const stepIdx = stepIndexByName.get(first.name)!;
        visitIndex += 1;
        const runs = (this.runsByStep.get(first.name) ?? 0) + 1;
        this.runsByStep.set(first.name, runs);
        this.currentStage = visitIndex;
        const traceEntry: ExecutionTraceEntry = {
          visitIndex,
          stepName: first.name,
          stepType: 'check',
          runs,
          startedAt: Date.now(),
        };
        this.executionTrace.push(traceEntry);
        const next = await this.runCheckVisit(
          first, stepIdx, visitIndex, runs, integration, runId, traceEntry,
        );
        pending.delete(first.name);
        done.add(first.name);
        activate(next);
        this.emit();
        continue;
      }

      // Work wave: prepare every ready step, run ONE shared pool, then
      // merge each step sequentially in array order.
      interface WavePrep {
        step: WorkStep;
        stepIdx: number;
        visitIndex: number;
        runs: number;
        tasks: AgentTask[];
        traceEntry: ExecutionTraceEntry;
      }
      const preps: WavePrep[] = [];
      let fatal = false;
      for (const s of ready) {
        const workStep = s as WorkStep;
        const stepIdx = stepIndexByName.get(workStep.name)!;
        visitIndex += 1;
        const runs = (this.runsByStep.get(workStep.name) ?? 0) + 1;
        this.runsByStep.set(workStep.name, runs);
        this.currentStage = visitIndex;
        const traceEntry: ExecutionTraceEntry = {
          visitIndex,
          stepName: workStep.name,
          stepType: 'work',
          runs,
          startedAt: Date.now(),
        };
        this.executionTrace.push(traceEntry);
        let tasks = runs === 1 ? tasksByStepName.get(workStep.name) : undefined;
        if (!tasks) {
          const prep = this.prepareStageTasks(workStep, stepIdx, runId);
          if (prep.fatal) {
            fatal = true;
            break;
          }
          tasks = prep.tasks as AgentTask[];
        }
        this.stageIntegrations.push({
          visitIndex,
          stepIndex: stepIdx,
          stageName: workStep.name,
          runs,
          phase: 'pending',
          modelId: this.pipeline.integrationModelId ?? this.config.modelId,
          resolverUsed: false,
          branchesMerged: [],
          branchesPending: [],
          conflicts: [],
        });
        preps.push({ step: workStep, stepIdx, visitIndex, runs, tasks, traceEntry });
      }
      if (fatal) return;

      const union = preps.flatMap((p) => p.tasks);
      this.log({
        level: 'info',
        message: `=== wave ${wave}: ${preps.map((p) => `"${p.step.name}"`).join(' + ')} — ${union.length} task(s), one pool`,
      });
      this.emit();

      await this.executeTaskPool(union);
      if (this.aborted) return;

      for (const p of preps) {
        const ok = await this.mergeStepVisit(
          p.step, p.visitIndex, p.runs, p.tasks, integration, p.traceEntry,
        );
        if (!ok) return;
        pending.delete(p.step.name);
        done.add(p.step.name);
        if (p.step.next !== undefined) {
          // In DAG mode `next` is an activation edge (loops), never a skip.
          activate(p.step.next);
        }
      }
      this.emit();
    }
  }

