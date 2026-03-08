import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolRegistry, createDefaultRegistry } from '../tools.js';
import type { ToolExecutionContext, ToolDefinition } from '../tools.js';
import type { AgentDefinition } from '../types.js';

function testAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'test-agent',
    role: 'tester',
    description: 'Test agent',
    model: 'sonnet',
    tools: ['read_file', 'write_file', 'list_files', 'bash'],
    systemPrompt: 'You are a test agent.',
    ...overrides,
  };
}

function testContext(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    runId: 'test-run',
    cwd: '/tmp',
    signal: new AbortController().signal,
    agent: testAgent(),
    ...overrides,
  };
}

// ── ToolRegistry unit tests ──────────────────────────────────────────

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  const echoTool: ToolDefinition = {
    name: 'echo',
    description: 'Echoes input',
    inputSchema: {
      type: 'object' as const,
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    handler: async (input) => ({ content: input['text'] as string }),
  };

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and retrieves a tool', () => {
    registry.register(echoTool);
    expect(registry.get('echo')).toBe(echoTool);
    expect(registry.has('echo')).toBe(true);
  });

  it('returns undefined for unregistered tool', () => {
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.has('nope')).toBe(false);
  });

  it('lists registered tool names', () => {
    registry.register(echoTool);
    expect(registry.names()).toEqual(['echo']);
  });

  describe('getToolsForAgent', () => {
    it('returns only tools in agent allowlist', () => {
      registry.register(echoTool);
      registry.register({
        ...echoTool,
        name: 'hidden',
        description: 'hidden tool',
      });

      const agent = testAgent({ tools: ['echo'] });
      const tools = registry.getToolsForAgent(agent);

      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe('echo');
    });

    it('respects disallowedTools', () => {
      registry.register(echoTool);
      registry.register({
        ...echoTool,
        name: 'danger',
        description: 'dangerous tool',
      });

      const agent = testAgent({
        tools: ['echo', 'danger'],
        disallowedTools: ['danger'],
      });
      const tools = registry.getToolsForAgent(agent);

      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe('echo');
    });

    it('returns empty when no tools match', () => {
      const agent = testAgent({ tools: ['nonexistent'] });
      const tools = registry.getToolsForAgent(agent);
      expect(tools).toHaveLength(0);
    });
  });

  describe('execute', () => {
    it('executes allowed tool', async () => {
      registry.register(echoTool);
      const ctx = testContext({ agent: testAgent({ tools: ['echo'] }) });

      const result = await registry.execute('echo', { text: 'hello' }, ctx);
      expect(result.content).toBe('hello');
      expect(result.isError).toBeUndefined();
    });

    it('rejects disallowed tool', async () => {
      registry.register(echoTool);
      const ctx = testContext({
        agent: testAgent({ tools: ['echo'], disallowedTools: ['echo'] }),
      });

      const result = await registry.execute('echo', { text: 'hello' }, ctx);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not allowed');
    });

    it('rejects unregistered tool', async () => {
      const ctx = testContext({ agent: testAgent({ tools: ['missing'] }) });

      const result = await registry.execute('missing', {}, ctx);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not registered');
    });

    it('returns error when signal is aborted', async () => {
      registry.register(echoTool);
      const controller = new AbortController();
      controller.abort();

      const ctx = testContext({
        signal: controller.signal,
        agent: testAgent({ tools: ['echo'] }),
      });

      const result = await registry.execute('echo', { text: 'hello' }, ctx);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('aborted');
    });

    it('catches handler errors', async () => {
      const failTool: ToolDefinition = {
        ...echoTool,
        name: 'fail',
        handler: async () => {
          throw new Error('tool broke');
        },
      };
      registry.register(failTool);
      const ctx = testContext({ agent: testAgent({ tools: ['fail'] }) });

      const result = await registry.execute('fail', {}, ctx);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('tool broke');
    });
  });
});

// ── Built-in tools integration tests ─────────────────────────────────

describe('Built-in tools', () => {
  let tmpDir: string;
  let registry: ToolRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huu-tools-test-'));
    registry = createDefaultRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function ctx(): ToolExecutionContext {
    return testContext({ cwd: tmpDir });
  }

  describe('read_file', () => {
    it('reads an existing file', async () => {
      fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'world');
      const result = await registry.execute(
        'read_file',
        { path: 'hello.txt' },
        ctx(),
      );
      expect(result.content).toBe('world');
    });

    it('returns error for nonexistent file', async () => {
      const result = await registry.execute(
        'read_file',
        { path: 'nope.txt' },
        ctx(),
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Error reading file');
    });

    it('rejects path traversal', async () => {
      const result = await registry.execute(
        'read_file',
        { path: '../../etc/passwd' },
        ctx(),
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('path traversal');
    });
  });

  describe('write_file', () => {
    it('writes a file', async () => {
      const result = await registry.execute(
        'write_file',
        { path: 'output.txt', content: 'test data' },
        ctx(),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('output.txt');
      expect(fs.readFileSync(path.join(tmpDir, 'output.txt'), 'utf-8')).toBe(
        'test data',
      );
    });

    it('creates parent directories', async () => {
      await registry.execute(
        'write_file',
        { path: 'sub/dir/file.txt', content: 'nested' },
        ctx(),
      );
      expect(
        fs.readFileSync(path.join(tmpDir, 'sub/dir/file.txt'), 'utf-8'),
      ).toBe('nested');
    });

    it('rejects path traversal', async () => {
      const result = await registry.execute(
        'write_file',
        { path: '../../etc/evil', content: 'bad' },
        ctx(),
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('path traversal');
    });
  });

  describe('list_files', () => {
    it('lists files and directories', async () => {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), '');
      fs.mkdirSync(path.join(tmpDir, 'subdir'));
      const result = await registry.execute('list_files', {}, ctx());
      expect(result.content).toContain('a.txt');
      expect(result.content).toContain('subdir/');
    });

    it('lists subdirectory', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'));
      fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '');
      const result = await registry.execute(
        'list_files',
        { path: 'src' },
        ctx(),
      );
      expect(result.content).toContain('index.ts');
    });

    it('returns (empty directory) for empty dir', async () => {
      fs.mkdirSync(path.join(tmpDir, 'empty'));
      const result = await registry.execute(
        'list_files',
        { path: 'empty' },
        ctx(),
      );
      expect(result.content).toBe('(empty directory)');
    });
  });

  describe('bash', () => {
    it('executes a command', async () => {
      const result = await registry.execute(
        'bash',
        { command: 'echo hello' },
        ctx(),
      );
      expect(result.content.trim()).toBe('hello');
    });

    it('runs in correct working directory', async () => {
      fs.writeFileSync(path.join(tmpDir, 'marker.txt'), 'found');
      const result = await registry.execute(
        'bash',
        { command: 'cat marker.txt' },
        ctx(),
      );
      expect(result.content.trim()).toBe('found');
    });

    it('returns error for failed commands', async () => {
      const result = await registry.execute(
        'bash',
        { command: 'exit 1' },
        ctx(),
      );
      expect(result.isError).toBe(true);
    });
  });
});
