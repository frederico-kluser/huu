// Memory & Learning — Phase 4.2
//
// Closed learning loop:
// observe -> analyze -> instinct -> reinforce/decay -> promote -> session summary -> context load

export { DEFAULT_MEMORY_CONFIG, resolveMemoryConfig } from './config.js';
export type { MemoryLearningConfig, ObservationConfig, AnalysisConfig, InstinctConfig, PromotionConfig, SessionsConfig } from './config.js';

export { Observer, sanitize } from './observer.js';
export type { ToolPreEvent, ToolPostEvent } from './observer.js';

export { Analyzer } from './analyzer.js';
export type { AnalysisWindow, ToolStats, InstinctCandidate } from './analyzer.js';

export { InstinctManager, computeInitialConfidence, applyDecay } from './instincts.js';
export type { InstinctEvent } from './instincts.js';

export { PromotionPipeline } from './promotion.js';
export type { PromotionResult } from './promotion.js';

export { SessionSummarizer } from './sessions.js';
export type { SessionSummaryJson } from './sessions.js';

export { ContextLoader } from './context-loader.js';
export type { MemoryContext, RankedSession } from './context-loader.js';
