import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type Anthropic from '@anthropic-ai/sdk';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import { MessageQueue } from '../../db/queue.js';
import { AuditLogRepository } from '../../db/repositories/audit-log.js';
import type { WorktreeManager } from '../../git/WorktreeManager.js';
import { spawnAgent } from '../runtime.js';
import type { RuntimeDeps } from '../runtime.js';
import { createDefaultRegistry } from '../tools.js';
import { builderAgent, BUILDER_SYSTEM_PROMPT } from '../definitions/builder.js';
import { validateAgentDefinition } from '../types.js';
import type { AgentRunInput } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function builderInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    agent: builderAgent,
    taskId: 'task-builder-1',
    taskPrompt: 'Add function sum(a, b) that returns a + b in src/math.ts',
    projectId: 'test-project',
    ...overrides,
  };
}

function makeMessage(
  overrides: Partial<{
    stop_reason: string;
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: unknown;
    }>;
    usage: { input_tokens: number; output_tokens: number };
  }> = {},
) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Done! Created sum function.' }],
    usage: { input_tokens: 200, output_tokens: 100 },
    ...overrides,
  };
}

function createMockWorktreeManager(): WorktreeManager {
  return {
    create: vi.fn().mockResolvedValue({
      agentId: 'mock-agent',
      path: '/tmp/mock-worktree',
      branch: 'huu-agent/mock-agent',
      detached: false,
      locked: true,
      prunable: false,
      bare: false,
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    getGit: vi.fn().mockResolvedValue({
      status: vi.fn().mockResolvedValue({
        created: ['src/math.ts'],
        modified: [],
        deleted: [],
        renamed: [],
      }),
      log: vi.fn().mockResolvedValue({
        latest: { hash: 'abc1234def5678' },
      }),
      raw: vi.fn().mockResolvedValue(
        'A\0src/math.ts\0',
      ),
    }),
    list: vi.fn().mockResolvedValue([]),
    branchNameFor: vi.fn((id: string) => `huu-agent/${id}`),
    worktreePathFor: vi.fn((id: string) => `/tmp/.huu-worktrees/${id}`),
  } as unknown as WorktreeManager;
}

function createMockClient(
  responses: ReturnType<typeof makeMessage>[],
): Anthropic {
  let callIndex = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const response = responses[callIndex];
        if (!response) throw new Error('No more mock responses');
        callIndex++;
        return response;
      }),
    },
  } as unknown as Anthropic;
}

// ── Builder definition tests ─────────────────────────────────────────

describe('builderAgent definition', () => {
  it('passes validation', () => {
    expect(() => validateAgentDefinition(builderAgent)).not.toThrow();
  });

  it('uses sonnet model', () => {
    expect(builderAgent.model).toBe('sonnet');
  });

  it('has implementation role', () => {
    expect(builderAgent.role).toBe('implementation');
  });

  it('has exactly 4 tools: read_file, write_file, list_files, bash', () => {
    expect(builderAgent.tools).toEqual([
      'read_file',
      'write_file',
      'list_files',
      'bash',
    ]);
    expect(builderAgent.tools).toHaveLength(4);
  });

  it('has no disallowed tools', () => {
    expect(builderAgent.disallowedTools).toBeUndefined();
  });

  it('system prompt includes role, constraints, execution flow, and done contract', () => {
    expect(BUILDER_SYSTEM_PROMPT).toContain('<role>');
    expect(BUILDER_SYSTEM_PROMPT).toContain('<constraints>');
    expect(BUILDER_SYSTEM_PROMPT).toContain('<execution_flow>');
    expect(BUILDER_SYSTEM_PROMPT).toContain('<done_contract>');
  });

  it('system prompt requires git commit', () => {
    expect(BUILDER_SYSTEM_PROMPT).toContain('commit');
  });

  it('system prompt forbids out-of-scope refactoring', () => {
    expect(BUILDER_SYSTEM_PROMPT).toContain(
      'Do not refactor code outside the scope',
    );
  });
});

// ── Builder runtime integration tests ────────────────────────────────

