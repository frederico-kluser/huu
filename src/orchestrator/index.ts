// Showrunner orchestrator — Beat Sheet Engine + Orchestrator Loop

// ── Beat Sheet Model & DAG ──────────────────────────────────────────
export type {
  BeatTaskStatus,
  ActType,
  EffortLevel,
  CheckpointStateValue,
  CheckpointState,
  AtomicTask,
  SequenceNode,
  ActNode,
  BeatSheet,
  ValidationResult,
  DecompositionInput,
} from './beatsheet.js';

export {
  BEAT_TASK_STATUSES,
  ACT_TYPES,
  EFFORT_LEVELS,
  CHECKPOINT_STATES,
  BeatSheetValidationError,
  CycleDetectedError,
  validateBeatSheet,
  assertValidBeatSheet,
  normalizeBeatSheet,
  collectTasks,
  buildAdjacencyList,
  detectCycle,
  topologicalSort,
  computeWaves,
  computeReadySet,
  buildDecompositionPrompt,
  parsePlannerResponse,
} from './beatsheet.js';

// ── Checkpoints ─────────────────────────────────────────────────────
export type {
  CheckpointName,
  CheckpointEvidence,
  CheckpointEvaluation,
  CheckpointTelemetry,
} from './checkpoints.js';

export {
  CHECKPOINT_NAMES,
  CHECKPOINT_ORDER,
  evaluateCheckpoint,
  evaluateAllCheckpoints,
  applyCheckpointResults,
  getCurrentCheckpoint,
  checkpointProgressPct,
} from './checkpoints.js';

// ── Persistence ─────────────────────────────────────────────────────
export { BeatSheetPersistence } from './beatsheet-persistence.js';

// ── Rendering ───────────────────────────────────────────────────────
export type { RenderOptions } from './beatsheet-render.js';

export {
  renderBeatSheet,
  renderBeatSheetSummary,
} from './beatsheet-render.js';

// ── Scheduler ──────────────────────────────────────────────────────
export type { TaskAssignment, SchedulerContext } from './scheduler.js';

export {
  schedule,
  scoreAssignment,
  inferTaskRole,
  hasCapacity,
  hasRoleCapacity,
  updateReadySince,
} from './scheduler.js';

// ── Monitor ────────────────────────────────────────────────────────
export type {
  PollResult,
  MonitorOptions,
  ClassifiedMessages,
} from './monitor.js';

export {
  OrchestratorMonitor,
  classifyMessages,
  parsePayload,
} from './monitor.js';

// ── Health ─────────────────────────────────────────────────────────
export type {
  HealthStatus,
  AgentHealthReport,
  HealthCheckResult,
  HealthConfig,
  BackpressureConfig,
} from './health.js';

export {
  HealthChecker,
  computeBackoffMs,
  updateHeartbeat,
  computeLoopDelay,
} from './health.js';

// ── Escalations ────────────────────────────────────────────────────
export type {
  EscalationInput,
  EscalationAction,
} from './escalations.js';

export {
  classifyEscalation,
  determineAction,
  EscalationManager,
} from './escalations.js';

// ── Orchestrator Loop ──────────────────────────────────────────────
export type {
  LoopDeps,
  LoopState,
  LoopEventType,
  LoopEvent,
  LoopEventHandler,
} from './loop.js';

export {
  DEFAULT_CONFIG,
  OrchestratorLoop,
} from './loop.js';
