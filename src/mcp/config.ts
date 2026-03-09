import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { McpConfig, McpGlobalSettings, McpServerConfig, TransportType, LifecycleMode } from './types.js';
import { TRANSPORT_TYPES, LIFECYCLE_MODES } from './types.js';

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: McpGlobalSettings = {
  idleTimeoutMinutes: 10,
  lifecycle: 'lazy',
  toolPrefix: 'mcp',
  directTools: false,
};

// ── Config paths ────────────────────────────────────────────────────

export function getGlobalConfigPath(): string {
  return path.join(os.homedir(), '.huu', 'mcp.json');
}

export function getProjectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.huu', 'mcp.json');
}

// ── Environment variable resolution ─────────────────────────────────

function resolveEnvPlaceholders(
  record: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = value.replace(/\$\{(\w+)\}/g, (_match, envVar: string) => {
      const envValue = process.env[envVar];
      if (envValue === undefined) {
        throw new McpConfigError(
          `Environment variable "${envVar}" referenced in config key "${key}" is not set`,
        );
      }
      return envValue;
    });
  }
  return resolved;
}

// ── Validation ──────────────────────────────────────────────────────

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

function validateSettings(settings: unknown): McpGlobalSettings {
  if (settings === undefined || settings === null) {
    return { ...DEFAULT_SETTINGS };
  }

  if (typeof settings !== 'object' || Array.isArray(settings)) {
    throw new McpConfigError('"settings" must be an object');
  }

  const s = settings as Record<string, unknown>;
  const result = { ...DEFAULT_SETTINGS };

  if (s['idleTimeoutMinutes'] !== undefined) {
    if (typeof s['idleTimeoutMinutes'] !== 'number' || s['idleTimeoutMinutes'] <= 0) {
      throw new McpConfigError('"settings.idleTimeoutMinutes" must be a positive number');
    }
    result.idleTimeoutMinutes = s['idleTimeoutMinutes'];
  }

  if (s['lifecycle'] !== undefined) {
    if (!LIFECYCLE_MODES.includes(s['lifecycle'] as LifecycleMode)) {
      throw new McpConfigError(
        `"settings.lifecycle" must be one of: ${LIFECYCLE_MODES.join(', ')}`,
      );
    }
    result.lifecycle = s['lifecycle'] as LifecycleMode;
  }

  if (s['toolPrefix'] !== undefined) {
    if (typeof s['toolPrefix'] !== 'string' || s['toolPrefix'].trim() === '') {
      throw new McpConfigError('"settings.toolPrefix" must be a non-empty string');
    }
    result.toolPrefix = s['toolPrefix'];
  }

  if (s['directTools'] !== undefined) {
    if (typeof s['directTools'] !== 'boolean') {
      throw new McpConfigError('"settings.directTools" must be a boolean');
    }
    result.directTools = s['directTools'];
  }

  return result;
}

function validateServerConfig(
  serverId: string,
  raw: unknown,
): McpServerConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new McpConfigError(`Server "${serverId}" config must be an object`);
  }

  const s = raw as Record<string, unknown>;

  // transport
  if (!s['transport'] || !TRANSPORT_TYPES.includes(s['transport'] as TransportType)) {
    throw new McpConfigError(
      `Server "${serverId}": "transport" must be one of: ${TRANSPORT_TYPES.join(', ')}`,
    );
  }
  const transport = s['transport'] as TransportType;

  // stdio validation
  if (transport === 'stdio') {
    if (!s['command'] || typeof s['command'] !== 'string' || s['command'].trim() === '') {
      throw new McpConfigError(
        `Server "${serverId}": stdio transport requires a non-empty "command"`,
      );
    }
    if (s['args'] !== undefined && !Array.isArray(s['args'])) {
      throw new McpConfigError(`Server "${serverId}": "args" must be an array`);
    }
    if (s['cwd'] !== undefined) {
      if (typeof s['cwd'] !== 'string') {
        throw new McpConfigError(`Server "${serverId}": "cwd" must be a string`);
      }
      if (!fs.existsSync(s['cwd'])) {
        throw new McpConfigError(
          `Server "${serverId}": "cwd" directory does not exist: ${s['cwd'] as string}`,
        );
      }
    }
  }

  // http validation
  if (transport === 'http') {
    if (!s['url'] || typeof s['url'] !== 'string') {
      throw new McpConfigError(
        `Server "${serverId}": http transport requires a "url"`,
      );
    }
    try {
      new URL(s['url']);
    } catch {
      throw new McpConfigError(
        `Server "${serverId}": "url" is not a valid URL: ${s['url'] as string}`,
      );
    }
  }

  // lifecycle
  if (
    s['lifecycle'] !== undefined &&
    !LIFECYCLE_MODES.includes(s['lifecycle'] as LifecycleMode)
  ) {
    throw new McpConfigError(
      `Server "${serverId}": "lifecycle" must be one of: ${LIFECYCLE_MODES.join(', ')}`,
    );
  }

  // idleTimeoutMinutes
  if (
    s['idleTimeoutMinutes'] !== undefined &&
    (typeof s['idleTimeoutMinutes'] !== 'number' || s['idleTimeoutMinutes'] <= 0)
  ) {
    throw new McpConfigError(
      `Server "${serverId}": "idleTimeoutMinutes" must be a positive number`,
    );
  }

  // directTools
  if (s['directTools'] !== undefined) {
    if (
      typeof s['directTools'] !== 'boolean' &&
      !Array.isArray(s['directTools'])
    ) {
      throw new McpConfigError(
        `Server "${serverId}": "directTools" must be boolean or string[]`,
      );
    }
    if (
      Array.isArray(s['directTools']) &&
      !s['directTools'].every((t: unknown) => typeof t === 'string')
    ) {
      throw new McpConfigError(
        `Server "${serverId}": "directTools" array items must be strings`,
      );
    }
  }

  // env
  if (s['env'] !== undefined && (typeof s['env'] !== 'object' || s['env'] === null || Array.isArray(s['env']))) {
    throw new McpConfigError(`Server "${serverId}": "env" must be an object`);
  }

  // headers
  if (s['headers'] !== undefined && (typeof s['headers'] !== 'object' || s['headers'] === null || Array.isArray(s['headers']))) {
    throw new McpConfigError(`Server "${serverId}": "headers" must be an object`);
  }

  return {
    transport,
    command: s['command'] as string | undefined,
    args: s['args'] as string[] | undefined,
    cwd: s['cwd'] as string | undefined,
    url: s['url'] as string | undefined,
    headers: s['headers'] as Record<string, string> | undefined,
    env: s['env'] as Record<string, string> | undefined,
    lifecycle: s['lifecycle'] as LifecycleMode | undefined,
    idleTimeoutMinutes: s['idleTimeoutMinutes'] as number | undefined,
    directTools: s['directTools'] as boolean | string[] | undefined,
  };
}

