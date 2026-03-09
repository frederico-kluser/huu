import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpClientManager, McpClientError } from './client.js';
import type { McpGlobalSettings, McpServerConfig } from './types.js';

// Mock the MCP SDK modules
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class MockClient {
    connect = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    listTools = vi.fn().mockResolvedValue({
      tools: [
        { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object', properties: {} } },
        { name: 'tool_b', description: 'Tool B', inputSchema: { type: 'object', properties: {} } },
      ],
    });
    callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
      isError: false,
    });
  }
  return { Client: MockClient };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  class MockStdioTransport {
    start = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { StdioClientTransport: MockStdioTransport };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  class MockHttpTransport {
    start = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { StreamableHTTPClientTransport: MockHttpTransport };
});

const defaultSettings: McpGlobalSettings = {
  idleTimeoutMinutes: 10,
  lifecycle: 'lazy',
  toolPrefix: 'mcp',
  directTools: false,
};

describe('McpClientManager', () => {
  let manager: McpClientManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const configs: Record<string, McpServerConfig> = {
      test: {
        transport: 'stdio',
        command: 'echo',
        args: ['hello'],
      },
      remote: {
        transport: 'http',
        url: 'https://example.com/mcp',
      },
    };
    manager = new McpClientManager(configs, defaultSettings);
  });

  it('lists server IDs', () => {
    expect(manager.getServerIds()).toEqual(['test', 'remote']);
  });

  it('returns server state', () => {
    const state = manager.getServerState('test');
    expect(state).toBeDefined();
    expect(state!.state).toBe('idle');
    expect(state!.serverId).toBe('test');
  });

  it('returns undefined for unknown server', () => {
    expect(manager.getServerState('nope')).toBeUndefined();
  });

  it('throws on ensureConnected with unknown server', async () => {
    await expect(manager.ensureConnected('nope')).rejects.toThrow(McpClientError);
  });

  it('connects lazily on ensureConnected', async () => {
    const rt = await manager.ensureConnected('test');
    expect(rt.state).toBe('ready');
    expect(rt.client).toBeDefined();
    expect(rt.tools).toHaveLength(2);
  });

  it('reuses existing connection', async () => {
    const rt1 = await manager.ensureConnected('test');
    const rt2 = await manager.ensureConnected('test');
    expect(rt1).toBe(rt2);
    expect(rt1.state).toBe('ready');
  });

  it('listTools connects and returns tools', async () => {
    const tools = await manager.listTools('test');
    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe('tool_a');
  });

  it('callTool connects and calls tool', async () => {
    const result = await manager.callTool('test', 'tool_a', { q: 'test' });
    expect(result.content).toEqual([{ type: 'text', text: 'result' }]);
    expect(result.isError).toBe(false);
  });

  it('emits audit events on callTool', async () => {
    const events: unknown[] = [];
    manager.onAuditEvent((e) => events.push(e));
    await manager.callTool('test', 'tool_a', {});
    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>)['status']).toBe('success');
  });

  it('increments and decrements inFlightCount', async () => {
    const rt = await manager.ensureConnected('test');
    expect(rt.inFlightCount).toBe(0);
    // callTool increments in-flight during call and decrements after
    await manager.callTool('test', 'tool_a', {});
    expect(rt.inFlightCount).toBe(0);
  });

  it('disconnect throws when requests in-flight', async () => {
    const rt = await manager.ensureConnected('test');
    // Simulate in-flight
    rt.inFlightCount = 1;
    await expect(manager.disconnect('test')).rejects.toThrow(McpClientError);
    rt.inFlightCount = 0;
  });

  it('disconnect succeeds when idle', async () => {
    await manager.ensureConnected('test');
    await manager.disconnect('test');
    const rt = manager.getServerState('test');
    expect(rt!.state).toBe('idle');
  });

  it('dispose closes all servers', async () => {
    await manager.ensureConnected('test');
    await manager.dispose();
    const rt = manager.getServerState('test');
    expect(rt!.state).toBe('idle');
  });

  it('handles http transport servers', async () => {
    const rt = await manager.ensureConnected('remote');
    expect(rt.state).toBe('ready');
  });

  it('single-flight: concurrent connects share promise', async () => {
    const [rt1, rt2] = await Promise.all([
      manager.ensureConnected('test'),
      manager.ensureConnected('test'),
    ]);
    expect(rt1).toBe(rt2);
    expect(rt1.state).toBe('ready');
  });
});
