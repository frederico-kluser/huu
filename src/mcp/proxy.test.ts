import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpProxyTool } from './proxy.js';
import type { McpClientManager } from './client.js';
import type { McpBridge } from './bridge.js';
import { McpToolCache } from './cache.js';
import type { ToolDefinition } from '../agents/tools.js';

function createMockManager(): McpClientManager {
  return {
    getServerIds: vi.fn().mockReturnValue(['github', 'context7']),
    getServerState: vi.fn().mockImplementation((id: string) => {
      if (id === 'github') {
        return {
          state: 'ready',
          tools: [
            { name: 'search', description: 'Search repos', inputSchema: { type: 'object', properties: {} } },
          ],
          inFlightCount: 0,
          errorMessage: null,
        };
      }
      if (id === 'context7') {
        return {
          state: 'idle',
          tools: [],
          inFlightCount: 0,
          errorMessage: null,
        };
      }
      return undefined;
    }),
    ensureConnected: vi.fn().mockResolvedValue({ state: 'ready', tools: [] }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onAuditEvent: vi.fn(),
  } as unknown as McpClientManager;
}

function createMockBridge(): McpBridge {
  return {
    callTool: vi.fn().mockResolvedValue({
      content: 'call result',
      isError: false,
      rawContent: [],
      durationMs: 42,
      server: 'github',
      tool: 'search',
    }),
  } as unknown as McpBridge;
}

describe('createMcpProxyTool', () => {
  let proxyTool: ToolDefinition;
  let mockManager: McpClientManager;
  let mockBridge: McpBridge;
  let cache: McpToolCache;

  beforeEach(() => {
    mockManager = createMockManager();
    mockBridge = createMockBridge();
    cache = new McpToolCache();
    proxyTool = createMcpProxyTool(mockManager, mockBridge, cache);
  });

  it('has correct name and description', () => {
    expect(proxyTool.name).toBe('mcp_proxy');
    expect(proxyTool.description).toContain('MCP');
  });

  describe('status action', () => {
    it('shows all servers status', async () => {
      const result = await proxyTool.handler({ action: 'status' }, {} as never);
      expect(result.content).toContain('github');
      expect(result.content).toContain('context7');
      expect(result.content).toContain('state=ready');
      expect(result.content).toContain('state=idle');
    });

    it('shows single server status', async () => {
      const result = await proxyTool.handler(
        { action: 'status', server: 'github' },
        {} as never,
      );
      expect(result.content).toContain('github');
      expect(result.content).not.toContain('context7');
    });

    it('handles unknown server in status', async () => {
      const result = await proxyTool.handler(
        { action: 'status', server: 'unknown' },
        {} as never,
      );
      expect(result.content).toContain('unknown server');
    });
  });

  describe('search action', () => {
    it('requires query parameter', async () => {
      const result = await proxyTool.handler({ action: 'search' }, {} as never);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('query');
    });

    it('searches cached tools', async () => {
      cache.set('github', [
        { name: 'search_repos', description: 'Search repositories', inputSchema: { type: 'object', properties: {} } },
      ]);

      const result = await proxyTool.handler(
        { action: 'search', query: 'search' },
        {} as never,
      );
      expect(result.content).toContain('search_repos');
      expect(result.content).toContain('github');
    });

    it('populates cache from connected servers if empty', async () => {
      const result = await proxyTool.handler(
        { action: 'search', query: 'search' },
        {} as never,
      );
      // Manager getServerState returns tools for github
      expect(result.content).toContain('search');
    });

    it('returns helpful message when no results', async () => {
      const result = await proxyTool.handler(
        { action: 'search', query: 'nonexistent_xyz' },
        {} as never,
      );
      expect(result.content).toContain('No tools found');
    });
  });

  describe('describe action', () => {
    it('requires tool parameter', async () => {
      const result = await proxyTool.handler({ action: 'describe' }, {} as never);
      expect(result.isError).toBe(true);
    });

    it('describes a cached tool', async () => {
      cache.set('github', [
        { name: 'search', description: 'Search repos', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
      ]);

      const result = await proxyTool.handler(
        { action: 'describe', tool: 'github/search' },
        {} as never,
      );
      expect(result.content).toContain('github/search');
      expect(result.content).toContain('Search repos');
    });

    it('returns error for missing tool', async () => {
      const result = await proxyTool.handler(
        { action: 'describe', tool: 'unknown/tool' },
        {} as never,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });

    it('requires server/tool format', async () => {
      const result = await proxyTool.handler(
        { action: 'describe', tool: 'no_slash' },
        {} as never,
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('call action', () => {
    it('requires tool parameter', async () => {
      const result = await proxyTool.handler({ action: 'call' }, {} as never);
      expect(result.isError).toBe(true);
    });

    it('calls tool through bridge', async () => {
      const result = await proxyTool.handler(
        { action: 'call', tool: 'github/search', argsJson: '{"q":"test"}' },
        {} as never,
      );
      expect(result.content).toBe('call result');
      expect(mockBridge.callTool).toHaveBeenCalledWith('github', 'search', { q: 'test' });
    });

    it('calls with empty args when argsJson not provided', async () => {
      await proxyTool.handler(
        { action: 'call', tool: 'github/search' },
        {} as never,
      );
      expect(mockBridge.callTool).toHaveBeenCalledWith('github', 'search', {});
    });

    it('returns error for invalid argsJson', async () => {
      const result = await proxyTool.handler(
        { action: 'call', tool: 'github/search', argsJson: 'not json' },
        {} as never,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('argsJson');
    });

    it('returns error when argsJson is not an object', async () => {
      const result = await proxyTool.handler(
        { action: 'call', tool: 'github/search', argsJson: '"string"' },
        {} as never,
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('connect action', () => {
    it('requires server parameter', async () => {
      const result = await proxyTool.handler({ action: 'connect' }, {} as never);
      expect(result.isError).toBe(true);
    });

    it('connects to server', async () => {
      (mockManager.ensureConnected as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        state: 'ready',
        tools: [{ name: 'a' }, { name: 'b' }],
      });
      (mockManager.getServerState as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        tools: [{ name: 'a' }, { name: 'b' }],
      });

      const result = await proxyTool.handler(
        { action: 'connect', server: 'context7' },
        {} as never,
      );
      expect(result.content).toContain('Connected');
      expect(result.content).toContain('context7');
    });

    it('handles connection failure', async () => {
      (mockManager.ensureConnected as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('connection refused'),
      );

      const result = await proxyTool.handler(
        { action: 'connect', server: 'context7' },
        {} as never,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Failed to connect');
    });
  });

  describe('disconnect action', () => {
    it('requires server parameter', async () => {
      const result = await proxyTool.handler({ action: 'disconnect' }, {} as never);
      expect(result.isError).toBe(true);
    });

    it('disconnects from server', async () => {
      const result = await proxyTool.handler(
        { action: 'disconnect', server: 'github' },
        {} as never,
      );
      expect(result.content).toContain('Disconnected');
    });
  });

  describe('unknown action', () => {
    it('returns error', async () => {
      const result = await proxyTool.handler(
        { action: 'invalid' },
        {} as never,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unknown action');
    });
  });
});
