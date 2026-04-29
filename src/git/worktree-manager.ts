import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { GitClient } from './git-client.js';
import {
  agentBranchName,
  agentWorktreePath,
  integrationBranchName,
  integrationWorktreePath,
  worktreeBaseDir,
} from './branch-namer.js';
import type { RunManifest } from '../lib/types.js';

export interface WorktreeInfo {
  branchName: string;
  worktreePath: string;
}

export class WorktreeManager {
  private git: GitClient;
  private createdWorktrees: Map<string, string> = new Map();

  constructor(
    private repoRoot: string,
    private runId: string,
    private baseCommit: string,
  ) {
    this.git = new GitClient(repoRoot);
  }

  async createIntegrationWorktree(): Promise<WorktreeInfo> {
    const branch = integrationBranchName(this.runId);
    const wtPath = integrationWorktreePath(this.repoRoot, this.runId);
    this.ensureParentDir(wtPath);
    await this.git.createBranch(branch, this.baseCommit);
    await this.git.addWorktree(wtPath, branch);
    this.createdWorktrees.set(wtPath, branch);
    return { branchName: branch, worktreePath: wtPath };
  }

  async createAgentWorktree(
    agentId: number,
    startRef?: string,
    attempt = 1,
  ): Promise<WorktreeInfo> {
    const branch = agentBranchName(this.runId, agentId, attempt);
    const wtPath = agentWorktreePath(this.repoRoot, this.runId, agentId, attempt);
    this.ensureParentDir(wtPath);
    await this.git.createBranch(branch, startRef ?? this.baseCommit);
    await this.git.addWorktree(wtPath, branch);
    this.createdWorktrees.set(wtPath, branch);
    return { branchName: branch, worktreePath: wtPath };
  }

  async removeAgentWorktree(agentId: number, attempt = 1): Promise<void> {
    const wtPath = agentWorktreePath(this.repoRoot, this.runId, agentId, attempt);
    await this.git.removeWorktree(wtPath);
    this.createdWorktrees.delete(wtPath);
  }

  async removeIntegrationWorktree(): Promise<void> {
    const wtPath = integrationWorktreePath(this.repoRoot, this.runId);
    await this.git.removeWorktree(wtPath);
    this.createdWorktrees.delete(wtPath);
  }

  async cleanupAll(): Promise<void> {
    for (const [wtPath] of this.createdWorktrees) {
      await this.git.removeWorktree(wtPath);
    }
    this.createdWorktrees.clear();
    await this.git.pruneWorktrees();
  }

  getGitClient(): GitClient {
    return this.git;
  }

  getBaseDir(): string {
    return worktreeBaseDir(this.repoRoot, this.runId);
  }

  async cleanupRunFromManifest(
    manifest: RunManifest,
    deleteRemote: boolean,
  ): Promise<{ worktreesRemoved: number; localBranchesDeleted: number; remoteBranchesDeleted: number }> {
    let worktreesRemoved = 0;
    let localBranchesDeleted = 0;
    let remoteBranchesDeleted = 0;

    for (const entry of manifest.agentEntries) {
      if (entry.worktreePath && !entry.cleanupDone) {
        try {
          await this.git.removeWorktree(entry.worktreePath);
          worktreesRemoved++;
        } catch {
          /* best effort */
        }
      }
      if (entry.branchName) {
        try {
          await this.git.deleteBranch(entry.branchName);
          localBranchesDeleted++;
        } catch {
          /* best effort */
        }
        if (deleteRemote && entry.pushStatus === 'pushed') {
          if (await this.git.deleteRemoteBranch(entry.branchName)) {
            remoteBranchesDeleted++;
          }
        }
      }
    }

    if (manifest.integrationWorktreePath) {
      try {
        await this.git.removeWorktree(manifest.integrationWorktreePath);
        worktreesRemoved++;
      } catch {
        /* best effort */
      }
    }
    if (manifest.integrationBranch) {
      try {
        await this.git.deleteBranch(manifest.integrationBranch);
        localBranchesDeleted++;
      } catch {
        /* best effort */
      }
      if (deleteRemote && (await this.git.deleteRemoteBranch(manifest.integrationBranch))) {
        remoteBranchesDeleted++;
      }
    }

    await this.git.pruneWorktrees();
    this.createdWorktrees.clear();

    return { worktreesRemoved, localBranchesDeleted, remoteBranchesDeleted };
  }

  private ensureParentDir(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
  }
}
