// Public API for the audit system (4.3)

export { AuditLogger } from './logger.js';

export { sanitizeParams, hashParams, summarizeResult, computeEntryHash } from './sanitizer.js';

export { evaluateRiskRules, scoreSeverity } from './detector.js';

export { calculateEventCost, lookupPricing, getCostBySession, getCostByAgent, getCostByFeature, getCostByAgentModelPhase } from './cost.js';

export {
  getSessionTimeline,
  getTopRiskEvents,
  getTopCostEvents,
  detectLoops,
  detectCostAnomalies,
  getFailedToolsSummary,
  getEventsByTrace,
  getEventCountsByType,
  getP95Duration,
  getHighRiskEvents,
} from './queries.js';

export { generateReport, renderMarkdown, saveReport, generateAndSaveReport } from './reporter.js';

export type {
  AuditEvent,
  AuditEventType,
  CreateAuditEventParams,
  RiskFlag,
  FlagCode,
  RiskRule,
  RiskRuleContext,
  RiskSeverity,
  ModelPricing,
  CostBySession,
  CostByAgent,
  CostByFeature,
  CostByAgentModelPhase,
  AuditReportData,
  AuditReportKpis,
  TimelineEntry,
  HashChainVerification,
} from './types.js';
