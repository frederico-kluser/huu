import crypto from 'node:crypto';
import type OpenAI from 'openai';
import type { WorktreeManager } from '../git/WorktreeManager.js';
import { detectDefaultBranch } from '../git/default-branch.js';
import type { MessageQueue } from '../db/queue.js';
import type { AuditLogRepository } from '../db/repositories/audit-log.js';
import type { AgentRunInput, AgentRunResult, FileChangeSummary, RunState, RunUsage } from './types.js';
import { resolveAgentModelId, validateAgentDefinition } from './types.js';
import { prepareContext } from './context.js';
import type { ToolRegistry } from './tools.js';
import {
  createOpenRouterClient,
  chatCompletion,
} from '../models/openrouter.js';
import type { ChatMessage, ToolDefinition, ToolCall } from '../models/openrouter.js';
import { findModelById } from '../models/catalog.js';
import {
  getFileChangesFromCommit,
  getFileChangesFromWorkingTree,
  emptyFileChangeSummary,
  flattenChangedFiles,
} from './file-changes.js';
import {
  createRunAbortController,
  composeRunSignal,
  cleanupRunController,
} from './abort.js';

// ── Runtime dependencies ─────────────────────────────────────────────

export interface RuntimeDeps {
  worktreeManager: WorktreeManager;
  queue: MessageQueue;
  auditLog: AuditLogRepository;
  toolRegistry: ToolRegistry;
  client?: OpenAI | undefined;
}

// ── Internal run context ─────────────────────────────────────────────

interface RunContext {
  runId: string;
  input: AgentRunInput;
  deps: RuntimeDeps;
  cwd: string;
  signal: AbortSignal;
  client: OpenAI;
  state: RunState;
  startTime: number;
}

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TOKENS = 8192;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Spawn and run a single agent through its complete lifecycle:
 * spawn -> inject context -> execute -> collect -> cleanup
 */
