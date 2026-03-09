// WorktreePool — reuse worktrees instead of create/destroy per task
//
// States: idle → leased → cleaning → idle (or quarantined on failure)
//
// Invariants:
// - No task starts with a "dirty" worktree
// - Cleanup always validates with `git status --porcelain`
// - Pool cap defaults to maxConcurrentAgents
// - Quarantined worktrees are removed on next reconciliation

import path from 'node:path';
import fs from 'node:fs';
import { Mutex } from 'async-mutex';
import type { SimpleGit } from 'simple-git';
import { simpleGit } from 'simple-git';
import type { WorktreeManager } from './WorktreeManager.js';
import type { CreateWorktreeOptions } from './types.js';

// ── Types ────────────────────────────────────────────────────────────

export type WorktreeState = 'idle' | 'leased' | 'cleaning' | 'quarantined';

export interface PoolEntry {
  id: string;
  worktreePath: string;
  branchName: string;
  state: WorktreeState;
  leasedTo: string | null;
  leasedAt: number | null;
  createdAt: number;
  recycleCount: number;
  lastRecycledAt: number | null;
}

export interface PoolLease {
  worktreeId: string;
  worktreePath: string;
  branchName: string;
  git: SimpleGit;
  cold: boolean; // true if newly created (not reused)
}

export interface WorktreePoolConfig {
  /** Maximum number of worktrees in the pool. Default: 5 */
  maxPoolSize: number;
  /** Whether to prewarm worktrees on startup. Default: false */
  prewarm: boolean;
  /** Number of worktrees to prewarm. Default: 2 */
  prewarmCount: number;
  /** Node modules strategy for new worktrees. Default: 'none' */
  nodeModulesStrategy: CreateWorktreeOptions['nodeModulesStrategy'];
}

const DEFAULT_POOL_CONFIG: WorktreePoolConfig = {
  maxPoolSize: 5,
  prewarm: false,
  prewarmCount: 2,
  nodeModulesStrategy: 'none',
};

export interface PoolStats {
  total: number;
  idle: number;
  leased: number;
  cleaning: number;
  quarantined: number;
  recycleCount: number;
  coldCreations: number;
  warmReuses: number;
}

// ── WorktreePool ────────────────────────────────────────────────────

export class WorktreePool {
  private readonly config: WorktreePoolConfig;
  private readonly entries = new Map<string, PoolEntry>();
  private readonly mutex = new Mutex();
  private readonly gitCache = new Map<string, SimpleGit>();
  private nextId = 1;

  // Stats
  private _coldCreations = 0;
  private _warmReuses = 0;

