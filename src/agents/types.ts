// ── Agent model mapping ──────────────────────────────────────────────

export type AgentModel = 'opus' | 'sonnet' | 'haiku' | 'inherit';

const MODEL_MAP: Record<AgentModel, string> = {
  opus: 'claude-opus-4-20250514',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
  inherit: 'claude-sonnet-4-5-20250929',
};

export function resolveModelId(model: AgentModel): string {
  return MODEL_MAP[model];
}

// ── Agent definition ─────────────────────────────────────────────────

export interface AgentDefinition {
  name: string;
  role: string;
  description: string;
  model: AgentModel;
  tools: string[];
  disallowedTools?: string[] | undefined;
  maxTurns?: number | undefined;
  systemPrompt: string;
}

// ── Run lifecycle ────────────────────────────────────────────────────

export const RUN_STATES = [
  'created',
  'spawning',
  'context_ready',
  'running',
  'collecting',
  'completed',
  'failed',
  'aborted',
  'cleaned',
] as const;

export type RunState = (typeof RUN_STATES)[number];

export interface AgentRunInput {
  agent: AgentDefinition;
  taskId: string;
  taskPrompt: string;
  parentRunId?: string | undefined;
  projectId: string;
  baseBranch?: string | undefined;
  timeoutMs?: number | undefined;
  parentSignal?: AbortSignal | undefined;
  keepWorktree?: boolean | undefined;
}

export interface FileChangeSummary {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}

export interface AgentRunResult {
  runId: string;
  taskId: string;
  agentName: string;
  status: 'completed' | 'failed' | 'aborted';
  summary: string;
  artifacts: string[];
  filesChanged: string[];
  fileChangeSummary: FileChangeSummary;
  commitSha: string | null;
  usage: RunUsage;
  durationMs: number;
  error?: string | undefined;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  turns: number;
}

// ── Validation ───────────────────────────────────────────────────────

export class AgentDefinitionError extends Error {
  public readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'AgentDefinitionError';
    this.field = field;
  }
}

const VALID_MODELS: readonly AgentModel[] = ['opus', 'sonnet', 'haiku', 'inherit'];

export function validateAgentDefinition(def: AgentDefinition): void {
  if (!def.name || typeof def.name !== 'string' || def.name.trim() === '') {
    throw new AgentDefinitionError(
      'Agent name must be a non-empty string',
      'name',
    );
  }

  if (!def.role || typeof def.role !== 'string' || def.role.trim() === '') {
    throw new AgentDefinitionError(
      'Agent role must be a non-empty string',
      'role',
    );
  }

  if (
    !def.systemPrompt ||
    typeof def.systemPrompt !== 'string' ||
    def.systemPrompt.trim() === ''
  ) {
    throw new AgentDefinitionError(
      'Agent systemPrompt must be a non-empty string',
      'systemPrompt',
    );
  }

  if (!VALID_MODELS.includes(def.model)) {
    throw new AgentDefinitionError(
      `Agent model must be one of: ${VALID_MODELS.join(', ')}`,
      'model',
    );
  }

  if (!Array.isArray(def.tools)) {
    throw new AgentDefinitionError('Agent tools must be an array', 'tools');
  }

  const toolSet = new Set(def.tools);
  if (toolSet.size !== def.tools.length) {
    throw new AgentDefinitionError(
      'Agent tools must not contain duplicates',
      'tools',
    );
  }

  if (def.disallowedTools !== undefined) {
    if (!Array.isArray(def.disallowedTools)) {
      throw new AgentDefinitionError(
        'Agent disallowedTools must be an array',
        'disallowedTools',
      );
    }
    const disallowedSet = new Set(def.disallowedTools);
    if (disallowedSet.size !== def.disallowedTools.length) {
      throw new AgentDefinitionError(
        'Agent disallowedTools must not contain duplicates',
        'disallowedTools',
      );
    }
  }

  if (
    def.maxTurns !== undefined &&
    (typeof def.maxTurns !== 'number' || def.maxTurns <= 0)
  ) {
    throw new AgentDefinitionError(
      'Agent maxTurns must be a positive number',
      'maxTurns',
    );
  }
}

/**
 * Compute effective tools: tools minus disallowedTools.
 * Disallowed tools always prevail.
 */
export function effectiveTools(def: AgentDefinition): string[] {
  if (!def.disallowedTools || def.disallowedTools.length === 0) {
    return [...def.tools];
  }
  const denied = new Set(def.disallowedTools);
  return def.tools.filter((t) => !denied.has(t));
}
