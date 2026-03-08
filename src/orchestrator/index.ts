// Showrunner orchestrator — Beat Sheet Engine

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
