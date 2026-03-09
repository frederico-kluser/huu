export { WorktreeManager, WorktreeError, parseWorktreePorcelain } from './WorktreeManager.js';
export { MergeManager, MergeError } from './MergeManager.js';
export type {
  MergeRequest,
  MergeExecutionResult,
  PreMergeCheckResult,
  MergeManagerOptions,
} from './MergeManager.js';
export type {
  WorktreeInfo,
  CreateWorktreeOptions,
  RemoveWorktreeOptions,
  PruneOptions,
  NodeModulesStrategy,
  RawWorktreeRecord,
} from './types.js';

// ── Stale Cleanup (5.2.2) ────────────────────────────────────────
export type {
  CleanupAction,
  CleanupDecision,
  WorktreeCleanupCandidate,
  CleanupReport,
  CleanupResult,
  CleanupConfig,
} from './cleanup.js';

export {
  DEFAULT_CLEANUP_CONFIG,
  decideCleanup,
  isProcessAlive as isProcessAliveCleanup,
  hasUncommittedChanges,
  hasUnmergedCommits,
  WorktreeCleanup,
} from './cleanup.js';
