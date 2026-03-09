import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import { AuditLogRepository } from '../../db/repositories/audit-log.js';
import { MergeQueueRepository } from '../../db/repositories/merge-queue.js';
import { MergeResultsRepository } from '../../db/repositories/merge-results.js';
import { WorktreeManager } from '../../git/WorktreeManager.js';
import { MergeManager } from '../../git/MergeManager.js';
import { detectDefaultBranch } from '../../git/default-branch.js';
import { spawnAgent } from '../../agents/runtime.js';
import { createDefaultRegistry } from '../../agents/tools.js';
import { builderAgent } from '../../agents/definitions/builder.js';
import type { AgentRunResult } from '../../agents/types.js';
import type { MergeExecutionResult } from '../../git/MergeManager.js';
import { renderRunScreen } from '../render.js';
import type { RunScreenController } from '../render.js';
import { huuDirExists, getDbPath, getHuuDir, createDefaultConfig, writeConfigAtomic, configExists } from '../config.js';
import { initAction } from './init.js';

// ── Constants ────────────────────────────────────────────────────────

const DB_PATH = '.huu/huu.db';
const PROJECT_ID = 'default';

// ── Auto-init ───────────────────────────────────────────────────────

async function ensureInitialized(cwd: string): Promise<void> {
  if (!huuDirExists(cwd)) {
    // Auto-initialize silently
    await initAction({ yes: true });
  } else if (!configExists(cwd)) {
    // Directory exists but no config — write defaults
    const config = createDefaultConfig();
    writeConfigAtomic(cwd, config);
  }
}

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
 * Execute the single-agent loop end-to-end with Ink UI:
 * 1. Auto-init if needed
 * 2. Open DB + migrate
 * 3. Spawn builder agent (worktree -> implement -> commit)
 * 4. If agent produced a commit, enqueue + execute merge
 * 5. Report result via TUI
 */
