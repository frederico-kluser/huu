// ── OpenRouter Model Catalog ─────────────────────────────────────────
// Contains all available models with pricing, benchmarks, and cost-benefit scoring.
// Data sourced from docs/models-llm-openrouter-deep.md (March 2026).

// ── Types ────────────────────────────────────────────────────────────

export interface ModelPricing {
  /** Cost per million input tokens (USD) */
  input: number;
  /** Cost per million output tokens (USD) */
  output: number;
}

export interface ModelBenchmarks {
  /** SWE-Bench Verified score (0-100), null if unknown */
  sweBenchVerified: number | null;
  /** BFCL Multi-Turn score (0-100), null if unknown */
  bfclMultiTurn: number | null;
  /** Terminal-Bench 2.0 score (0-100), null if unknown */
  terminalBench: number | null;
}

export type ToolCallingQuality = 'excellent' | 'good' | 'basic' | 'limited';
export type ModelTier = 'premium' | 'standard' | 'economy';
export type ModelConfidence = 'high' | 'medium-high' | 'medium' | 'medium-low' | 'low';

export interface ModelEntry {
  /** OpenRouter model ID (e.g., "anthropic/claude-sonnet-4.5") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider name */
  provider: string;
  /** Pricing per MTok */
  pricing: ModelPricing;
  /** Context window size in tokens */
  contextWindow: number;
  /** Benchmark scores */
  benchmarks: ModelBenchmarks;
  /** Tool calling quality rating */
  toolCalling: ToolCallingQuality;
  /** Model tier classification */
  tier: ModelTier;
  /** Confidence level based on production evidence */
  confidence: ModelConfidence;
  /** Whether the model supports extended thinking/reasoning */
  reasoning: boolean;
}

// ── Agent Roles ──────────────────────────────────────────────────────

export type AgentRole =
  | 'orchestrator'
  | 'planner'
  | 'builder'
  | 'tester'
  | 'reviewer'
  | 'researcher'
  | 'merger'
  | 'refactorer'
  | 'doc-writer'
  | 'debugger'
  | 'context-curator';

// ── Model Catalog ────────────────────────────────────────────────────

