export {
  MODEL_CATALOG,
  calculateCostBenefit,
  rankModelsByCostBenefit,
  getModelsForRole,
  getDefaultModelForRole,
  findModelById,
  formatModelOption,
} from './catalog.js';

export type {
  ModelEntry,
  ModelPricing,
  ModelBenchmarks,
  ModelTier,
  ModelConfidence,
  ToolCallingQuality,
  AgentRole,
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
