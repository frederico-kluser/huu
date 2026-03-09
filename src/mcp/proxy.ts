import type { ToolDefinition, ToolResult } from '../agents/tools.js';
import type { ProxyAction } from './types.js';
import type { McpClientManager } from './client.js';
import type { McpBridge } from './bridge.js';
import type { McpToolCache } from './cache.js';

// ── Proxy Tool ──────────────────────────────────────────────────────

export function createMcpProxyTool(
  manager: McpClientManager,
  bridge: McpBridge,
  cache: McpToolCache,
): ToolDefinition {
  return {
    name: 'mcp_proxy',
    description: [
      'Interact with MCP (Model Context Protocol) servers.',
      'Actions:',
      '  - status: Show server connection status. Optional "server" to filter.',
      '  - search: Search available MCP tools by keyword. Params: "query" (required), "server" (optional).',
      '  - describe: Get full schema of a tool. Params: "tool" (format: "server/toolName").',
      '  - call: Execute an MCP tool. Params: "tool" (format: "server/toolName"), "argsJson" (optional JSON string).',
      '  - connect: Connect to a server. Params: "server".',
      '  - disconnect: Disconnect from a server. Params: "server".',
    ].join('\n'),
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'search', 'describe', 'call', 'connect', 'disconnect'],
          description: 'The proxy action to perform.',
        },
        query: {
          type: 'string',
          description: 'Search query (for "search" action).',
        },
        tool: {
          type: 'string',
          description: 'Tool identifier in "server/toolName" format (for "describe" and "call" actions).',
        },
        argsJson: {
          type: 'string',
          description: 'JSON string of arguments to pass to the tool (for "call" action).',
        },
        server: {
          type: 'string',
          description: 'Server identifier (for "status", "search", "connect", "disconnect" actions).',
        },
      },
      required: ['action'],
    },
    handler: async (input: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const parsed = parseProxyInput(input);
        return await executeProxyAction(parsed, manager, bridge, cache);
      } catch (err) {
        return {
          content: `mcp_proxy error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };
}

// ── Input parsing ───────────────────────────────────────────────────

function parseProxyInput(input: Record<string, unknown>): ProxyAction {
  const action = input['action'] as string;

  switch (action) {
    case 'status':
      return { action: 'status', server: input['server'] as string | undefined };

    case 'search': {
      const query = input['query'] as string | undefined;
      if (!query) throw new Error('"query" is required for search action');
      return { action: 'search', query, server: input['server'] as string | undefined };
    }

    case 'describe': {
      const tool = input['tool'] as string | undefined;
      if (!tool) throw new Error('"tool" is required for describe action');
      return { action: 'describe', tool };
    }

    case 'call': {
      const tool = input['tool'] as string | undefined;
      if (!tool) throw new Error('"tool" is required for call action');
      return {
        action: 'call',
        tool,
        argsJson: input['argsJson'] as string | undefined,
      };
    }

    case 'connect': {
      const server = input['server'] as string | undefined;
      if (!server) throw new Error('"server" is required for connect action');
      return { action: 'connect', server };
    }

    case 'disconnect': {
      const server = input['server'] as string | undefined;
      if (!server) throw new Error('"server" is required for disconnect action');
      return { action: 'disconnect', server };
    }

    default:
      throw new Error(
        `Unknown action: "${action}". Valid actions: status, search, describe, call, connect, disconnect`,
      );
  }
}

// ── Action execution ────────────────────────────────────────────────

async function executeProxyAction(
  action: ProxyAction,
  manager: McpClientManager,
  bridge: McpBridge,
  cache: McpToolCache,
): Promise<ToolResult> {
  switch (action.action) {
    case 'status':
      return handleStatus(manager, action.server);

    case 'search':
      return handleSearch(cache, manager, action.query, action.server);

    case 'describe':
      return handleDescribe(cache, manager, action.tool);

    case 'call':
      return await handleCall(bridge, action.tool, action.argsJson);

    case 'connect':
      return await handleConnect(manager, cache, action.server);

    case 'disconnect':
      return await handleDisconnect(manager, action.server);
  }
}

// ── Action handlers ─────────────────────────────────────────────────

function handleStatus(
  manager: McpClientManager,
  serverId: string | undefined,
): ToolResult {
  const serverIds = serverId ? [serverId] : manager.getServerIds();
  const lines: string[] = [];

  for (const id of serverIds) {
    const rt = manager.getServerState(id);
    if (!rt) {
      lines.push(`${id}: unknown server`);
      continue;
    }
    lines.push(
      `${id}: state=${rt.state}, tools=${rt.tools.length}, inFlight=${rt.inFlightCount}` +
        (rt.errorMessage ? `, error="${rt.errorMessage}"` : ''),
    );
  }

  return { content: lines.join('\n') || 'No MCP servers configured.' };
}

function handleSearch(
  cache: McpToolCache,
  manager: McpClientManager,
  query: string,
  serverId: string | undefined,
): ToolResult {
  // First try cache
  let results = cache.search(query, serverId);

  // If cache is empty for requested servers, try to populate from already-connected servers
  if (results.length === 0) {
    const serverIds = serverId ? [serverId] : manager.getServerIds();
    for (const id of serverIds) {
      const rt = manager.getServerState(id);
      if (rt && rt.state === 'ready' && rt.tools.length > 0) {
        cache.set(id, rt.tools);
      }
    }
    results = cache.search(query, serverId);
  }

  if (results.length === 0) {
    return {
      content: `No tools found matching "${query}".${serverId ? '' : ' Try connecting to a server first with action "connect".'}`,
    };
  }

  const lines = results.map(
    (t) => `${t.serverId}/${t.name}: ${t.description}`,
  );
  return { content: lines.join('\n') };
}

function handleDescribe(
  cache: McpToolCache,
  manager: McpClientManager,
  toolId: string,
): ToolResult {
  const { serverId, toolName } = parseToolId(toolId);

  // Try cache first
  const cached = cache.get(serverId, toolName);
  if (cached) {
    return {
      content: formatToolDescription(cached.serverId, cached.name, cached.description, cached.inputSchema),
    };
  }

  // Check connected server tools
  const rt = manager.getServerState(serverId);
  if (rt && rt.tools.length > 0) {
    const tool = rt.tools.find((t) => t.name === toolName);
    if (tool) {
      cache.set(serverId, [tool]);
      return {
        content: formatToolDescription(
          serverId,
          tool.name,
          tool.description ?? '',
          (tool.inputSchema ?? {}) as Record<string, unknown>,
        ),
      };
    }
  }

  return {
    content: `Tool "${toolId}" not found. Try "search" to find available tools, or "connect" to the server first.`,
    isError: true,
  };
}

async function handleCall(
  bridge: McpBridge,
  toolId: string,
  argsJson: string | undefined,
): Promise<ToolResult> {
  const { serverId, toolName } = parseToolId(toolId);

  let args: Record<string, unknown> = {};
  if (argsJson) {
    try {
      const parsed: unknown = JSON.parse(argsJson);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { content: '"argsJson" must be a JSON object', isError: true };
      }
      args = parsed as Record<string, unknown>;
    } catch (err) {
      return {
        content: `Invalid "argsJson": ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  const result = await bridge.callTool(serverId, toolName, args);
  return {
    content: result.content,
    isError: result.isError || undefined,
  };
}

async function handleConnect(
  manager: McpClientManager,
  cache: McpToolCache,
  serverId: string,
): Promise<ToolResult> {
  try {
    await manager.ensureConnected(serverId);
    const rt = manager.getServerState(serverId);
    if (rt) {
      cache.set(serverId, rt.tools);
    }
    const toolCount = rt?.tools.length ?? 0;
    return { content: `Connected to "${serverId}". ${toolCount} tools available.` };
  } catch (err) {
    return {
      content: `Failed to connect to "${serverId}": ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

async function handleDisconnect(
  manager: McpClientManager,
  serverId: string,
): Promise<ToolResult> {
  try {
    await manager.disconnect(serverId);
    return { content: `Disconnected from "${serverId}".` };
  } catch (err) {
    return {
      content: `Failed to disconnect from "${serverId}": ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseToolId(toolId: string): { serverId: string; toolName: string } {
  const slashIdx = toolId.indexOf('/');
  if (slashIdx === -1) {
    throw new Error(
      `Invalid tool format: "${toolId}". Expected "server/toolName".`,
    );
  }
  return {
    serverId: toolId.slice(0, slashIdx),
    toolName: toolId.slice(slashIdx + 1),
  };
}

function formatToolDescription(
  serverId: string,
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
): string {
  const lines = [
    `Tool: ${serverId}/${name}`,
    `Description: ${description || '(no description)'}`,
    `Input Schema:`,
    JSON.stringify(inputSchema, null, 2),
  ];
  return lines.join('\n');
}