export const MODEL_CATALOG: ModelEntry[] = [
  // ── Premium Tier ──────────────────────────────────────────────────
  {
    id: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4.6',
    provider: 'Anthropic',
    pricing: { input: 5.00, output: 25.00 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: 80.8, bfclMultiTurn: 63.3, terminalBench: 74.7 },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    pricing: { input: 3.00, output: 15.00 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: 77.2, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    pricing: { input: 3.00, output: 15.00 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: 79.6, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'google/gemini-2.5-pro-preview-03-25',
    name: 'Gemini 3.1 Pro',
    provider: 'Google',
    pricing: { input: 2.00, output: 12.00 },
    contextWindow: 1_050_000,
    benchmarks: { sweBenchVerified: 80.6, bfclMultiTurn: null, terminalBench: 78.4 },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'openai/gpt-5.2',
    name: 'GPT-5.2',
    provider: 'OpenAI',
    pricing: { input: 1.75, output: 14.00 },
    contextWindow: 400_000,
    benchmarks: { sweBenchVerified: 80.0, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },

  // ── Standard Tier ─────────────────────────────────────────────────
  {
    id: 'minimax/minimax-m2.5',
    name: 'MiniMax M2.5',
    provider: 'MiniMax',
    pricing: { input: 0.30, output: 1.10 },
    contextWindow: 197_000,
    benchmarks: { sweBenchVerified: 80.2, bfclMultiTurn: 76.8, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'medium-high',
    reasoning: true,
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    pricing: { input: 1.00, output: 5.00 },
    contextWindow: 200_000,
    benchmarks: { sweBenchVerified: 73.3, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3.2',
    provider: 'DeepSeek',
    pricing: { input: 0.25, output: 0.40 },
    contextWindow: 164_000,
    benchmarks: { sweBenchVerified: 73.0, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'good',
    tier: 'standard',
    confidence: 'medium',
    reasoning: true,
  },
  {
    id: 'moonshot/kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'Moonshot AI',
    pricing: { input: 0.60, output: 3.00 },
    contextWindow: 262_000,
    benchmarks: { sweBenchVerified: 76.8, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'medium',
    reasoning: true,
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    pricing: { input: 2.00, output: 8.00 },
    contextWindow: 1_050_000,
    benchmarks: { sweBenchVerified: 54.6, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'high',
    reasoning: false,
  },
  {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    provider: 'OpenAI',
    pricing: { input: 1.25, output: 10.00 },
    contextWindow: 400_000,
    benchmarks: { sweBenchVerified: 75.0, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'high',
    reasoning: true,
  },

  // ── Economy Tier ──────────────────────────────────────────────────
  {
    id: 'google/gemini-2.5-flash-preview',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    pricing: { input: 0.30, output: 2.50 },
    contextWindow: 1_050_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'economy',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'google/gemini-2.5-flash-lite-preview',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'Google',
    pricing: { input: 0.10, output: 0.40 },
    contextWindow: 1_050_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium',
    reasoning: false,
  },
  {
    id: 'openai/gpt-5-mini',
    name: 'GPT-5 Mini',
    provider: 'OpenAI',
    pricing: { input: 0.25, output: 2.00 },
    contextWindow: 400_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium',
    reasoning: true,
  },
  {
    id: 'openai/gpt-4.1-nano',
    name: 'GPT-4.1 Nano',
    provider: 'OpenAI',
    pricing: { input: 0.10, output: 0.40 },
    contextWindow: 1_050_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'basic',
    tier: 'economy',
    confidence: 'medium',
    reasoning: false,
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    provider: 'Google',
    pricing: { input: 0.25, output: 1.50 },
    contextWindow: 1_050_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium',
    reasoning: true,
  },
];

// ── Cost-Benefit Algorithm ───────────────────────────────────────────

export interface CostBenefitScore {
  /** Model entry */
  model: ModelEntry;
  /** Normalized SWE-Bench score (0-1), 0 if unknown */
  normalizedScore: number;
  /** Blended cost per MTok (weighted: 30% input + 70% output) */
  blendedCostPerMTok: number;
  /** Cost-benefit ratio: score / cost (higher = better value) */
  costBenefitRatio: number;
  /** Human-readable cost-benefit label */
  label: string;
}

/**
 * Calculate cost-benefit score for a model.
 *
 * Formula:
 *   blendedCost = 0.30 * inputCost + 0.70 * outputCost
 *   normalizedScore = sweBenchVerified / 100 (or 0.5 default if unknown)
 *   costBenefitRatio = normalizedScore / blendedCost
 *
 * Output-weighted 70/30 because agents produce more output tokens than input
 * in typical coding workflows (tool calls, code generation).
 */
export function calculateCostBenefit(model: ModelEntry): CostBenefitScore {
  const normalizedScore = model.benchmarks.sweBenchVerified !== null
    ? model.benchmarks.sweBenchVerified / 100
    : 0.5; // Conservative default for models without SWE-Bench data

  const blendedCostPerMTok =
    0.30 * model.pricing.input + 0.70 * model.pricing.output;

  // Avoid division by zero
  const costBenefitRatio = blendedCostPerMTok > 0
    ? normalizedScore / blendedCostPerMTok
    : 0;

  return {
    model,
    normalizedScore,
    blendedCostPerMTok,
    costBenefitRatio,
    label: formatCostBenefitLabel(costBenefitRatio),
  };
}

function formatCostBenefitLabel(ratio: number): string {
  if (ratio >= 2.0) return 'Exceptional';
  if (ratio >= 1.0) return 'Excellent';
  if (ratio >= 0.5) return 'Good';
  if (ratio >= 0.1) return 'Fair';
  return 'Premium';
}

/**
 * Rank all models by cost-benefit ratio (descending).
 */
export function rankModelsByCostBenefit(): CostBenefitScore[] {
  return MODEL_CATALOG
    .map(calculateCostBenefit)
    .sort((a, b) => b.costBenefitRatio - a.costBenefitRatio);
}

/**
 * Get models suitable for a specific agent role, ranked by cost-benefit.
 * Filters based on minimum requirements per role (tool calling, benchmarks, etc).
 */
export function getModelsForRole(role: AgentRole): CostBenefitScore[] {
  const requirements = ROLE_REQUIREMENTS[role];
  return rankModelsByCostBenefit().filter((scored) => {
    const m = scored.model;

    // Tool calling quality check
    if (!meetsToolCallingReq(m.toolCalling, requirements.minToolCalling)) {
      return false;
    }

    // Context window check
    if (m.contextWindow < requirements.minContext) {
      return false;
    }

    // SWE-Bench minimum (if required)
    if (
      requirements.minSweBench !== null &&
      m.benchmarks.sweBenchVerified !== null &&
      m.benchmarks.sweBenchVerified < requirements.minSweBench
    ) {
      return false;
    }

    // Reasoning requirement
    if (requirements.requiresReasoning && !m.reasoning) {
      return false;
    }

    return true;
  });
}

/**
 * Get the recommended default model for each agent role.
 * Based on the tiering analysis from docs/models-llm-openrouter-deep.md.
 */
export function getDefaultModelForRole(role: AgentRole): string {
  return DEFAULT_MODELS[role];
}

/**
 * Look up a model by its OpenRouter ID.
 */
export function findModelById(id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/**
 * Format model info for display in TUI selection.
 */
export function formatModelOption(scored: CostBenefitScore): string {
  const m = scored.model;
  const swe = m.benchmarks.sweBenchVerified !== null
    ? `${m.benchmarks.sweBenchVerified}%`
    : 'N/A';
  const cost = `$${scored.blendedCostPerMTok.toFixed(2)}/MTok`;
  return `${m.name} — SWE: ${swe} | ${cost} | CB: ${scored.label}`;
}

// ── Role Requirements ────────────────────────────────────────────────

interface RoleRequirements {
  minToolCalling: ToolCallingQuality;
  minContext: number;
  minSweBench: number | null;
  requiresReasoning: boolean;
}

const ROLE_REQUIREMENTS: Record<AgentRole, RoleRequirements> = {
  orchestrator: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: true,
  },
  planner: {
    minToolCalling: 'good',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: true,
  },
  builder: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: false,
  },
  tester: {
    minToolCalling: 'excellent',
    minContext: 100_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  reviewer: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: true,
  },
  researcher: {
    minToolCalling: 'good',
    minContext: 200_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  merger: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  refactorer: {
    minToolCalling: 'good',
    minContext: 100_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  'doc-writer': {
    minToolCalling: 'good',
    minContext: 100_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  debugger: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: true,
  },
  'context-curator': {
    minToolCalling: 'good',
    minContext: 100_000,
    minSweBench: null,
    requiresReasoning: false,
  },
};

// ── Default Model Assignments ────────────────────────────────────────
// Based on the optimized tiering from docs/models-llm-openrouter-deep.md

const DEFAULT_MODELS: Record<AgentRole, string> = {
  // Tier Critical — Strategic decisions
  orchestrator: 'anthropic/claude-sonnet-4.5',
  reviewer: 'anthropic/claude-opus-4',
  debugger: 'google/gemini-2.5-pro-preview-03-25',

  // Tier Principal — Development engine
  planner: 'anthropic/claude-sonnet-4.5',
  builder: 'anthropic/claude-sonnet-4',
  tester: 'minimax/minimax-m2.5',
  merger: 'openai/gpt-4.1',

  // Tier Economy — High volume
  researcher: 'google/gemini-2.5-flash-preview',
  refactorer: 'deepseek/deepseek-chat',
  'doc-writer': 'google/gemini-3.1-flash-lite',
  'context-curator': 'google/gemini-2.5-flash-lite-preview',
};

// ── Helpers ──────────────────────────────────────────────────────────

const TOOL_CALLING_RANK: Record<ToolCallingQuality, number> = {
  excellent: 4,
  good: 3,
  basic: 2,
  limited: 1,
};

function meetsToolCallingReq(
  actual: ToolCallingQuality,
  minimum: ToolCallingQuality,
): boolean {
  return TOOL_CALLING_RANK[actual] >= TOOL_CALLING_RANK[minimum];
}
