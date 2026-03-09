// Config schema, validation, and I/O for .huu/config.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { errors, CliError } from './errors.js';

// ── Config schema ────────────────────────────────────────────────────

export const CONFIG_VERSION = 2;
export const CONFIG_FILENAME = 'config.json';
export const HUU_DIR = '.huu';
export const DB_FILENAME = 'huu.db';

export interface AgentModelConfig {
  orchestrator: string;
  planner: string;
  builder: string;
  tester: string;
  reviewer: string;
  researcher: string;
  merger: string;
  refactorer: string;
  'doc-writer': string;
  debugger: string;
  'context-curator': string;
}

export interface HuuConfig {
  version: number;
  projectRoot: string;
  database: {
    path: string;
    journalMode: 'WAL';
  };
  orchestrator: {
    maxConcurrency: number;
    /** @deprecated Use agentModels instead */
    defaultAgentModel: {
      orchestrator: string;
      worker: string;
      support: string;
    };
    /** Per-agent OpenRouter model IDs */
    agentModels: AgentModelConfig;
  };
  logging: {
    level: string;
  };
}

// ── All agent role names ─────────────────────────────────────────────

export const AGENT_ROLES = [
  'orchestrator',
  'planner',
  'builder',
  'tester',
  'reviewer',
  'researcher',
  'merger',
  'refactorer',
  'doc-writer',
  'debugger',
  'context-curator',
] as const;

export type AgentRoleName = (typeof AGENT_ROLES)[number];

// ── Default model assignments (from docs/models-llm-openrouter-deep.md) ──

export const DEFAULT_AGENT_MODELS: AgentModelConfig = {
  // Tier Critical
  orchestrator: 'moonshot/kimi-k2.5',
  reviewer: 'moonshot/kimi-k2.5',
  debugger: 'moonshot/kimi-k2.5',
  // Tier Principal
  planner: 'moonshot/kimi-k2.5',
  builder: 'moonshot/kimi-k2.5',
  tester: 'moonshot/kimi-k2.5',
  merger: 'moonshot/kimi-k2.5',
  // Tier Economy
  researcher: 'moonshot/kimi-k2.5',
  refactorer: 'deepseek/deepseek-chat',
  'doc-writer': 'deepseek/deepseek-chat',
  'context-curator': 'deepseek/deepseek-chat',
};

// ── Defaults ─────────────────────────────────────────────────────────

export function createDefaultConfig(): HuuConfig {
  return {
    version: CONFIG_VERSION,
    projectRoot: '.',
    database: {
      path: `${HUU_DIR}/${DB_FILENAME}`,
      journalMode: 'WAL',
    },
    orchestrator: {
      maxConcurrency: 5,
      defaultAgentModel: {
        orchestrator: 'opus',
        worker: 'sonnet',
        support: 'haiku',
      },
      agentModels: { ...DEFAULT_AGENT_MODELS },
    },
    logging: {
      level: 'notice',
    },
  };
}

// ── Validation ───────────────────────────────────────────────────────

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_LEGACY_MODELS = ['opus', 'sonnet', 'haiku'];
const VALID_LOG_LEVELS = ['quiet', 'notice', 'info', 'debug', 'trace'];

function isValidOpenRouterModelId(id: unknown): boolean {
  return typeof id === 'string' && id.includes('/') && id.length > 3;
}

