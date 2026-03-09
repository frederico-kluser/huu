import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpBridge } from './bridge.js';
import type { McpClientManager } from './client.js';
import { McpToolCache } from './cache.js';
import type { McpGlobalSettings, McpServerConfig } from './types.js';

function createMockManager(tools = [
  { name: 'search_repos', description: 'Search repos', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_file', description: 'Get file', inputSchema: { type: 'object', properties: {} } },
]): McpClientManager {
  return {
    getServerIds: vi.fn().mockReturnValue(['github']),
    getServerState: vi.fn(),
    ensureConnected: vi.fn().mockResolvedValue({ state: 'ready', tools }),
    listTools: vi.fn().mockResolvedValue(tools),
    refreshTools: vi.fn().mockResolvedValue(tools),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'result text' }],
      isError: false,
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    connectEagerServers: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    onAuditEvent: vi.fn(),
  } as unknown as McpClientManager;
}

const defaultSettings: McpGlobalSettings = {
  idleTimeoutMinutes: 10,
  lifecycle: 'lazy',
  toolPrefix: 'mcp',
  directTools: false,
};

describe('McpBridge', () => {
  let mockManager: McpClientManager;
  let cache: McpToolCache;
  let bridge: McpBridge;

  beforeEach(() => {
    mockManager = createMockManager();
    cache = new McpToolCache();
    const configs: Record<string, McpServerConfig> = {
      github: {
        transport: 'stdio',
        command: 'echo',
        directTools: ['search_repos'],
      },
    };
    bridge = new McpBridge(mockManager, cache, defaultSettings, configs);
  });

  describe('getDirectToolDefinitions', () => {
    it('returns promoted tools as ToolDefinitions', async () => {
      const tools = await bridge.getDirectToolDefinitions();
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe('mcp/github/search_repos');
      expect(tools[0]!.description).toBe('Search repos');
    });

    it('returns all tools when directTools is true', async () => {
      const configs: Record<string, McpServerConfig> = {
        github: {
          transport: 'stdio',
          command: 'echo',
          directTools: true,
        },
      };
      bridge = new McpBridge(mockManager, cache, defaultSettings, configs);
      const tools = await bridge.getDirectToolDefinitions();
      expect(tools).toHaveLength(2);
    });

    it('returns no tools when directTools is false', async () => {
      const configs: Record<string, McpServerConfig> = {
        github: { transport: 'stdio', command: 'echo', directTools: false },
      };
      bridge = new McpBridge(mockManager, cache, defaultSettings, configs);
      const tools = await bridge.getDirectToolDefinitions();
      expect(tools).toHaveLength(0);
    });

    it('caches discovered tools', async () => {
      await bridge.getDirectToolDefinitions();
      const cached = cache.getForServer('github');
      expect(cached).toHaveLength(2);
    });
  });

  describe('callTool', () => {
    it('calls tool and returns formatted result', async () => {
      const result = await bridge.callTool('github', 'search_repos', { q: 'test' });
      expect(result.content).toBe('result text');
      expect(result.isError).toBe(false);
      expect(result.server).toBe('github');
      expect(result.tool).toBe('search_repos');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('handles error results', async () => {
      (mockManager.callTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'something went wrong' }],
        isError: true,
      });

      const result = await bridge.callTool('github', 'search_repos', {});
      expect(result.isError).toBe(true);
      expect(result.content).toBe('something went wrong');
    });

    it('handles thrown errors', async () => {
      (mockManager.callTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('connection lost'),
      );

      const result = await bridge.callTool('github', 'search_repos', {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('connection lost');
    });
  });

  describe('callBridgedTool', () => {
    it('parses bridge name and calls tool', async () => {
      const result = await bridge.callBridgedTool('mcp/github/search_repos', { q: 'test' });
      expect(result.content).toBe('result text');
      expect(result.server).toBe('github');
    });

    it('returns error for invalid bridge name', async () => {
      const result = await bridge.callBridgedTool('invalid_name', {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid bridge tool name');
    });
  });

  describe('direct tool handler', () => {
    it('tool handler calls bridge and returns ToolResult', async () => {
      const tools = await bridge.getDirectToolDefinitions();
      const searchTool = tools.find((t) => t.name === 'mcp/github/search_repos');
      expect(searchTool).toBeDefined();

      const result = await searchTool!.handler({ q: 'test' }, {} as never);
      expect(result.content).toBe('result text');
      expect(result.isError).toBeUndefined();
    });
  });

  describe('content formatting', () => {
    it('handles image content blocks', async () => {
      (mockManager.callTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [{ type: 'image', mimeType: 'image/png', data: 'abc123' }],
        isError: false,
      });

      const result = await bridge.callTool('github', 'tool', {});
      expect(result.content).toContain('[image: image/png');
    });

    it('handles empty content', async () => {
      (mockManager.callTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [],
        isError: false,
      });

      const result = await bridge.callTool('github', 'tool', {});
      expect(result.content).toBe('(empty response)');
    });

    it('handles resource content blocks', async () => {
      (mockManager.callTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [{ type: 'resource', resource: { uri: 'file://test', text: 'file content' } }],
        isError: false,
      });

      const result = await bridge.callTool('github', 'tool', {});
      expect(result.content).toBe('file content');
    });
  });
});
