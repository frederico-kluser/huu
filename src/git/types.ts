export interface WorktreeInfo {
  agentId: string;
  path: string;
  branch?: string | undefined;
  head?: string | undefined;
  detached: boolean;
  locked: boolean;
  lockReason?: string | undefined;
  prunable: boolean;
  prunableReason?: string | undefined;
  bare: boolean;
}

export interface CreateWorktreeOptions {
  lock?: boolean | undefined;
  lockReason?: string | undefined;
  nodeModulesStrategy?: NodeModulesStrategy | undefined;
}

export interface RemoveWorktreeOptions {
  force?: boolean | undefined;
  deleteBranch?: boolean | undefined;
  forceDeleteBranch?: boolean | undefined;
}

export interface PruneOptions {
  dryRun?: boolean | undefined;
  expire?: string | undefined;
}

export type NodeModulesStrategy =
  | 'none'
  | 'symlink-root'
  | 'copy-on-write'
  | 'pnpm-store';

export interface RawWorktreeRecord {
  path: string;
  head?: string | undefined;
  branch?: string | undefined;
  detached: boolean;
  locked: boolean;
  lockReason?: string | undefined;
  prunable: boolean;
  prunableReason?: string | undefined;
  bare: boolean;
}
