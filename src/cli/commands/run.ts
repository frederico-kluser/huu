import crypto from 'node:crypto';
import path from 'node:path';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import { AuditLogRepository } from '../../db/repositories/audit-log.js';
import { MergeQueueRepository } from '../../db/repositories/merge-queue.js';
import { MergeResultsRepository } from '../../db/repositories/merge-results.js';
import { WorktreeManager } from '../../git/WorktreeManager.js';
import { MergeManager } from '../../git/MergeManager.js';
import { spawnAgent } from '../../agents/runtime.js';
import { createDefaultRegistry } from '../../agents/tools.js';
import { builderAgent } from '../../agents/definitions/builder.js';
import type { AgentRunResult } from '../../agents/types.js';
import type { MergeExecutionResult } from '../../git/MergeManager.js';
import {
  printInfo,
  printSuccess,
  printWarn,
  printError,
  printEvent,
  printStep,
  printHeader,
  printKeyValue,
  printDivider,
} from '../output.js';

// ── Constants ────────────────────────────────────────────────────────

const DB_PATH = '.huu/huu.db';
const PROJECT_ID = 'default';

// ── Public API ───────────────────────────────────────────────────────

export interface RunSingleAgentOptions {
  taskDescription: string;
  cwd?: string | undefined;
  dbPath?: string | undefined;
}

export interface RunSingleAgentResult {
  ok: boolean;
  runId: string;
  agentResult: AgentRunResult | null;
  mergeResult: MergeExecutionResult | null;
  error?: string | undefined;
}

/**
 * Execute the single-agent loop end-to-end:
 * 1. Open DB + migrate
 * 2. Spawn builder agent (worktree → implement → commit)
 * 3. If agent produced a commit, enqueue + execute merge
 * 4. Report result
 */
export async function runSingleAgentTask(
  options: RunSingleAgentOptions,
): Promise<RunSingleAgentResult> {
  const cwd = options.cwd ?? process.cwd();
  const dbPath = options.dbPath ?? path.join(cwd, DB_PATH);
  const taskId = crypto.randomUUID();

  printHeader('HUU — Single Agent Run');

  // 1. Initialize infrastructure
  printStep('Initializing database and infrastructure');

  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = openDatabase(dbPath);
  let runId = '';

  try {
    migrate(db);

    const queue = new MessageQueue(db);
    const auditLog = new AuditLogRepository(db);
    const toolRegistry = createDefaultRegistry();
    const worktreeManager = new WorktreeManager(cwd);
    const mergeQueueRepo = new MergeQueueRepository(db);
    const mergeResultsRepo = new MergeResultsRepository(db);

    printSuccess('Infrastructure ready');

    // 2. Spawn builder agent
    printEvent('agent', `Spawning builder agent for task`, taskId.slice(0, 8));
    printStep(`Task: "${options.taskDescription}"`);

    const agentResult = await spawnAgent(
      {
        agent: builderAgent,
        taskId,
        taskPrompt: options.taskDescription,
        projectId: PROJECT_ID,
        baseBranch: 'main',
        keepWorktree: false, // branch is preserved for merge
      },
      {
        worktreeManager,
        queue,
        auditLog,
        toolRegistry,
      },
    );

    runId = agentResult.runId;

    printEvent('agent', `Agent finished: ${agentResult.status}`, runId);

    if (agentResult.status === 'failed' || agentResult.status === 'aborted') {
      printError(
        `Agent ${agentResult.status}: ${agentResult.error ?? 'unknown error'}`,
        runId,
      );
      return {
        ok: false,
        runId,
        agentResult,
        mergeResult: null,
        error: agentResult.error,
      };
    }

    // Report agent results
    printStep(`Files changed: ${agentResult.filesChanged.length}`, runId);
    if (agentResult.filesChanged.length > 0) {
      for (const f of agentResult.filesChanged.slice(0, 10)) {
        printStep(`  ${f}`, runId);
      }
      if (agentResult.filesChanged.length > 10) {
        printStep(
          `  ... and ${agentResult.filesChanged.length - 10} more`,
          runId,
        );
      }
    }

    printStep(
      `Usage: ${agentResult.usage.inputTokens} input + ${agentResult.usage.outputTokens} output tokens, ${agentResult.usage.turns} turns`,
      runId,
    );

    // 3. Merge if agent produced a commit
    if (!agentResult.commitSha) {
      printWarn('Agent completed but produced no commit — skipping merge', runId);
      return {
        ok: true,
        runId,
        agentResult,
        mergeResult: null,
      };
    }

    printEvent('merge', 'Enqueueing merge request', runId);

    const sourceBranch = `huu-agent/${runId}`;
    const mergeManager = new MergeManager(
      worktreeManager.getRootGit(),
      mergeQueueRepo,
      mergeResultsRepo,
      { workerId: 'cli', repoPath: cwd },
    );

    mergeManager.enqueue({
      source_branch: sourceBranch,
      source_head_sha: agentResult.commitSha,
      target_branch: 'main',
      request_id: `run-${runId}`,
    });

    printEvent('merge', 'Processing merge', runId);
    const mergeResult = await mergeManager.processNext();

    if (!mergeResult) {
      printError('Merge queue unexpectedly empty', runId);
      return {
        ok: false,
        runId,
        agentResult,
        mergeResult: null,
        error: 'Merge queue unexpectedly empty after enqueue',
      };
    }

    if (mergeResult.outcome === 'merged') {
      printSuccess(
        `Merge complete (${mergeResult.tier}, ${mergeResult.mode ?? 'unknown'})`,
        runId,
      );
    } else if (mergeResult.outcome === 'conflict') {
      printWarn(
        `Merge conflict detected: ${mergeResult.conflicts.join(', ')}`,
        runId,
      );
    } else {
      printError(
        `Merge failed: ${mergeResult.errorMessage ?? 'unknown'}`,
        runId,
      );
    }

    // 4. Summary
    printDivider();
    printHeader('Run Summary');
    printKeyValue('Run ID', runId);
    printKeyValue('Task', options.taskDescription);
    printKeyValue('Agent', `${agentResult.agentName} (${agentResult.status})`);
    printKeyValue('Commit', agentResult.commitSha ?? 'none');
    printKeyValue('Merge', mergeResult.outcome);
    printKeyValue('Duration', `${agentResult.durationMs}ms`);
    printDivider();

    const ok = mergeResult.outcome === 'merged';
    return {
      ok,
      runId,
      agentResult,
      mergeResult,
      error: ok ? undefined : mergeResult.errorMessage ?? undefined,
    };
  } finally {
    db.close();
  }
}

// ── CLI action ───────────────────────────────────────────────────────

export async function runAction(taskDescription: string): Promise<void> {
  const result = await runSingleAgentTask({ taskDescription });

  if (result.ok) {
    printSuccess(`Run ${result.runId.slice(0, 8)} completed successfully`);
    process.exitCode = 0;
  } else {
    printError(`Run ${result.runId.slice(0, 8) || 'unknown'} failed: ${result.error ?? 'unknown error'}`);
    process.exitCode = 1;
  }
}
