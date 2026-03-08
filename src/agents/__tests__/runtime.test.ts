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
import { ToolRegistry } from '../tools.js';
import type { AgentDefinition, AgentRunInput } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function testAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'test-builder',
    role: 'builder',
    description: 'Test builder agent',
    model: 'sonnet',
    tools: ['echo'],
    systemPrompt: 'You are a test builder.',
    ...overrides,
  };
}

function testInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    agent: testAgent(),
    taskId: 'task-1',
    taskPrompt: 'Build a hello world function',
    projectId: 'test-project',
    ...overrides,
  };
}

function makeMessage(
  overrides: Partial<{
    stop_reason: string;
    content: Array<{ type: string; text?: string; name?: string; id?: string; input?: unknown }>;
    usage: { input_tokens: number; output_tokens: number };
  }> = {},
) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Done!' }],
    usage: { input_tokens: 100, output_tokens: 50 },
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
        created: [],
        modified: [],
        deleted: [],
        renamed: [],
      }),
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

// ── Test suite ───────────────────────────────────────────────────────

describe('spawnAgent', () => {
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

  function makeDeps(
    overrides: Partial<RuntimeDeps> = {},
  ): RuntimeDeps {
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: 'Echoes input',
      inputSchema: {
        type: 'object' as const,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      handler: async (input) => ({
        content: `Echo: ${input['text'] as string}`,
      }),
    });

    return {
      worktreeManager: createMockWorktreeManager(),
      queue,
      auditLog,
      toolRegistry: registry,
      client: createMockClient([makeMessage()]),
      ...overrides,
    };
  }

  it('completes a simple run (no tool use)', async () => {
    const deps = makeDeps();
    const result = await spawnAgent(testInput(), deps);

    expect(result.status).toBe('completed');
    expect(result.agentName).toBe('test-builder');
    expect(result.summary).toBe('Done!');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.usage.turns).toBe(1);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });

  it('creates and cleans up worktree', async () => {
    const wm = createMockWorktreeManager();
    const deps = makeDeps({ worktreeManager: wm });

    await spawnAgent(testInput(), deps);

    expect(wm.create).toHaveBeenCalledOnce();
    expect(wm.remove).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ force: true, deleteBranch: false }),
    );
  });

  it('publishes progress and completion events', async () => {
    const deps = makeDeps();
    await spawnAgent(testInput(), deps);

    // Should have multiple messages: spawning, context_ready, running, task_done
    const messages = db
      .prepare(
        "SELECT * FROM messages WHERE project_id = 'test-project' ORDER BY id",
      )
      .all() as Array<{ message_type: string; payload_json: string }>;

    const types = messages.map((m) => m.message_type);
    expect(types).toContain('task_progress');
    expect(types).toContain('task_done');

    const doneMsg = messages.find((m) => m.message_type === 'task_done');
    expect(doneMsg).toBeDefined();
    const payload = JSON.parse(doneMsg!.payload_json) as Record<string, unknown>;
    expect(payload['state']).toBe('completed');
  });

  it('handles tool use loop', async () => {
    const client = createMockClient([
      makeMessage({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me use the tool.' },
          {
            type: 'tool_use',
            id: 'toolu_001',
            name: 'echo',
            input: { text: 'hello' },
          },
        ],
      }),
      makeMessage({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Tool result received. All done!' }],
      }),
    ]);

    const deps = makeDeps({ client });
    const result = await spawnAgent(testInput(), deps);

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('Tool result received. All done!');
    expect(result.usage.turns).toBe(2);

    // Verify audit log was written
    const auditEntries = auditLog.listRecent('test-project');
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]!.tool_name).toBe('echo');
    expect(auditEntries[0]!.result_status).toBe('success');
  });

  it('fails with invalid agent definition', async () => {
    const deps = makeDeps();
    const input = testInput({
      agent: testAgent({ name: '' }),
    });

    await expect(spawnAgent(input, deps)).rejects.toThrow(
      'Agent name must be a non-empty string',
    );
  });

  it('returns failed status on API error', async () => {
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('API rate limit')),
      },
    } as unknown as Anthropic;

    const deps = makeDeps({ client });
    const result = await spawnAgent(testInput(), deps);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('API rate limit');
  });

  it('cleans up worktree on API error', async () => {
    const wm = createMockWorktreeManager();
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('API error')),
      },
    } as unknown as Anthropic;

    const deps = makeDeps({ worktreeManager: wm, client });
    await spawnAgent(testInput(), deps);

    expect(wm.remove).toHaveBeenCalledOnce();
  });

  it('returns aborted status when signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort('user cancelled');

    const deps = makeDeps();
    const result = await spawnAgent(
      testInput({ parentSignal: controller.signal }),
      deps,
    );

    expect(result.status).toBe('aborted');
  });

  it('publishes escalation on failure', async () => {
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('boom')),
      },
    } as unknown as Anthropic;

    const deps = makeDeps({ client });
    await spawnAgent(testInput(), deps);

    const messages = db
      .prepare(
        "SELECT * FROM messages WHERE message_type = 'escalation'",
      )
      .all() as Array<{ payload_json: string }>;

    expect(messages).toHaveLength(1);
    const payload = JSON.parse(messages[0]!.payload_json) as Record<string, unknown>;
    expect(payload['error']).toContain('boom');
  });

  it('preserves worktree when keepWorktree is set', async () => {
    const wm = createMockWorktreeManager();
    const deps = makeDeps({ worktreeManager: wm });

    await spawnAgent(testInput({ keepWorktree: true }), deps);

    expect(wm.remove).not.toHaveBeenCalled();
  });

  it('handles tool error in loop', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: 'Echoes input',
      inputSchema: {
        type: 'object' as const,
        properties: { text: { type: 'string' } },
      },
      handler: async () => {
        throw new Error('tool crashed');
      },
    });

    const client = createMockClient([
      makeMessage({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_002',
            name: 'echo',
            input: { text: 'hello' },
          },
        ],
      }),
      makeMessage({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Handled the error' }],
      }),
    ]);

    const deps = makeDeps({ client, toolRegistry: registry });
    const result = await spawnAgent(testInput(), deps);

    expect(result.status).toBe('completed');

    // Audit log should show error
    const entries = auditLog.listRecent('test-project');
    expect(entries[0]!.result_status).toBe('error');
    expect(entries[0]!.error_text).toContain('tool crashed');
  });

  it('uses custom baseBranch', async () => {
    const wm = createMockWorktreeManager();
    const deps = makeDeps({ worktreeManager: wm });

    await spawnAgent(testInput({ baseBranch: 'develop' }), deps);

    expect(wm.create).toHaveBeenCalledWith(
      expect.any(String),
      'develop',
    );
  });

  it('exhausts maxTurns and fails', async () => {
    // Agent that always wants to use tools (infinite loop)
    const toolUseResponse = makeMessage({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_loop',
          name: 'echo',
          input: { text: 'again' },
        },
      ],
    });

    const responses = Array.from({ length: 5 }, () => toolUseResponse);
    const client = createMockClient(responses);

    const deps = makeDeps({ client });
    const result = await spawnAgent(
      testInput({ agent: testAgent({ maxTurns: 3 }) }),
      deps,
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('exhausted 3 turns');
  });
});
