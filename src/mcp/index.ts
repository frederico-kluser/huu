export {
  type McpConfig,
  type McpServerConfig,
  type McpGlobalSettings,
  type McpServerRuntimeState,
  type ServerState,
  type LifecycleMode,
  type TransportType,
  type BridgeToolName,
  type BridgeCallResult,
  type ProxyAction,
  type McpAuditEvent,
  type CachedToolMetadata,
  makeBridgeToolName,
  parseBridgeToolName,
  SERVER_STATES,
  LIFECYCLE_MODES,
  TRANSPORT_TYPES,
} from './types.js';

export {
  McpConfigError,
  loadMcpConfig,
  getGlobalConfigPath,
  getProjectConfigPath,
  resolveServerEnv,
  resolveServerHeaders,
  getServerLifecycle,
  getServerIdleTimeoutMs,
  getServerDirectTools,
} from './config.js';

export {
  McpClientManager,
  McpClientError,
  type McpEventListener,
} from './client.js';

export { McpBridge } from './bridge.js';

export { createMcpProxyTool } from './proxy.js';

export { McpToolCache } from './cache.js';

// ── Factory ─────────────────────────────────────────────────────────

import type { ToolRegistry } from '../agents/tools.js';
import { loadMcpConfig } from './config.js';
import { McpClientManager } from './client.js';
import { McpBridge } from './bridge.js';
import { McpToolCache } from './cache.js';
import { createMcpProxyTool } from './proxy.js';

export interface McpBridgeSystem {
  manager: McpClientManager;
  bridge: McpBridge;
  cache: McpToolCache;
}

/**
 * Initialize the complete MCP bridge system and register tools in the given registry.
 *
 * - Loads config from global (~/.huu/mcp.json) and project (.huu/mcp.json)
 * - Creates client manager with lazy/eager lifecycle
 * - Registers the mcp_proxy tool for on-demand discovery
 * - Registers direct tools as individual tool definitions
 */
export async function initMcpBridge(
  registry: ToolRegistry,
  projectRoot?: string | undefined,
): Promise<McpBridgeSystem> {
  const config = loadMcpConfig(projectRoot);
  const manager = new McpClientManager(config.mcpServers, config.settings);
  const cache = new McpToolCache();
  const bridge = new McpBridge(manager, cache, config.settings, config.mcpServers);

  // Register the proxy tool
  registry.register(createMcpProxyTool(manager, bridge, cache));

  // Register direct tools
  const directTools = await bridge.getDirectToolDefinitions();
  for (const tool of directTools) {
    registry.register(tool);
  }

  // Connect eager servers
  await manager.connectEagerServers();

  return { manager, bridge, cache };
}