  constructor(
    private readonly manager: WorktreeManager,
    config?: Partial<WorktreePoolConfig>,
  ) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  /**
   * Acquire a worktree for a task.
   * Tries to reuse an idle worktree; falls back to creating a new one.
   */
  async acquire(
    agentId: string,
    baseBranch: string,
  ): Promise<PoolLease> {
    return this.mutex.runExclusive(async () => {
      // 1. Try to reuse an idle worktree
      const idle = this.findIdle();
      if (idle) {
        idle.state = 'leased';
        idle.leasedTo = agentId;
        idle.leasedAt = Date.now();

        // Reset the worktree to the base ref (it should be detached from recycle)
        const git = await this.getGit(idle);
        const baseSha = (await this.manager.getRootGit().raw(['rev-parse', baseBranch])).trim();
        await git.raw(['checkout', '--detach', baseSha]);
        await git.raw(['reset', '--hard', baseSha]);
        await git.raw(['clean', '-fdx']);

        // Verify clean state
        const status = await git.raw(['status', '--porcelain']);
        if (status.trim() !== '') {
          // Failed to clean — quarantine
          idle.state = 'quarantined';
          idle.leasedTo = null;
          // Fall through to create new
        } else {
          // Create a fresh branch for this agent and check it out
          const branchName = this.manager.branchNameFor(agentId);
          try {
            await this.manager.getRootGit().raw(['branch', '--no-track', branchName, baseBranch]);
          } catch {
            // Branch might already exist; delete and recreate
            try { await this.manager.getRootGit().raw(['branch', '-D', branchName]); } catch { /* */ }
            await this.manager.getRootGit().raw(['branch', '--no-track', branchName, baseBranch]);
          }
          await git.raw(['checkout', branchName]);

          idle.branchName = branchName;
          idle.recycleCount++;
          idle.lastRecycledAt = Date.now();
          this._warmReuses++;

          return {
            worktreeId: idle.id,
            worktreePath: idle.worktreePath,
            branchName,
            git,
            cold: false,
          };
        }
      }

      // 2. Create new worktree (cold path)
      const poolId = `pool-${this.nextId++}`;
      const info = await this.manager.create(agentId, baseBranch, {
        lock: true,
        nodeModulesStrategy: this.config.nodeModulesStrategy,
      });

      const entry: PoolEntry = {
        id: poolId,
        worktreePath: info.path,
        branchName: info.branch ?? this.manager.branchNameFor(agentId),
        state: 'leased',
        leasedTo: agentId,
        leasedAt: Date.now(),
        createdAt: Date.now(),
        recycleCount: 0,
        lastRecycledAt: null,
      };
      this.entries.set(poolId, entry);
      this._coldCreations++;

      const git = await this.manager.getGit(agentId);

      return {
        worktreeId: poolId,
        worktreePath: info.path,
        branchName: entry.branchName,
        git,
        cold: true,
      };
    });
  }