export function validateConfig(config: unknown): ConfigValidationResult {
  const errs: string[] = [];

  if (config === null || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be a JSON object'] };
  }

  const c = config as Record<string, unknown>;

  // version
  if (typeof c['version'] !== 'number' || c['version'] < 1) {
    errs.push('version: must be a positive integer');
  }

  // projectRoot
  if (typeof c['projectRoot'] !== 'string' || c['projectRoot'] === '') {
    errs.push('projectRoot: must be a non-empty string');
  }

  // database
  if (c['database'] === null || typeof c['database'] !== 'object') {
    errs.push('database: must be an object');
  } else {
    const db = c['database'] as Record<string, unknown>;
    if (typeof db['path'] !== 'string' || db['path'] === '') {
      errs.push('database.path: must be a non-empty string');
    }
    if (db['journalMode'] !== 'WAL') {
      errs.push('database.journalMode: must be "WAL"');
    }
  }

  // orchestrator
  if (c['orchestrator'] === null || typeof c['orchestrator'] !== 'object') {
    errs.push('orchestrator: must be an object');
  } else {
    const orch = c['orchestrator'] as Record<string, unknown>;
    if (
      typeof orch['maxConcurrency'] !== 'number' ||
      orch['maxConcurrency'] < 1 ||
      orch['maxConcurrency'] > 20
    ) {
      errs.push('orchestrator.maxConcurrency: must be between 1 and 20');
    }

    // Legacy defaultAgentModel (backward compatibility)
    if (
      orch['defaultAgentModel'] !== null &&
      orch['defaultAgentModel'] !== undefined &&
      typeof orch['defaultAgentModel'] === 'object'
    ) {
      const models = orch['defaultAgentModel'] as Record<string, unknown>;
      for (const role of ['orchestrator', 'worker', 'support'] as const) {
        if (
          typeof models[role] !== 'string' ||
          !VALID_LEGACY_MODELS.includes(models[role] as string)
        ) {
          errs.push(
            `orchestrator.defaultAgentModel.${role}: must be one of ${VALID_LEGACY_MODELS.join(', ')}`,
          );
        }
      }
    }

    // New per-agent model configuration
    if (orch['agentModels'] !== null && orch['agentModels'] !== undefined) {
      if (typeof orch['agentModels'] !== 'object') {
        errs.push('orchestrator.agentModels: must be an object');
      } else {
        const agentModels = orch['agentModels'] as Record<string, unknown>;
        for (const role of AGENT_ROLES) {
          const modelId = agentModels[role];
          if (modelId !== undefined && !isValidOpenRouterModelId(modelId)) {
            errs.push(
              `orchestrator.agentModels.${role}: must be a valid OpenRouter model ID (e.g., "anthropic/claude-sonnet-4")`,
            );
          }
        }
      }
    }
  }

  // logging
  if (c['logging'] === null || typeof c['logging'] !== 'object') {
    errs.push('logging: must be an object');
  } else {
    const log = c['logging'] as Record<string, unknown>;
    if (
      typeof log['level'] !== 'string' ||
      !VALID_LOG_LEVELS.includes(log['level'] as string)
    ) {
      errs.push(
        `logging.level: must be one of ${VALID_LOG_LEVELS.join(', ')}`,
      );
    }
  }

  return { valid: errs.length === 0, errors: errs };
}

// ── I/O ──────────────────────────────────────────────────────────────

export function getConfigPath(cwd: string): string {
  return path.join(cwd, HUU_DIR, CONFIG_FILENAME);
}

export function getDbPath(cwd: string): string {
  return path.join(cwd, HUU_DIR, DB_FILENAME);
}

export function getHuuDir(cwd: string): string {
  return path.join(cwd, HUU_DIR);
}

export function configExists(cwd: string): boolean {
  return fs.existsSync(getConfigPath(cwd));
}

export function huuDirExists(cwd: string): boolean {
  return fs.existsSync(getHuuDir(cwd));
}

export function loadConfig(cwd: string): HuuConfig {
  const configPath = getConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    throw errors.configNotFound(configPath);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw errors.configNotFound(configPath);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw errors.configInvalid('config.json', 'file contains invalid JSON');
  }

  // Migrate v1 configs to v2
  const migrated = migrateConfig(parsed as Record<string, unknown>);

  const result = validateConfig(migrated);
  if (!result.valid) {
    throw errors.configInvalid('config.json', result.errors.join('; '));
  }

  return migrated as unknown as HuuConfig;
}

/**
 * Migrate older config versions to current.
 */
function migrateConfig(config: Record<string, unknown>): Record<string, unknown> {
  const version = config['version'] as number;

  // v1 → v2: add agentModels
  if (version === 1) {
    const orch = config['orchestrator'] as Record<string, unknown> | undefined;
    if (orch && !orch['agentModels']) {
      orch['agentModels'] = { ...DEFAULT_AGENT_MODELS };
    }
    config['version'] = CONFIG_VERSION;
  }

  return config;
}

