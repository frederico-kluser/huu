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