  /**
   * Recycle a worktree back into the pool after task completion.
   * Resets to a clean state for reuse.
   */
  async recycle(worktreeId: string, baseRef: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const entry = this.entries.get(worktreeId);
      if (!entry) return;

      entry.state = 'cleaning';
      const agentId = entry.leasedTo;

      try {
        const git = await this.getGit(entry);
        const agentBranch = agentId ? this.manager.branchNameFor(agentId) : null;

        // Resolve baseRef to a SHA so we can detach to it
        const baseSha = (await this.manager.getRootGit().raw(['rev-parse', baseRef])).trim();

        // Detach HEAD to the base SHA (avoids "branch already checked out" errors)
        await git.raw(['checkout', '--detach', baseSha]);
        await git.raw(['reset', '--hard', baseSha]);
        await git.raw(['clean', '-fdx']);

        // Delete the agent's branch (from the root repo, while worktree is detached)
        if (agentBranch) {
          try {
            await this.manager.getRootGit().raw(['branch', '-D', agentBranch]);
          } catch {
            // Branch may already be deleted
          }
        }

        // Verify clean state
        const status = await git.raw(['status', '--porcelain']);
        if (status.trim() !== '') {
          entry.state = 'quarantined';
          return;
        }

        // Check pool capacity
        const idleCount = this.countByState('idle');
        if (idleCount >= this.config.maxPoolSize) {
          // Pool full — remove this worktree
          await this.destroyEntry(entry);
          return;
        }

        entry.state = 'idle';
        entry.leasedTo = null;
        entry.leasedAt = null;
      } catch {
        entry.state = 'quarantined';
      }
    });
  }

  /**
   * Reconcile pool state with actual git worktrees.
   * Removes quarantined entries and prunes stale metadata.
   */
  async reconcile(): Promise<{ removed: number; quarantined: number }> {
    return this.mutex.runExclusive(async () => {
      let removed = 0;
      let quarantined = 0;

      for (const [id, entry] of this.entries) {
        // Remove quarantined
        if (entry.state === 'quarantined') {
          await this.destroyEntry(entry);
          this.entries.delete(id);
          removed++;
          continue;
        }

        // Check if worktree path still exists
        if (!fs.existsSync(entry.worktreePath)) {
          this.entries.delete(id);
          this.gitCache.delete(id);
          removed++;
          continue;
        }
      }

      // Prune stale git worktree metadata
      try {
        await this.manager.getRootGit().raw(['worktree', 'prune']);
      } catch {
        // Non-fatal
      }

      return { removed, quarantined };
    });
  }

  /** Get pool statistics. */
  get stats(): PoolStats {
    let idle = 0;
    let leased = 0;
    let cleaning = 0;
    let quarantinedCount = 0;
    let recycleCount = 0;

    for (const entry of this.entries.values()) {
      switch (entry.state) {
        case 'idle': idle++; break;
        case 'leased': leased++; break;
        case 'cleaning': cleaning++; break;
        case 'quarantined': quarantinedCount++; break;
      }
      recycleCount += entry.recycleCount;
    }

    return {
      total: this.entries.size,
      idle,
      leased,
      cleaning,
      quarantined: quarantinedCount,
      recycleCount,
      coldCreations: this._coldCreations,
      warmReuses: this._warmReuses,
    };
  }

  /** Drain the pool: destroy all worktrees. */
  async drain(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      for (const entry of this.entries.values()) {
        if (entry.state !== 'leased') {
          await this.destroyEntry(entry);
        }
      }
      // Remove non-leased entries
      for (const [id, entry] of this.entries) {
        if (entry.state !== 'leased') {
          this.entries.delete(id);
          this.gitCache.delete(id);
        }
      }
    });
  }

  /** Prewarm the pool by creating worktrees in advance. */
  async prewarm(baseBranch: string): Promise<number> {
    if (!this.config.prewarm) return 0;

    let created = 0;
    const target = Math.min(this.config.prewarmCount, this.config.maxPoolSize);

    for (let i = 0; i < target; i++) {
      const poolId = `pool-${this.nextId++}`;
      const prewarmAgentId = `prewarm-${poolId}`;

      try {
        const info = await this.manager.create(prewarmAgentId, baseBranch, {
          lock: false,
          nodeModulesStrategy: this.config.nodeModulesStrategy,
        });

        const entry: PoolEntry = {
          id: poolId,
          worktreePath: info.path,
          branchName: info.branch ?? this.manager.branchNameFor(prewarmAgentId),
          state: 'idle',
          leasedTo: null,
          leasedAt: null,
          createdAt: Date.now(),
          recycleCount: 0,
          lastRecycledAt: null,
        };
        this.entries.set(poolId, entry);
        created++;
      } catch {
        // Prewarm failure is non-fatal
        break;
      }
    }

    return created;
  }

  // ── Internals ─────────────────────────────────────────────────────

  private findIdle(): PoolEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.state === 'idle') return entry;
    }
    return undefined;
  }

  private countByState(state: WorktreeState): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.state === state) count++;
    }
    return count;
  }

  private async getGit(entry: PoolEntry): Promise<SimpleGit> {
    let git = this.gitCache.get(entry.id);
    if (git && fs.existsSync(entry.worktreePath)) {
      return git;
    }

    git = simpleGit({
      baseDir: entry.worktreePath,
      maxConcurrentProcesses: 4,
    });
    this.gitCache.set(entry.id, git);
    return git;
  }

  private async destroyEntry(entry: PoolEntry): Promise<void> {
    const agentId = entry.leasedTo ?? this.manager.agentIdFromPath(entry.worktreePath);
    if (agentId) {
      try {
        await this.manager.remove(agentId, { force: true, forceDeleteBranch: true });
      } catch {
        // Best-effort cleanup
        try {
          if (fs.existsSync(entry.worktreePath)) {
            fs.rmSync(entry.worktreePath, { recursive: true, force: true });
          }
          await this.manager.getRootGit().raw(['worktree', 'prune']);
        } catch {
          // Accept failure
        }
      }
    }
    this.gitCache.delete(entry.id);
  }
}
