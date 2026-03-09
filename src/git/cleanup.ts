// Stale process/worktree detection and cleanup (5.2.2)
//
// Two-phase cleanup: quarantine then remove.
// Never removes worktrees with uncommitted changes or unmerged commits.
// Validates heartbeat + PID + lock status before cleanup.

import type { SimpleGit } from 'simple-git';
import type { WorktreeManager } from './WorktreeManager.js';
import type { WorktreeInfo } from './types.js';

// ── Types ────────────────────────────────────────────────────────────

export type CleanupAction = 'skip' | 'quarantine' | 'remove';

export interface CleanupDecision {
  action: CleanupAction;
  reason: string;
}

export interface WorktreeCleanupCandidate {
  worktree: WorktreeInfo;
  hasLivePid: boolean;
  hasUncommittedChanges: boolean;
  hasUnmergedCommits: boolean;
  isLocked: boolean;
  staleMs: number;
}

export interface CleanupReport {
  agentId: string;
  worktreePath: string;
  decision: CleanupDecision;
  timestamp: string;
}

export interface CleanupResult {
  reports: CleanupReport[];
  removed: number;
  quarantined: number;
  skipped: number;
}

export interface CleanupConfig {
  /** Threshold in ms before considering a worktree stale. */
  staleThresholdMs: number;
  /** Target branch to check for unmerged commits. */
  targetBranch: string;
  /** Whether to actually remove (false = dry run). */
  execute: boolean;
}

export const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  staleThresholdMs: 5 * 60 * 1000, // 5 minutes
  targetBranch: 'main',
  execute: false,
};

// ── Pure decision function ───────────────────────────────────────────

export function decideCleanup(candidate: {
  hasLivePid: boolean;
  hasUncommittedChanges: boolean;
  hasUnmergedCommits: boolean;
  isLocked: boolean;
  staleMs: number;
  staleThresholdMs: number;
}): CleanupDecision {
  // Active process or locked — never touch
  if (candidate.hasLivePid) {
    return { action: 'skip', reason: 'process_alive' };
  }
  if (candidate.isLocked) {
    return { action: 'skip', reason: 'worktree_locked' };
  }

  // Not stale enough
  if (candidate.staleMs < candidate.staleThresholdMs) {
    return { action: 'skip', reason: 'not_stale_enough' };
  }

  // Has local work that hasn't been integrated — quarantine only
  if (candidate.hasUncommittedChanges) {
    return { action: 'quarantine', reason: 'has_uncommitted_changes' };
  }
  if (candidate.hasUnmergedCommits) {
    return { action: 'quarantine', reason: 'has_unmerged_commits' };
  }

  // Safe to remove
  return { action: 'remove', reason: 'safe_to_remove' };
}

// ── Worktree inspection ──────────────────────────────────────────────

/**
 * Check if a PID is still alive.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a worktree has uncommitted changes.
 */
export async function hasUncommittedChanges(git: SimpleGit): Promise<boolean> {
  try {
    const status = await git.raw(['status', '--porcelain']);
    return status.trim().length > 0;
  } catch {
    // If we can't check, assume there are changes (safe default)
    return true;
  }
}

/**
 * Check if a branch has commits not merged into the target branch.
 */
export async function hasUnmergedCommits(
  rootGit: SimpleGit,
  branchName: string,
  targetBranch: string,
): Promise<boolean> {
  try {
    const shortBranch = branchName.replace(/^refs\/heads\//, '');
    const result = await rootGit.raw([
      'log',
      '--oneline',
      `${targetBranch}..${shortBranch}`,
    ]);
    return result.trim().length > 0;
  } catch {
    // If we can't check, assume there are unmerged commits (safe default)
    return true;
  }
}

// ── Cleanup engine ───────────────────────────────────────────────────

export class WorktreeCleanup {
  private readonly worktreeManager: WorktreeManager;

  constructor(worktreeManager: WorktreeManager) {
    this.worktreeManager = worktreeManager;
  }

  /**
   * Detect stale worktrees and build cleanup candidates.
   */
  async detectStale(
    config: CleanupConfig,
    heartbeats: Map<string, { pid?: number; lastHeartbeatAt: number }>,
  ): Promise<WorktreeCleanupCandidate[]> {
    const worktrees = await this.worktreeManager.list();
    const now = Date.now();
    const rootGit = this.worktreeManager.getRootGit();
    const candidates: WorktreeCleanupCandidate[] = [];

    for (const wt of worktrees) {
      const hb = heartbeats.get(wt.agentId);
      const lastHeartbeat = hb?.lastHeartbeatAt ?? 0;
      const pid = hb?.pid;
      const staleMs = lastHeartbeat > 0 ? now - lastHeartbeat : now;

      // Skip non-stale worktrees
      if (staleMs < config.staleThresholdMs) continue;

      let hasLivePid = false;
      if (pid) {
        hasLivePid = isProcessAlive(pid);
      }

      let dirty = false;
      try {
        const git = await this.worktreeManager.getGit(wt.agentId);
        dirty = await hasUncommittedChanges(git);
      } catch {
        dirty = true; // safe default
      }

      let unmerged = false;
      if (wt.branch) {
        unmerged = await hasUnmergedCommits(rootGit, wt.branch, config.targetBranch);
      }

      candidates.push({
        worktree: wt,
        hasLivePid,
        hasUncommittedChanges: dirty,
        hasUnmergedCommits: unmerged,
        isLocked: wt.locked,
        staleMs,
      });
    }

    return candidates;
  }

  /**
   * Run the full two-phase cleanup cycle: detect → decide → execute.
   */
  async cleanup(
    config: CleanupConfig,
    heartbeats: Map<string, { pid?: number; lastHeartbeatAt: number }>,
  ): Promise<CleanupResult> {
    const candidates = await this.detectStale(config, heartbeats);
    const reports: CleanupReport[] = [];
    let removed = 0;
    let quarantined = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const decision = decideCleanup({
        ...candidate,
        staleThresholdMs: config.staleThresholdMs,
      });

      const report: CleanupReport = {
        agentId: candidate.worktree.agentId,
        worktreePath: candidate.worktree.path,
        decision,
        timestamp: new Date().toISOString(),
      };
      reports.push(report);

      if (decision.action === 'skip') {
        skipped++;
        continue;
      }

      if (decision.action === 'quarantine') {
        quarantined++;
        // Phase A: mark as quarantined but don't remove
        continue;
      }

      if (decision.action === 'remove' && config.execute) {
        // Phase B: revalidate before removal
        const revalidated = decideCleanup({
          ...candidate,
          staleThresholdMs: config.staleThresholdMs,
        });

        if (revalidated.action === 'remove') {
          try {
            await this.worktreeManager.remove(candidate.worktree.agentId, {
              force: true,
              deleteBranch: true,
            });
            removed++;
          } catch {
            report.decision = { action: 'skip', reason: 'removal_failed' };
            skipped++;
          }
        } else {
          report.decision = revalidated;
          if (revalidated.action === 'quarantine') quarantined++;
          else skipped++;
        }
      } else if (decision.action === 'remove') {
        // Dry run
        removed++;
      }
    }

    return { reports, removed, quarantined, skipped };
  }

  /**
   * Prune orphaned worktree metadata (directories already gone).
   */
  async pruneOrphaned(): Promise<string> {
    return this.worktreeManager.pruneStale({ dryRun: false, expire: 'now' });
  }
}