export async function runSingleAgentTask(
  options: RunSingleAgentOptions,
): Promise<RunSingleAgentResult> {
  const cwd = options.cwd ?? process.cwd();
  const dbPath = options.dbPath ?? path.join(cwd, DB_PATH);
  const taskId = crypto.randomUUID();

  // Render the run screen
  const ui = renderRunScreen(options.taskDescription);

  try {
    // 0. Auto-init
    ui.setPhase('preparing');
    ui.addLog({ message: 'Checking project initialization...', level: 'step' });
    await ensureInitialized(cwd);
    ui.addLog({ message: 'Project ready', level: 'success' });

    // 1. Initialize infrastructure
    ui.setPhase('initializing');
    ui.addLog({ message: 'Opening database...', level: 'step' });

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

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

      const defaultBranch = await detectDefaultBranch(worktreeManager.getRootGit());
      ui.addLog({
        message: `Infrastructure ready (branch: ${defaultBranch})`,
        level: 'success',
      });

      // 2. Spawn builder agent
      ui.setPhase('spawning');
      ui.addLog({
        message: `Spawning builder agent for task [${taskId.slice(0, 8)}]`,
        level: 'info',
      });

      const agentResult = await spawnAgent(
        {
          agent: builderAgent,
          taskId,
          taskPrompt: options.taskDescription,
          projectId: PROJECT_ID,
          baseBranch: defaultBranch,
          keepWorktree: false,
        },
        {
          worktreeManager,
          queue,
          auditLog,
          toolRegistry,
        },
      );

      runId = agentResult.runId;
      ui.setPhase('running');
      ui.addLog({
        message: `Agent finished: ${agentResult.status}`,
        level: agentResult.status === 'completed' ? 'success' : 'warn',
      });

      if (agentResult.status === 'failed' || agentResult.status === 'aborted') {
        ui.setError(`Agent ${agentResult.status}: ${agentResult.error ?? 'unknown error'}`);
        ui.setMetrics({
          runId,
          agentName: agentResult.agentName,
          filesChanged: agentResult.filesChanged,
          inputTokens: agentResult.usage.inputTokens,
          outputTokens: agentResult.usage.outputTokens,
          turns: agentResult.usage.turns,
          durationMs: agentResult.durationMs,
          commitSha: agentResult.commitSha,
          mergeOutcome: null,
          mergeTier: null,
        });
        await ui.waitUntilExit();
        return {
          ok: false,
          runId,
          agentResult,
          mergeResult: null,
          error: agentResult.error,
        };
      }

      ui.addLog({
        message: `Files changed: ${agentResult.filesChanged.length}`,
        level: 'step',
      });
      ui.addLog({
        message: `Tokens: ${agentResult.usage.inputTokens} in + ${agentResult.usage.outputTokens} out (${agentResult.usage.turns} turns)`,
        level: 'step',
      });

      // 3. Merge if agent produced a commit
      if (!agentResult.commitSha) {
        ui.addLog({
          message: 'Agent completed but produced no commit — skipping merge',
          level: 'warn',
        });
        ui.setPhase('done');
        ui.setMetrics({
          runId,
          agentName: agentResult.agentName,
          filesChanged: agentResult.filesChanged,
          inputTokens: agentResult.usage.inputTokens,
          outputTokens: agentResult.usage.outputTokens,
          turns: agentResult.usage.turns,
          durationMs: agentResult.durationMs,
          commitSha: null,
          mergeOutcome: null,
          mergeTier: null,
        });
        await ui.waitUntilExit();
        return {
          ok: true,
          runId,
          agentResult,
          mergeResult: null,
        };
      }

      ui.setPhase('merging');
      ui.addLog({ message: 'Enqueueing merge request...', level: 'step' });

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
        target_branch: defaultBranch,
        request_id: `run-${runId}`,
      });

      ui.addLog({ message: 'Processing merge...', level: 'step' });
      const mergeResult = await mergeManager.processNext();

      if (!mergeResult) {
        ui.setError('Merge queue unexpectedly empty');
        await ui.waitUntilExit();
        return {
          ok: false,
          runId,
          agentResult,
          mergeResult: null,
          error: 'Merge queue unexpectedly empty after enqueue',
        };
      }

      if (mergeResult.outcome === 'merged') {
        ui.addLog({
          message: `Merge complete (${mergeResult.tier}, ${mergeResult.mode ?? 'unknown'})`,
          level: 'success',
        });
      } else if (mergeResult.outcome === 'conflict') {
        ui.addLog({
          message: `Merge conflict: ${mergeResult.conflicts.join(', ')}`,
          level: 'warn',
        });
      } else {
        ui.addLog({
          message: `Merge failed: ${mergeResult.errorMessage ?? 'unknown'}`,
          level: 'error',
        });
      }

      // 4. Done
      const ok = mergeResult.outcome === 'merged';
      ui.setPhase(ok ? 'done' : 'failed');
      ui.setMetrics({
        runId,
        agentName: agentResult.agentName,
        filesChanged: agentResult.filesChanged,
        inputTokens: agentResult.usage.inputTokens,
        outputTokens: agentResult.usage.outputTokens,
        turns: agentResult.usage.turns,
        durationMs: agentResult.durationMs,
        commitSha: agentResult.commitSha,
        mergeOutcome: mergeResult.outcome,
        mergeTier: mergeResult.tier,
      });

      await ui.waitUntilExit();

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ui.setError(message);
    await ui.waitUntilExit();
    return {
      ok: false,
      runId: '',
      agentResult: null,
      mergeResult: null,
      error: message,
    };
  }
}

// ── CLI action ───────────────────────────────────────────────────────

export async function runAction(taskDescription: string): Promise<void> {
  const result = await runSingleAgentTask({ taskDescription });

  if (result.ok) {
    process.exitCode = 0;
  } else {
    process.exitCode = 1;
  }
}