describe('builder agent runtime', () => {
  let db: Database.Database;
  let queue: MessageQueue;
  let auditLog: AuditLogRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
    queue = new MessageQueue(db);
    auditLog = new AuditLogRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeDeps(overrides: Partial<RuntimeDeps> = {}): RuntimeDeps {
    return {
      worktreeManager: createMockWorktreeManager(),
      queue,
      auditLog,
      toolRegistry: createDefaultRegistry(),
      client: createMockClient([makeMessage()]),
      ...overrides,
    };
  }

  it('completes builder task and returns result with fileChangeSummary', async () => {
    const deps = makeDeps();
    const result = await spawnAgent(builderInput(), deps);

    expect(result.status).toBe('completed');
    expect(result.agentName).toBe('builder');
    expect(result.fileChangeSummary).toBeDefined();
    expect(result.commitSha).toBe('abc1234def5678');
    expect(result.fileChangeSummary.added).toContain('src/math.ts');
  });

  it('publishes task_done with commitSha and changed_files', async () => {
    const deps = makeDeps();
    await spawnAgent(builderInput(), deps);

    const messages = db
      .prepare(
        "SELECT * FROM messages WHERE message_type = 'task_done' AND project_id = 'test-project'",
      )
      .all() as Array<{ payload_json: string }>;

    expect(messages).toHaveLength(1);
    const payload = JSON.parse(messages[0]!.payload_json) as Record<
      string,
      unknown
    >;
    expect(payload['commitSha']).toBe('abc1234def5678');
    expect(payload['changed_files']).toBeDefined();

    const changedFiles = payload['changed_files'] as {
      added: string[];
      modified: string[];
      deleted: string[];
      renamed: Array<{ from: string; to: string }>;
    };
    expect(changedFiles.added).toContain('src/math.ts');
  });

  it('handles tool use loop with builder tools', async () => {
    const client = createMockClient([
      makeMessage({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me read the existing files.' },
          {
            type: 'tool_use',
            id: 'toolu_001',
            name: 'list_files',
            input: { path: '.' },
          },
        ],
      }),
      makeMessage({
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'Created the sum function. Task complete.' },
        ],
      }),
    ]);

    const deps = makeDeps({ client });
    const result = await spawnAgent(builderInput(), deps);

    expect(result.status).toBe('completed');
    expect(result.usage.turns).toBe(2);
  });

  it('rejects tools not in builder allowlist', async () => {
    // The builder only has read_file, write_file, list_files, bash.
    // If we register a custom tool and the agent tries to call it, it should be rejected.
    const registry = createDefaultRegistry();
    registry.register({
      name: 'dangerous_tool',
      description: 'Should not be accessible',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
      handler: async () => ({ content: 'Should not run' }),
    });

    const client = createMockClient([
      makeMessage({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_003',
            name: 'dangerous_tool',
            input: {},
          },
        ],
      }),
      makeMessage({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Tool was rejected.' }],
      }),
    ]);

    const deps = makeDeps({ client, toolRegistry: registry });
    const result = await spawnAgent(builderInput(), deps);

    expect(result.status).toBe('completed');

    // Check audit log shows the tool was rejected
    const entries = auditLog.listRecent('test-project');
    const dangerousEntry = entries.find(
      (e) => e.tool_name === 'dangerous_tool',
    );
    expect(dangerousEntry).toBeDefined();
    expect(dangerousEntry!.result_status).toBe('error');
    expect(dangerousEntry!.error_text).toContain('not allowed');
  });

  it('returns empty fileChangeSummary on failure', async () => {
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('API error')),
      },
    } as unknown as Anthropic;

    const deps = makeDeps({ client });
    const result = await spawnAgent(builderInput(), deps);

    expect(result.status).toBe('failed');
    expect(result.fileChangeSummary).toEqual({
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
    });
    expect(result.commitSha).toBeNull();
  });

  it('creates and cleans up worktree', async () => {
    const wm = createMockWorktreeManager();
    const deps = makeDeps({ worktreeManager: wm });

    await spawnAgent(builderInput(), deps);

    expect(wm.create).toHaveBeenCalledOnce();
    expect(wm.remove).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ force: true, deleteBranch: false }),
    );
  });
});