// ── Load and merge ──────────────────────────────────────────────────

function loadConfigFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new McpConfigError(`Failed to parse JSON config: ${filePath}`);
  }
}

function parseRawConfig(raw: unknown, source: string): McpConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new McpConfigError(`Config file ${source} must be a JSON object`);
  }

  const obj = raw as Record<string, unknown>;
  const settings = validateSettings(obj['settings']);
  const servers: Record<string, McpServerConfig> = {};

  if (obj['mcpServers'] !== undefined) {
    if (typeof obj['mcpServers'] !== 'object' || obj['mcpServers'] === null || Array.isArray(obj['mcpServers'])) {
      throw new McpConfigError(`"mcpServers" in ${source} must be an object`);
    }
    for (const [id, serverRaw] of Object.entries(obj['mcpServers'] as Record<string, unknown>)) {
      servers[id] = validateServerConfig(id, serverRaw);
    }
  }

  return { settings, mcpServers: servers };
}

function mergeConfigs(global: McpConfig, project: McpConfig): McpConfig {
  return {
    settings: { ...global.settings, ...project.settings },
    mcpServers: { ...global.mcpServers, ...project.mcpServers },
  };
}

export function loadMcpConfig(projectRoot?: string | undefined): McpConfig {
  const globalPath = getGlobalConfigPath();
  const globalRaw = loadConfigFile(globalPath);

  const globalConfig = globalRaw
    ? parseRawConfig(globalRaw, globalPath)
    : { settings: { ...DEFAULT_SETTINGS }, mcpServers: {} };

  if (!projectRoot) return globalConfig;

  const projectPath = getProjectConfigPath(projectRoot);
  const projectRaw = loadConfigFile(projectPath);

  if (!projectRaw) return globalConfig;

  const projectConfig = parseRawConfig(projectRaw, projectPath);
  return mergeConfigs(globalConfig, projectConfig);
}

// ── Resolve env for a server ────────────────────────────────────────

export function resolveServerEnv(
  config: McpServerConfig,
): Record<string, string> | undefined {
  if (!config.env) return undefined;
  return resolveEnvPlaceholders(config.env);
}

export function resolveServerHeaders(
  config: McpServerConfig,
): Record<string, string> | undefined {
  if (!config.headers) return undefined;
  return resolveEnvPlaceholders(config.headers);
}

// ── Effective server settings ───────────────────────────────────────

export function getServerLifecycle(
  server: McpServerConfig,
  settings: McpGlobalSettings,
): LifecycleMode {
  return server.lifecycle ?? settings.lifecycle;
}

export function getServerIdleTimeoutMs(
  server: McpServerConfig,
  settings: McpGlobalSettings,
): number {
  const minutes = server.idleTimeoutMinutes ?? settings.idleTimeoutMinutes;
  return minutes * 60 * 1000;
}

export function getServerDirectTools(
  server: McpServerConfig,
  settings: McpGlobalSettings,
): boolean | string[] {
  return server.directTools ?? settings.directTools;
}