export async function spawnAgent(
  input: AgentRunInput,
  deps: RuntimeDeps,
): Promise<AgentRunResult> {
  validateAgentDefinition(input.agent);

  const runId = crypto.randomUUID();
  const startTime = Date.now();

  const controller = createRunAbortController(runId);
  const signal = composeRunSignal({
    userSignal: controller.signal,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    parentSignal: input.parentSignal,
  });

  let worktreePath: string | undefined;

  try {
    // Publish start event
    publishRunEvent(deps, input, runId, 'task_progress', {
      state: 'spawning' satisfies RunState,
      message: `Agent "${input.agent.name}" starting`,
    });

    // Create isolated worktree
    const baseBranch = input.baseBranch
      ?? await detectDefaultBranch(deps.worktreeManager.getRootGit());
    const worktree = await deps.worktreeManager.create(
      runId,
      baseBranch,
    );
    worktreePath = worktree.path;

    // Create or reuse OpenRouter client
    const client = deps.client ?? createOpenRouterClient();

    const ctx: RunContext = {
      runId,
      input,
      deps,
      cwd: worktreePath,
      signal,
      client,
      state: 'spawning',
      startTime,
    };

    return await runAgentLifecycle(ctx);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const aborted = isAbortError(err);
    const status = aborted ? 'aborted' : 'failed';
    const errorMsg = err instanceof Error ? err.message : String(err);

    publishRunEvent(
      deps,
      input,
      runId,
      aborted ? 'abort_ack' : 'escalation',
      { state: status, error: errorMsg, durationMs },
    );

    return {
      runId,
      taskId: input.taskId,
      agentName: input.agent.name,
      status,
      summary: '',
      artifacts: [],
      filesChanged: [],
      fileChangeSummary: emptyFileChangeSummary(),
      commitSha: null,
      usage: { inputTokens: 0, outputTokens: 0, totalCost: 0, turns: 0 },
      durationMs,
      error: errorMsg,
    };
  } finally {
    if (!input.keepWorktree) {
      await safeCleanupRun(runId, worktreePath, deps);
    }
    cleanupRunController(runId);
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────

async function runAgentLifecycle(ctx: RunContext): Promise<AgentRunResult> {
  // Prepare context
  ctx.state = 'context_ready';
  const prepared = prepareContext({
    agent: ctx.input.agent,
    taskPrompt: ctx.input.taskPrompt,
    cwd: ctx.cwd,
  });

  publishRunEvent(ctx.deps, ctx.input, ctx.runId, 'task_progress', {
    state: 'context_ready' satisfies RunState,
    tokensEstimate: prepared.metadata.tokensEstimate,
  });

  // Execute tool use loop
  ctx.state = 'running';
  const { finalContent, usage } = await executeToolUseLoop(ctx, prepared);

  // Collect results
  ctx.state = 'collecting';
  const durationMs = Date.now() - ctx.startTime;
  const summary = finalContent;
  const { fileChangeSummary, commitSha } = await collectChanges(ctx);
  const filesChanged = flattenChangedFiles(fileChangeSummary);

  const result: AgentRunResult = {
    runId: ctx.runId,
    taskId: ctx.input.taskId,
    agentName: ctx.input.agent.name,
    status: 'completed',
    summary,
    artifacts: [],
    filesChanged,
    fileChangeSummary,
    commitSha,
    usage,
    durationMs,
  };

  publishRunEvent(ctx.deps, ctx.input, ctx.runId, 'task_done', {
    state: 'completed' satisfies RunState,
    summary,
    commitSha,
    changed_files: fileChangeSummary,
    filesChanged,
    usage,
    durationMs,
  });

  return result;
}

// ── Tool use loop ────────────────────────────────────────────────────

async function executeToolUseLoop(
  ctx: RunContext,
  prepared: ReturnType<typeof prepareContext>,
): Promise<{ finalContent: string; usage: RunUsage }> {
  const model = resolveAgentModelId(ctx.input.agent);
  const registryTools = ctx.deps.toolRegistry.getToolsForAgent(ctx.input.agent);
  const maxTurns = ctx.input.agent.maxTurns ?? DEFAULT_MAX_TURNS;

  // Convert registry tools to OpenAI-style tool definitions
  const tools: ToolDefinition[] = registryTools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as unknown as Record<string, unknown>,
    },
  }));

  // Build initial messages in OpenAI format
  const messages: ChatMessage[] = [
    { role: 'system', content: prepared.system },
    ...prepared.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
  ];

  // Look up model pricing for cost calculation
  const modelEntry = findModelById(model);
  const inputCostPerToken = modelEntry ? modelEntry.pricing.input / 1_000_000 : 0;
  const outputCostPerToken = modelEntry ? modelEntry.pricing.output / 1_000_000 : 0;

  const totalUsage: RunUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
    turns: 0,
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (ctx.signal.aborted) {
      throw new DOMException('Agent execution aborted', 'AbortError');
    }

    totalUsage.turns = turn + 1;

    const chatParams: Parameters<typeof chatCompletion>[1] = {
      model,
      messages,
      maxTokens: MAX_TOKENS,
      signal: ctx.signal,
    };
    if (tools.length > 0) {
      chatParams.tools = tools;
    }
    const response = await chatCompletion(ctx.client, chatParams);

    totalUsage.inputTokens += response.usage.promptTokens;
    totalUsage.outputTokens += response.usage.completionTokens;
    totalUsage.totalCost =
      totalUsage.inputTokens * inputCostPerToken +
      totalUsage.outputTokens * outputCostPerToken;

    publishRunEvent(ctx.deps, ctx.input, ctx.runId, 'task_progress', {
      state: 'running' satisfies RunState,
      turn: turn + 1,
      stopReason: response.finishReason,
      inputTokens: totalUsage.inputTokens,
      outputTokens: totalUsage.outputTokens,
      totalCost: totalUsage.totalCost,
    });

    // No more tool calls — done
    if (response.toolCalls.length === 0 || response.finishReason === 'stop') {
      return { finalContent: response.content ?? '', usage: totalUsage };
    }

    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.toolCalls,
    });

    // Process tool calls
    for (const toolCall of response.toolCalls) {
      const startMs = Date.now();

      let toolInput: Record<string, unknown>;
      try {
        toolInput = JSON.parse(toolCall.function.arguments);
      } catch {
        toolInput = {};
      }

      const result = await ctx.deps.toolRegistry.execute(
        toolCall.function.name,
        toolInput,
        {
          runId: ctx.runId,
          cwd: ctx.cwd,
          signal: ctx.signal,
          agent: ctx.input.agent,
        },
      );

      const durationMs = Date.now() - startMs;

      const auditParams: Parameters<typeof ctx.deps.auditLog.append>[0] = {
        project_id: ctx.input.projectId,
        agent_id: ctx.input.agent.name,
        tool_name: toolCall.function.name,
        params_json: JSON.stringify(toolInput),
        result_json: JSON.stringify(result.content),
        result_status: result.isError ? 'error' : 'success',
        duration_ms: durationMs,
      };
      if (result.isError) {
        auditParams.error_text = result.content;
      }
      ctx.deps.auditLog.append(auditParams);

      // Add tool result message
      messages.push({
        role: 'tool',
        content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
        tool_call_id: toolCall.id,
      });
    }
  }

  throw new Error(
    `Agent "${ctx.input.agent.name}" exhausted ${maxTurns} turns without completing`,
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

async function collectChanges(
  ctx: RunContext,
): Promise<{ fileChangeSummary: FileChangeSummary; commitSha: string | null }> {
  try {
    const git = await ctx.deps.worktreeManager.getGit(ctx.runId);

    // Try to get the latest commit SHA
    let commitSha: string | null = null;
    try {
      const log = await git.log({ maxCount: 1 });
      commitSha = log.latest?.hash ?? null;
    } catch {
      // No commits yet or error
    }

    // If we have a commit, get changes from it; otherwise fall back to working tree
    let fileChangeSummary: FileChangeSummary;
    if (commitSha) {
      fileChangeSummary = await getFileChangesFromCommit(git, commitSha);
    } else {
      fileChangeSummary = await getFileChangesFromWorkingTree(git);
    }

    return { fileChangeSummary, commitSha };
  } catch {
    return { fileChangeSummary: emptyFileChangeSummary(), commitSha: null };
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function publishRunEvent(
  deps: RuntimeDeps,
  input: AgentRunInput,
  runId: string,
  messageType: 'task_progress' | 'task_done' | 'escalation' | 'abort_ack',
  payload: Record<string, unknown>,
): void {
  try {
    deps.queue.enqueue({
      project_id: input.projectId,
      message_type: messageType,
      sender_agent: input.agent.name,
      recipient_agent: 'orchestrator',
      run_id: runId,
      correlation_id: input.taskId,
      payload,
    });
  } catch {
    // Non-critical: don't let event publishing crash the run
  }
}

async function safeCleanupRun(
  runId: string,
  worktreePath: string | undefined,
  deps: RuntimeDeps,
): Promise<void> {
  if (!worktreePath) return;
  try {
    await deps.worktreeManager.remove(runId, {
      force: true,
      deleteBranch: false, // preserve branch for merge
    });
  } catch {
    // Idempotent: don't throw on cleanup failure
  }
}
