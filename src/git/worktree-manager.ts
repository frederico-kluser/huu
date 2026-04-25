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

  createIntegrationWorktree(): WorktreeInfo {
    const branch = integrationBranchName(this.runId);
    const wtPath = integrationWorktreePath(this.repoRoot, this.runId);
    this.ensureParentDir(wtPath);
    this.git.createBranch(branch, this.baseCommit);
    this.git.addWorktree(wtPath, branch);
    this.createdWorktrees.set(wtPath, branch);
    return { branchName: branch, worktreePath: wtPath };
  }

  createAgentWorktree(agentId: number, startRef?: string): WorktreeInfo {
    const branch = agentBranchName(this.runId, agentId);
    const wtPath = agentWorktreePath(this.repoRoot, this.runId, agentId);
    this.ensureParentDir(wtPath);
    this.git.createBranch(branch, startRef ?? this.baseCommit);
    this.git.addWorktree(wtPath, branch);
    this.createdWorktrees.set(wtPath, branch);
    return { branchName: branch, worktreePath: wtPath };
  }

  removeAgentWorktree(agentId: number): void {
    const wtPath = agentWorktreePath(this.repoRoot, this.runId, agentId);
    this.git.removeWorktree(wtPath);
    this.createdWorktrees.delete(wtPath);
  }

  removeIntegrationWorktree(): void {
    const wtPath = integrationWorktreePath(this.repoRoot, this.runId);
    this.git.removeWorktree(wtPath);
    this.createdWorktrees.delete(wtPath);
  }

  cleanupAll(): void {
    for (const [wtPath] of this.createdWorktrees) {
      this.git.removeWorktree(wtPath);
    }
    this.createdWorktrees.clear();
    this.git.pruneWorktrees();
  }

  getGitClient(): GitClient {
    return this.git;
  }

  getBaseDir(): string {
    return worktreeBaseDir(this.repoRoot, this.runId);
  }

  cleanupRunFromManifest(
    manifest: RunManifest,
    deleteRemote: boolean,
  ): { worktreesRemoved: number; localBranchesDeleted: number; remoteBranchesDeleted: number } {
    let worktreesRemoved = 0;
    let localBranchesDeleted = 0;
    let remoteBranchesDeleted = 0;

    for (const entry of manifest.agentEntries) {
      if (entry.worktreePath && !entry.cleanupDone) {
        try {
          this.git.removeWorktree(entry.worktreePath);
          worktreesRemoved++;
        } catch {
          /* best effort */
        }
      }
      if (entry.branchName) {
        try {
          this.git.deleteBranch(entry.branchName);
          localBranchesDeleted++;
        } catch {
          /* best effort */
        }
        if (deleteRemote && entry.pushStatus === 'pushed') {
          if (this.git.deleteRemoteBranch(entry.branchName)) {
            remoteBranchesDeleted++;
          }
        }
      }
    }

    if (manifest.integrationWorktreePath) {
      try {
        this.git.removeWorktree(manifest.integrationWorktreePath);
        worktreesRemoved++;
      } catch {
        /* best effort */
      }
    }
    if (manifest.integrationBranch) {
      try {
        this.git.deleteBranch(manifest.integrationBranch);
        localBranchesDeleted++;
      } catch {
        /* best effort */
      }
      if (deleteRemote && this.git.deleteRemoteBranch(manifest.integrationBranch)) {
        remoteBranchesDeleted++;
      }
    }

    this.git.pruneWorktrees();
    this.createdWorktrees.clear();

    return { worktreesRemoved, localBranchesDeleted, remoteBranchesDeleted };
  }

  private ensureParentDir(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
  }
}