/**
 * Write config atomically: write to temp file then rename.
 */
export function writeConfigAtomic(cwd: string, config: HuuConfig): void {
  const configPath = getConfigPath(cwd);
  const tmpPath = configPath + `.tmp.${crypto.randomUUID().slice(0, 8)}`;

  try {
    const json = JSON.stringify(config, null, 2) + '\n';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, configPath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    throw errors.configWriteFailed(
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

// ── Config field getters/setters ─────────────────────────────────────

type ConfigKeyPath =
  | 'orchestrator.maxConcurrency'
  | 'orchestrator.defaultAgentModel.orchestrator'
  | 'orchestrator.defaultAgentModel.worker'
  | 'orchestrator.defaultAgentModel.support'
  | `orchestrator.agentModels.${AgentRoleName}`
  | 'logging.level';

export function getConfigValue(
  config: HuuConfig,
  key: ConfigKeyPath,
): string | number {
  if (key.startsWith('orchestrator.agentModels.')) {
    const role = key.replace('orchestrator.agentModels.', '') as AgentRoleName;
    return config.orchestrator.agentModels[role];
  }

  switch (key) {
    case 'orchestrator.maxConcurrency':
      return config.orchestrator.maxConcurrency;
    case 'orchestrator.defaultAgentModel.orchestrator':
      return config.orchestrator.defaultAgentModel.orchestrator;
    case 'orchestrator.defaultAgentModel.worker':
      return config.orchestrator.defaultAgentModel.worker;
    case 'orchestrator.defaultAgentModel.support':
      return config.orchestrator.defaultAgentModel.support;
    case 'logging.level':
      return config.logging.level;
    default:
      return '';
  }
}

export function setConfigValue(
  config: HuuConfig,
  key: ConfigKeyPath,
  value: string | number,
): void {
  if (key.startsWith('orchestrator.agentModels.')) {
    const role = key.replace('orchestrator.agentModels.', '') as AgentRoleName;
    config.orchestrator.agentModels[role] = String(value);
    return;
  }

  switch (key) {
    case 'orchestrator.maxConcurrency':
      config.orchestrator.maxConcurrency = Number(value);
      break;
    case 'orchestrator.defaultAgentModel.orchestrator':
      config.orchestrator.defaultAgentModel.orchestrator = String(value);
      break;
    case 'orchestrator.defaultAgentModel.worker':
      config.orchestrator.defaultAgentModel.worker = String(value);
      break;
    case 'orchestrator.defaultAgentModel.support':
      config.orchestrator.defaultAgentModel.support = String(value);
      break;
    case 'logging.level':
      config.logging.level = String(value);
      break;
  }
}

export const CONFIGURABLE_KEYS: {
  key: ConfigKeyPath;
  label: string;
  type: 'number' | 'select' | 'model';
  options?: string[];
  min?: number;
  max?: number;
}[] = [
  {
    key: 'orchestrator.maxConcurrency',
    label: 'Max concurrent agents',
    type: 'number',
    min: 1,
    max: 20,
  },
  // Legacy model tiers (backward compatibility)
  {
    key: 'orchestrator.defaultAgentModel.orchestrator',
    label: 'Orchestrator tier (legacy)',
    type: 'select',
    options: VALID_LEGACY_MODELS,
  },
  {
    key: 'orchestrator.defaultAgentModel.worker',
    label: 'Worker tier (legacy)',
    type: 'select',
    options: VALID_LEGACY_MODELS,
  },
  {
    key: 'orchestrator.defaultAgentModel.support',
    label: 'Support tier (legacy)',
    type: 'select',
    options: VALID_LEGACY_MODELS,
  },
  // Per-agent OpenRouter model configuration
  ...AGENT_ROLES.map((role) => ({
    key: `orchestrator.agentModels.${role}` as ConfigKeyPath,
    label: `${role} model`,
    type: 'model' as const,
  })),
  {
    key: 'logging.level',
    label: 'Log level',
    type: 'select',
    options: VALID_LOG_LEVELS,
  },
];
