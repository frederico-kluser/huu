import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition, ToolResult } from '../agents/tools.js';
import type { McpGlobalSettings, McpServerConfig, BridgeCallResult } from './types.js';
import { makeBridgeToolName, parseBridgeToolName } from './types.js';
import { getServerDirectTools } from './config.js';
import type { McpClientManager } from './client.js';
import type { McpToolCache } from './cache.js';

// ── MCP Bridge ──────────────────────────────────────────────────────

export class McpBridge {
  private readonly manager: McpClientManager;
  private readonly cache: McpToolCache;
  private readonly settings: McpGlobalSettings;
  private readonly serverConfigs: Record<string, McpServerConfig>;

  constructor(
    manager: McpClientManager,
    cache: McpToolCache,
    settings: McpGlobalSettings,
    serverConfigs: Record<string, McpServerConfig>,
  ) {
    this.manager = manager;
    this.cache = cache;
    this.settings = settings;
    this.serverConfigs = serverConfigs;
  }

  /**
   * Get direct tools that should be registered as individual tool definitions.
   * These are tools promoted via `directTools` config per server.
   */
  async getDirectToolDefinitions(): Promise<ToolDefinition[]> {
    const definitions: ToolDefinition[] = [];

    for (const [serverId, config] of Object.entries(this.serverConfigs)) {
      const directConfig = getServerDirectTools(config, this.settings);
      if (directConfig === false) continue;

      let tools: McpTool[];
      try {
        tools = await this.manager.listTools(serverId);
      } catch {
        continue;
      }

      // Cache discovered tools
      this.cache.set(serverId, tools);

      const allowedTools = filterDirectTools(tools, directConfig);
      for (const mcpTool of allowedTools) {
        definitions.push(
          this.createToolDefinition(serverId, mcpTool),
        );
      }
    }

    return definitions;
  }

  /**
   * Call a bridged tool by its bridge name (mcp/<server>/<tool>).
   */
  async callBridgedTool(
    bridgeName: string,
    args: Record<string, unknown>,
  ): Promise<BridgeCallResult> {
    const parsed = parseBridgeToolName(bridgeName);
    if (!parsed) {
      return {
        content: `Invalid bridge tool name: "${bridgeName}". Expected format: mcp/<server>/<tool>`,
        isError: true,
        rawContent: [],
        durationMs: 0,
        server: '',
        tool: bridgeName,
      };
    }

    return this.callTool(parsed.serverId, parsed.toolName, args);
  }

  /**
   * Call a specific tool on a specific server.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<BridgeCallResult> {
    const startMs = Date.now();

    try {
      const result = await this.manager.callTool(serverId, toolName, args);
      const durationMs = Date.now() - startMs;

      const content = formatCallToolContent(result.content as McpContentBlock[]);
      const isError = result.isError === true;

      return {
        content,
        isError,
        rawContent: (result.content ?? []) as unknown[],
        durationMs,
        server: serverId,
        tool: toolName,
      };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: `MCP call failed [${serverId}/${toolName}]: ${errMsg}`,
        isError: true,
        rawContent: [],
        durationMs,
        server: serverId,
        tool: toolName,
      };
    }
  }

  /**
   * Create a ToolDefinition from an MCP tool, suitable for the agent ToolRegistry.
   */
  private createToolDefinition(
    serverId: string,
    mcpTool: McpTool,
  ): ToolDefinition {
    const bridgeName = makeBridgeToolName(serverId, mcpTool.name);
    const bridge = this;

    return {
      name: bridgeName,
      description: mcpTool.description ?? `MCP tool: ${mcpTool.name} (server: ${serverId})`,
      inputSchema: (mcpTool.inputSchema ?? {
        type: 'object' as const,
        properties: {},
      }) as ToolDefinition['inputSchema'],
      handler: async (
        input: Record<string, unknown>,
      ): Promise<ToolResult> => {
        const result = await bridge.callTool(serverId, mcpTool.name, input);
        return {
          content: result.content,
          isError: result.isError || undefined,
        };
      },
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

interface McpContentBlock {
  type: string;
  text?: string | undefined;
  data?: string | undefined;
  mimeType?: string | undefined;
  uri?: string | undefined;
  resource?: { uri: string; text?: string | undefined; blob?: string | undefined } | undefined;
}

function formatCallToolContent(content: McpContentBlock[]): string {
  if (!content || content.length === 0) return '(empty response)';

  const parts: string[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text ?? '');
        break;
      case 'image':
        parts.push(`[image: ${block.mimeType ?? 'unknown'}, ${(block.data?.length ?? 0)} bytes base64]`);
        break;
      case 'audio':
        parts.push(`[audio: ${block.mimeType ?? 'unknown'}, ${(block.data?.length ?? 0)} bytes base64]`);
        break;
      case 'resource':
        if (block.resource?.text) {
          parts.push(block.resource.text);
        } else if (block.resource?.uri) {
          parts.push(`[resource: ${block.resource.uri}]`);
        }
        break;
      default:
        parts.push(`[${block.type}: unsupported content type]`);
    }
  }

  return parts.join('\n');
}

function filterDirectTools(
  tools: McpTool[],
  directConfig: boolean | string[],
): McpTool[] {
  if (directConfig === true) return tools;
  if (Array.isArray(directConfig)) {
    const allowed = new Set(directConfig);
    return tools.filter((t) => allowed.has(t.name));
  }
  return [];
}
