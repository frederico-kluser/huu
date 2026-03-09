// ── MCP Bridge types ────────────────────────────────────────────────

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';

// ── Server lifecycle states ─────────────────────────────────────────

export const SERVER_STATES = [
  'idle',
  'connecting',
  'ready',
  'closing',
  'error',
] as const;

export type ServerState = (typeof SERVER_STATES)[number];

// ── Lifecycle modes ─────────────────────────────────────────────────

export const LIFECYCLE_MODES = ['lazy', 'eager', 'keep-alive'] as const;
export type LifecycleMode = (typeof LIFECYCLE_MODES)[number];

// ── Transport types ─────────────────────────────────────────────────

export const TRANSPORT_TYPES = ['stdio', 'http'] as const;
export type TransportType = (typeof TRANSPORT_TYPES)[number];

// ── Configuration ───────────────────────────────────────────────────

export interface McpGlobalSettings {
  idleTimeoutMinutes: number;
  lifecycle: LifecycleMode;
  toolPrefix: string;
  directTools: boolean;
}

export interface McpServerConfig {
  transport: TransportType;
  // stdio fields
  command?: string | undefined;
  args?: string[] | undefined;
  cwd?: string | undefined;
  // http fields
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  // shared
  env?: Record<string, string> | undefined;
  lifecycle?: LifecycleMode | undefined;
  idleTimeoutMinutes?: number | undefined;
  directTools?: boolean | string[] | undefined;
}

export interface McpConfig {
  settings: McpGlobalSettings;
  mcpServers: Record<string, McpServerConfig>;
}

// ── Runtime state ───────────────────────────────────────────────────

export interface McpServerRuntimeState {
  serverId: string;
  config: McpServerConfig;
  state: ServerState;
  client: Client | null;
  transport: Transport | null;
  tools: McpTool[];
  connectPromise: Promise<void> | null;
  inFlightCount: number;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  errorMessage: string | null;
}

// ── Bridge tool naming ──────────────────────────────────────────────

export type BridgeToolName = `mcp/${string}/${string}`;

export function makeBridgeToolName(
  serverId: string,
  toolName: string,
): BridgeToolName {
  return `mcp/${serverId}/${toolName}` as BridgeToolName;
}

export function parseBridgeToolName(
  name: string,
): { serverId: string; toolName: string } | null {
  const match = /^mcp\/([^/]+)\/(.+)$/.exec(name);
  if (!match) return null;
  return { serverId: match[1]!, toolName: match[2]! };
}

// ── Bridge call result ──────────────────────────────────────────────

export interface BridgeCallResult {
  content: string;
  isError: boolean;
  rawContent: unknown[];
  durationMs: number;
  server: string;
  tool: string;
}

// ── Proxy action types ──────────────────────────────────────────────

export type ProxyAction =
  | { action: 'status'; server?: string | undefined }
  | { action: 'search'; query: string; server?: string | undefined }
  | { action: 'describe'; tool: string }
  | { action: 'call'; tool: string; argsJson?: string | undefined }
  | { action: 'connect'; server: string }
  | { action: 'disconnect'; server: string };

// ── Audit event ─────────────────────────────────────────────────────

export interface McpAuditEvent {
  server: string;
  tool: string;
  durationMs: number;
  status: 'success' | 'error';
  error?: string | undefined;
}

// ── Cache entry ─────────────────────────────────────────────────────

export interface CachedToolMetadata {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  cachedAt: number;
}
