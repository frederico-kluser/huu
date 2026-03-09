// Memory & Learning — Typed configuration with defaults and per-project overrides

export interface ObservationConfig {
  enabled: boolean;
  preToolHook: boolean;
  postToolHook: boolean;
  sanitizePii: boolean;
}

export interface AnalysisConfig {
  model: string;
  minObservations: number;
  minUniqueSessions: number;
  cooldownMinutes: number;
  maxCandidatesPerRun: number;
}

export interface InstinctConfig {
  confidenceMin: number;
  confidenceMax: number;
  reinforceDelta: number;
  contradictionDelta: number;
  decayHalfLifeDays: number;
  deleteBelow: number;
}

export interface PromotionConfig {
  minConfidence: number;
  minSupportingSessions: number;
  minSupportingObservations: number;
  requireHumanApproval: boolean;
}

export interface SessionsConfig {
  summaryModel: string;
  loadWindowDays: number;
  maxSummariesToLoad: number;
}

export interface MemoryLearningConfig {
  observation: ObservationConfig;
  analysis: AnalysisConfig;
  instinct: InstinctConfig;
  promotion: PromotionConfig;
  sessions: SessionsConfig;
}

export const DEFAULT_MEMORY_CONFIG: MemoryLearningConfig = {
  observation: {
    enabled: true,
    preToolHook: true,
    postToolHook: true,
    sanitizePii: true,
  },
  analysis: {
    model: 'haiku',
    minObservations: 20,
    minUniqueSessions: 3,
    cooldownMinutes: 15,
    maxCandidatesPerRun: 10,
  },
  instinct: {
    confidenceMin: 0.30,
    confidenceMax: 0.85,
    reinforceDelta: 0.04,
    contradictionDelta: 0.08,
    decayHalfLifeDays: 14,
    deleteBelow: 0.20,
  },
  promotion: {
    minConfidence: 0.78,
    minSupportingSessions: 5,
    minSupportingObservations: 50,
    requireHumanApproval: false,
  },
  sessions: {
    summaryModel: 'haiku',
    loadWindowDays: 7,
    maxSummariesToLoad: 20,
  },
};

/** Merge partial user config over defaults. */
export function resolveMemoryConfig(
  overrides?: Partial<MemoryLearningConfig>,
): MemoryLearningConfig {
  if (!overrides) return { ...DEFAULT_MEMORY_CONFIG };
  return {
    observation: { ...DEFAULT_MEMORY_CONFIG.observation, ...overrides.observation },
    analysis: { ...DEFAULT_MEMORY_CONFIG.analysis, ...overrides.analysis },
    instinct: { ...DEFAULT_MEMORY_CONFIG.instinct, ...overrides.instinct },
    promotion: { ...DEFAULT_MEMORY_CONFIG.promotion, ...overrides.promotion },
    sessions: { ...DEFAULT_MEMORY_CONFIG.sessions, ...overrides.sessions },
  };
}
