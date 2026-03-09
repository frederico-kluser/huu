import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type {
  McpServerConfig,
  McpServerRuntimeState,
  McpGlobalSettings,
  McpAuditEvent,
  ServerState,
} from './types.js';
import {
  resolveServerEnv,
  resolveServerHeaders,
  getServerIdleTimeoutMs,
  getServerLifecycle,
} from './config.js';

// ── Event emitter type ──────────────────────────────────────────────

export type McpEventListener = (event: McpAuditEvent) => void;

// ── MCP Client Manager ──────────────────────────────────────────────

export class McpClientManager {
  private readonly servers = new Map<string, McpServerRuntimeState>();
  private readonly settings: McpGlobalSettings;
  private readonly listeners: McpEventListener[] = [];
  private disposed = false;

  constructor(
    configs: Record<string, McpServerConfig>,
    settings: McpGlobalSettings,
  ) {
    this.settings = settings;
    for (const [serverId, config] of Object.entries(configs)) {
      this.servers.set(serverId, createRuntimeState(serverId, config));
    }
  }

  onAuditEvent(listener: McpEventListener): void {
    this.listeners.push(listener);
  }

  private emitAudit(event: McpAuditEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // non-critical
      }
    }
  }

  getServerIds(): string[] {
    return [...this.servers.keys()];
  }

  getServerState(serverId: string): McpServerRuntimeState | undefined {
    return this.servers.get(serverId);
  }

  async ensureConnected(serverId: string): Promise<McpServerRuntimeState> {
    const rt = this.servers.get(serverId);
    if (!rt) {
      throw new McpClientError(`Unknown MCP server: "${serverId}"`);
    }

    if (rt.state === 'ready' && rt.client) {
      return rt;
    }

    // Single-flight: if already connecting, wait for it
    if (rt.connectPromise) {
      await rt.connectPromise;
      if (rt.state !== 'ready') {
        throw new McpClientError(
          `Server "${serverId}" failed to connect: ${rt.errorMessage ?? 'unknown error'}`,
        );
      }
      return rt;
    }

    rt.connectPromise = this.doConnect(rt);
    try {
      await rt.connectPromise;
    } finally {
      rt.connectPromise = null;
    }

    if (rt.state !== 'ready') {
      throw new McpClientError(
        `Server "${serverId}" failed to connect: ${rt.errorMessage ?? 'unknown error'}`,
      );
    }

    return rt;
  }

  private async doConnect(rt: McpServerRuntimeState): Promise<void> {
    rt.state = 'connecting';
    rt.errorMessage = null;

    try {
      const transport = createTransport(rt.config);
      const client = new Client(
        { name: 'huu-mcp-bridge', version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport as Transport);

      rt.client = client;
      rt.transport = transport as Transport;
      rt.state = 'ready';

      // Discover tools on connect
      rt.tools = await listAllTools(client);

      // Schedule idle timer
      this.touch(rt);
    } catch (err) {
      rt.state = 'error';
      rt.errorMessage = err instanceof Error ? err.message : String(err);
      // Clean up partial state
      await safeClose(rt);
      throw err;
    }
  }

  async listTools(serverId: string): Promise<McpTool[]> {
    const rt = await this.ensureConnected(serverId);
    return rt.tools;
  }

  async refreshTools(serverId: string): Promise<McpTool[]> {
    const rt = await this.ensureConnected(serverId);
    if (!rt.client) throw new McpClientError(`Server "${serverId}" has no client`);
    rt.tools = await listAllTools(rt.client);
    return rt.tools;
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallToolResult> {
    const rt = await this.ensureConnected(serverId);
    if (!rt.client) throw new McpClientError(`Server "${serverId}" has no client`);

    rt.inFlightCount++;
    this.touch(rt);
    const startMs = Date.now();

    try {
      const result = await rt.client.callTool({
        name: toolName,
        arguments: args,
      });

      const durationMs = Date.now() - startMs;
      // Extract content for audit - handle both content array and toolResult formats
      const resultContent = (result as Record<string, unknown>)['content'] as McpResultContent[] | undefined;
      const isError = result.isError === true;

      this.emitAudit({
        server: serverId,
        tool: toolName,
        durationMs,
        status: isError ? 'error' : 'success',
        error: isError ? extractTextFromContent(resultContent) : undefined,
      });

      return {
        content: resultContent ?? [],
        isError,
        structuredContent: (result as Record<string, unknown>)['structuredContent'] as Record<string, unknown> | undefined,
      };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errMsg = err instanceof Error ? err.message : String(err);
      this.emitAudit({
        server: serverId,
        tool: toolName,
        durationMs,
        status: 'error',
        error: errMsg,
      });
      throw err;
    } finally {
      rt.inFlightCount--;
      this.touch(rt);
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const rt = this.servers.get(serverId);
    if (!rt) return;

    if (rt.inFlightCount > 0) {
      throw new McpClientError(
        `Cannot disconnect "${serverId}": ${rt.inFlightCount} requests in-flight`,
      );
    }

    await this.closeServer(rt);
  }

  async connectEagerServers(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [serverId, rt] of this.servers) {
      const lifecycle = getServerLifecycle(rt.config, this.settings);
      if (lifecycle === 'eager') {
        promises.push(
          this.ensureConnected(serverId).then(() => undefined),
        );
      }
    }
    await Promise.allSettled(promises);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const promises: Promise<void>[] = [];
    for (const rt of this.servers.values()) {
      if (rt.idleTimer) {
        clearTimeout(rt.idleTimer);
        rt.idleTimer = null;
      }
      if (rt.state === 'ready' || rt.state === 'connecting') {
        promises.push(this.closeServer(rt));
      }
    }
    await Promise.allSettled(promises);
  }

  private touch(rt: McpServerRuntimeState): void {
    rt.lastUsedAt = Date.now();
    this.scheduleIdleClose(rt);
  }

  private scheduleIdleClose(rt: McpServerRuntimeState): void {
    if (rt.idleTimer) {
      clearTimeout(rt.idleTimer);
      rt.idleTimer = null;
    }

    const lifecycle = getServerLifecycle(rt.config, this.settings);
    if (lifecycle === 'keep-alive') return;

    const idleMs = getServerIdleTimeoutMs(rt.config, this.settings);

    rt.idleTimer = setTimeout(() => {
      if (rt.inFlightCount > 0 || rt.state !== 'ready') return;
      void this.closeServer(rt);
    }, idleMs);
  }

  private async closeServer(rt: McpServerRuntimeState): Promise<void> {
    if (rt.idleTimer) {
      clearTimeout(rt.idleTimer);
      rt.idleTimer = null;
    }

    const prevState = rt.state;
    if (prevState !== 'ready' && prevState !== 'error') return;

    rt.state = 'closing';
    await safeClose(rt);
    rt.state = 'idle';
  }
}

// ── Transport factory ───────────────────────────────────────────────

// ── Result type ─────────────────────────────────────────────────────

interface McpResultContent {
  type: string;
  text?: string | undefined;
  [key: string]: unknown;
}

export interface McpCallToolResult {
  content: McpResultContent[];
  isError: boolean;
  structuredContent?: Record<string, unknown> | undefined;
}

// ── Transport factory ───────────────────────────────────────────────

function createTransport(config: McpServerConfig): StdioClientTransport | StreamableHTTPClientTransport {
  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new McpClientError('stdio transport requires a "command"');
    }
    const env = resolveServerEnv(config);
    const stdioParams: Record<string, unknown> = {
      command: config.command,
      args: config.args ?? [],
      stderr: 'pipe',
    };
    if (config.cwd) {
      stdioParams['cwd'] = config.cwd;
    }
    if (env) {
      const mergedEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) mergedEnv[k] = v;
      }
      Object.assign(mergedEnv, env);
      stdioParams['env'] = mergedEnv;
    }
    return new StdioClientTransport(stdioParams as ConstructorParameters<typeof StdioClientTransport>[0]);
  }

  if (config.transport === 'http') {
    if (!config.url) {
      throw new McpClientError('http transport requires a "url"');
    }
    const headers = resolveServerHeaders(config);
    const opts: Record<string, unknown> = {};
    if (headers) {
      opts['requestInit'] = { headers };
    }
    return new StreamableHTTPClientTransport(
      new URL(config.url),
      opts,
    );
  }

  throw new McpClientError(`Unsupported transport: ${config.transport as string}`);
}

// ── Helpers ─────────────────────────────────────────────────────────

async function listAllTools(client: Client): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);

  return tools;
}

async function safeClose(rt: McpServerRuntimeState): Promise<void> {
  try {
    await rt.client?.close();
  } catch {
    // ignore close errors
  }
  rt.client = null;
  rt.transport = null;
}

function extractTextFromContent(content: McpResultContent[] | undefined): string {
  if (!content || !Array.isArray(content)) return '';
  return content
    .filter((c) => c.type === 'text' && typeof c['text'] === 'string')
    .map((c) => c['text'] as string)
    .join('\n');
}

function createRuntimeState(
  serverId: string,
  config: McpServerConfig,
): McpServerRuntimeState {
  return {
    serverId,
    config,
    state: 'idle' as ServerState,
    client: null,
    transport: null,
    tools: [],
    connectPromise: null,
    inFlightCount: 0,
    lastUsedAt: 0,
    idleTimer: null,
    errorMessage: null,
  };
}

// ── Error class ─────────────────────────────────────────────────────

export class McpClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpClientError';
  }
}
