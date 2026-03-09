export {
  MODEL_CATALOG,
  calculateCostBenefit,
  rankModelsByCostBenefit,
  getModelsForRole,
  getAllModelsForRole,
  getDefaultModelForRole,
  isModelRecommendedForRole,
  findModelById,
  formatModelOption,
  AGENT_ROLE_INFO,
} from './catalog.js';

export type {
  ModelEntry,
  ModelPricing,
  ModelBenchmarks,
  ModelTier,
  ModelConfidence,
  ToolCallingQuality,
  AgentRole,
  AgentRoleInfo,
  CostBenefitScore,
} from './catalog.js';

export {
  createOpenRouterClient,
  validateOpenRouterKey,
  verifyOpenRouterKey,
  chatCompletion,
} from './openrouter.js';

export type {
  ToolDefinition,
  ChatMessage,
  ToolCall,
  ChatCompletionResult,
} from './openrouter.js';
