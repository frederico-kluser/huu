/**
 * Drive the `Orchestrator` to completion without Ink/React. Powers the
 * `huu auto <pipeline> --config <config>` subcommand. The TUI app in
 * `src/app.tsx` is the interactive counterpart; this module is the
 * scriptable one — same orchestrator, no keyboard.
 *
 * Output discipline:
 * - stderr: line-delimited JSON progress events (NDJSON), one per line,
 *   throttled to ~250 ms so a piped consumer doesn't drown.
 * - stdout: ONE final JSON object on success or failure. Reserved for
 *   tooling that pipes `huu auto ... | jq .runId`.
 *
 * Exit code: 0 on `manifest.status === 'done'`, 1 otherwise.
 */

import type { AppConfig, OrchestratorState, Pipeline } from './types.js';
import type { AgentFactory } from '../orchestrator/types.js';
import { Orchestrator } from '../orchestrator/index.js';

export interface RunHeadlessArgs {
  pipeline: Pipeline;
  config: AppConfig;
  cwd: string;
  agentFactory: AgentFactory;
  conflictResolverFactory?: AgentFactory;
  /** Initial worker concurrency (forwarded to Orchestrator). */
  concurrency?: number;
  /** Throttle interval for NDJSON state events. Default 250 ms. */
  emitIntervalMs?: number;
}

export async function runHeadless(args: RunHeadlessArgs): Promise<number> {
  const {
    pipeline,
    config,
    cwd,
    agentFactory,
    conflictResolverFactory,
    concurrency,
    emitIntervalMs = 250,
  } = args;

  const orch = new Orchestrator(config, pipeline, cwd, agentFactory, {
    initialConcurrency: concurrency,
    conflictResolverFactory,
  });

  // Throttled state mirror — without this, the orchestrator's emit
  // fires hundreds of times per second under load and floods stderr.
  let pendingState: OrchestratorState | null = null;
  let lastEmitAt = 0;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;

  const writeEvent = (obj: Record<string, unknown>): void => {
    process.stderr.write(JSON.stringify(obj) + '\n');
  };

  const flush = (): void => {
    if (!pendingState) return;
    const s = pendingState;
    pendingState = null;
    lastEmitAt = Date.now();
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    writeEvent({
      type: 'state',
      status: s.status,
      stage: `${s.currentStage}/${s.totalStages}`,
      tasks: `${s.completedTasks}/${s.totalTasks}`,
      activeAgents: s.activeAgentCount,
      pendingTasks: s.pendingTaskCount,
      elapsedMs: s.elapsedMs,
      cost: Number(s.totalCost.toFixed(6)),
    });
  };

  orch.subscribe((state) => {
    pendingState = state;
    const since = Date.now() - lastEmitAt;
    if (since >= emitIntervalMs) {
      flush();
    } else if (!emitTimer) {
      emitTimer = setTimeout(flush, emitIntervalMs - since);
    }
  });

  const startedAt = Date.now();
  try {
    const result = await orch.start();
    flush();
    const ok = result.manifest.status === 'done';
    process.stdout.write(
      JSON.stringify(
        {
          ok,
          runId: result.runId,
          integrationBranch: result.manifest.integrationBranch,
          baseCommit: result.manifest.baseCommit,
          status: result.manifest.status,
          totalCost: Number(result.totalCost.toFixed(6)),
          durationMs: result.duration,
          filesModified: result.filesModified,
          conflicts: result.conflicts,
          agents: result.agents.map((a) => ({
            agentId: a.agentId,
            state: a.state,
            branchName: a.branchName,
            commitSha: a.commitSha,
            tokensIn: a.tokensIn,
            tokensOut: a.tokensOut,
            cost: a.cost,
            filesModified: a.filesModified,
            error: a.error,
          })),
        },
        null,
        2,
      ) + '\n',
    );
    return ok ? 0 : 1;
  } catch (err) {
    flush();
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          error: message,
          durationMs: Date.now() - startedAt,
        },
        null,
        2,
      ) + '\n',
    );
    return 1;
  }
}
