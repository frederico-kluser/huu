import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SimpleGit } from 'simple-git';
import type { MergeQueueRepository } from '../db/repositories/merge-queue.js';
import type { MergeResultsRepository, InsertMergeResultParams } from '../db/repositories/merge-results.js';
import type { MergeQueueItem, PremergeStatus, MergeTier, MergeMode, MergeOutcome } from '../types/index.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeRequest {
  source_branch: string;
  source_head_sha: string;
  target_branch?: string;
  request_id?: string;
}

export interface MergeExecutionResult {
  outcome: MergeOutcome;
  tier: MergeTier;
  mode: MergeMode | null;
  premergeStatus: PremergeStatus;
  targetHeadBefore: string | null;
  targetHeadAfter: string | null;
  conflicts: string[];
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
}

export interface PreMergeCheckResult {
  status: PremergeStatus;
  treeSha: string | null;
  conflicts: string[];
}

export interface MergeManagerOptions {
  workerId?: string;
  leaseSeconds?: number;
  maxAttempts?: number;
  repoPath?: string;
}

// ---------------------------------------------------------------------------
// MergeManager
// ---------------------------------------------------------------------------

export class MergeManager {
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly repoPath: string | undefined;

  constructor(
    private readonly git: SimpleGit,
    private readonly queue: MergeQueueRepository,
    private readonly results: MergeResultsRepository,
    options?: MergeManagerOptions,
  ) {
    this.workerId = options?.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.leaseSeconds = options?.leaseSeconds ?? 120;
    this.repoPath = options?.repoPath;
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /** Enqueue a merge request into the FIFO queue. */
  enqueue(request: MergeRequest): MergeQueueItem {
    return this.queue.enqueue({
      request_id: request.request_id ?? randomUUID(),
      source_branch: request.source_branch,
      source_head_sha: request.source_head_sha,
      target_branch: request.target_branch ?? 'main',
    });
  }

  /** Claim and process the next item in the queue. Returns null if queue is empty. */
  async processNext(): Promise<MergeExecutionResult | null> {
    const item = this.queue.claim(this.workerId, this.leaseSeconds);
    if (!item) return null;

    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    try {
      const result = await this.executeMerge(item);
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      this.logResult(item, {
        ...result,
        durationMs,
      }, startedAt, finishedAt);

      if (result.outcome === 'merged') {
        this.queue.complete(item.id);
      } else if (result.outcome === 'conflict') {
        this.queue.markConflict(item.id, result.errorMessage ?? 'merge conflict');
      } else {
        this.queue.fail(item.id, result.errorMessage ?? 'merge failed');
      }

      return { ...result, durationMs };
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.logResult(item, {
        outcome: 'failed',
        tier: 'none',
        mode: null,
        premergeStatus: 'fatal',
        targetHeadBefore: null,
        targetHeadAfter: null,
        conflicts: [],
        errorCode: 'UNEXPECTED',
        errorMessage,
        durationMs,
      }, startedAt, finishedAt);

      this.queue.fail(item.id, errorMessage);

      return {
        outcome: 'failed',
        tier: 'none',
        mode: null,
        premergeStatus: 'fatal',
        targetHeadBefore: null,
        targetHeadAfter: null,
        conflicts: [],
        errorCode: 'UNEXPECTED',
        errorMessage,
        durationMs,
      };
    }
  }

  // ─── Core merge logic ────────────────────────────────────────────────

  private async executeMerge(item: MergeQueueItem): Promise<MergeExecutionResult> {
    // 1. Validate preconditions
    await this.validatePreconditions(item);

    // 2. Read current SHAs
    const targetSha = (await this.git.revparse([item.target_branch])).trim();
    const sourceSha = (await this.git.revparse([item.source_branch])).trim();

    // 3. Validate source SHA hasn't changed since enqueue
    if (sourceSha !== item.source_head_sha) {
      return {
        outcome: 'failed',
        tier: 'none',
        mode: null,
        premergeStatus: 'skipped',
        targetHeadBefore: targetSha,
        targetHeadAfter: null,
        conflicts: [],
        errorCode: 'STALE_SHA',
        errorMessage: `Source SHA changed: expected ${item.source_head_sha}, got ${sourceSha}`,
        durationMs: 0,
      };
    }

    // 4. Detect merge-base for tier decision
    const baseSha = (await this.git.raw(['merge-base', targetSha, sourceSha])).trim();
    const alreadyMerged = baseSha === sourceSha;
    const canFastForward = baseSha === targetSha;

    // 5. Already merged → no-op
    if (alreadyMerged) {
      return {
        outcome: 'merged',
        tier: 'tier1',
        mode: 'noop_already_merged',
        premergeStatus: 'clean',
        targetHeadBefore: targetSha,
        targetHeadAfter: targetSha,
        conflicts: [],
        errorCode: null,
        errorMessage: null,
        durationMs: 0,
      };
    }

    // 6. Pre-merge check via git merge-tree --write-tree
    const premerge = await this.preMergeCheck(targetSha, sourceSha);

    if (premerge.status === 'conflict') {
      return {
        outcome: 'conflict',
        tier: 'none',
        mode: null,
        premergeStatus: 'conflict',
        targetHeadBefore: targetSha,
        targetHeadAfter: null,
        conflicts: premerge.conflicts,
        errorCode: 'PREMERGE_CONFLICT',
        errorMessage: `Pre-merge detected conflicts in: ${premerge.conflicts.join(', ')}`,
        durationMs: 0,
      };
    }

    if (premerge.status === 'fatal') {
      return {
        outcome: 'failed',
        tier: 'none',
        mode: null,
        premergeStatus: 'fatal',
        targetHeadBefore: targetSha,
        targetHeadAfter: null,
        conflicts: [],
        errorCode: 'PREMERGE_FATAL',
        errorMessage: 'Pre-merge check failed with fatal error',
        durationMs: 0,
      };
    }

    // 7. Checkout target branch
    await this.git.checkout(item.target_branch);

    // 8. Execute appropriate tier
    if (canFastForward) {
      return this.executeTier1(item, targetSha);
    } else {
      return this.executeTier2(item, targetSha);
    }
  }

  // ─── Tier 1: Fast-forward ────────────────────────────────────────────

  private async executeTier1(
    item: MergeQueueItem,
    targetHeadBefore: string,
  ): Promise<MergeExecutionResult> {
    try {
      await this.git.merge(['--ff-only', item.source_branch]);
      const targetHeadAfter = (await this.git.revparse([item.target_branch])).trim();

      return {
        outcome: 'merged',
        tier: 'tier1',
        mode: 'ff-only',
        premergeStatus: 'clean',
        targetHeadBefore,
        targetHeadAfter,
        conflicts: [],
        errorCode: null,
        errorMessage: null,
        durationMs: 0,
      };
    } catch (err) {
      // ff-only failed (race condition) → revalidate
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        outcome: 'failed',
        tier: 'tier1',
        mode: 'ff-only',
        premergeStatus: 'clean',
        targetHeadBefore,
        targetHeadAfter: null,
        conflicts: [],
        errorCode: 'FF_FAILED',
        errorMessage,
        durationMs: 0,
      };
    }
  }

  // ─── Tier 2: Recursive merge (ort strategy) ──────────────────────────

  private async executeTier2(
    item: MergeQueueItem,
    targetHeadBefore: string,
  ): Promise<MergeExecutionResult> {
    try {
      await this.git.merge(['--no-ff', '--no-edit', '-s', 'ort', item.source_branch]);
      const targetHeadAfter = (await this.git.revparse([item.target_branch])).trim();

      return {
        outcome: 'merged',
        tier: 'tier2',
        mode: 'no-ff-ort',
        premergeStatus: 'clean',
        targetHeadBefore,
        targetHeadAfter,
        conflicts: [],
        errorCode: null,
        errorMessage: null,
        durationMs: 0,
      };
    } catch (err) {
      // Merge failed — abort to restore clean state
      try {
        await this.git.merge(['--abort']);
      } catch (abortErr) {
        const abortMsg = abortErr instanceof Error ? abortErr.message : String(abortErr);
        return {
          outcome: 'failed',
          tier: 'tier2',
          mode: 'no-ff-ort',
          premergeStatus: 'clean',
          targetHeadBefore,
          targetHeadAfter: null,
          conflicts: [],
          errorCode: 'MERGE_ABORT_FAILED',
          errorMessage: `Merge failed and abort also failed: ${abortMsg}`,
          durationMs: 0,
        };
      }

      // Extract conflict info if available
      const conflicts = this.extractConflicts(err);
      const isConflict = conflicts.length > 0;

      return {
        outcome: isConflict ? 'conflict' : 'failed',
        tier: 'tier2',
        mode: 'no-ff-ort',
        premergeStatus: 'clean',
        targetHeadBefore,
        targetHeadAfter: null,
        conflicts,
        errorCode: isConflict ? 'MERGE_CONFLICT' : 'MERGE_FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      };
    }
  }

  // ─── Pre-merge check ─────────────────────────────────────────────────

  async preMergeCheck(targetRef: string, sourceRef: string): Promise<PreMergeCheckResult> {
    try {
      const cwd = this.repoPath ?? (await this.git.revparse(['--show-toplevel'])).trim();
      const { stdout, stderr } = await execFileAsync(
        'git',
        ['merge-tree', '--write-tree', '--name-only', '--no-messages', targetRef, sourceRef],
        { cwd },
      );

      // exit 0 = clean merge
      const treeSha = stdout.trim().split('\n')[0] ?? null;
      return { status: 'clean', treeSha, conflicts: [] };
    } catch (err: unknown) {
      const execErr = err as { code?: number; stdout?: string; stderr?: string };

      if (execErr.code === 1) {
        // exit 1 = conflicts detected
        const lines = (execErr.stdout ?? '').trim().split('\n');
        // First line is tree SHA, remaining are conflicted file names
        const conflicts = lines.slice(1).filter((l) => l.trim() !== '');
        return { status: 'conflict', treeSha: lines[0] ?? null, conflicts };
      }

      // Other exit codes = fatal error
      return { status: 'fatal', treeSha: null, conflicts: [] };
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private async validatePreconditions(item: MergeQueueItem): Promise<void> {
    // Verify source branch exists
    try {
      await this.git.revparse(['--verify', item.source_branch]);
    } catch {
      throw new MergeError('Source branch does not exist', {
        code: 'BRANCH_NOT_FOUND',
        branch: item.source_branch,
      });
    }

    // Verify target branch exists
    try {
      await this.git.revparse(['--verify', item.target_branch]);
    } catch {
      throw new MergeError('Target branch does not exist', {
        code: 'BRANCH_NOT_FOUND',
        branch: item.target_branch,
      });
    }
  }

  private extractConflicts(err: unknown): string[] {
    // simple-git puts conflict info in err.git.conflicts
    const gitErr = err as { git?: { conflicts?: string[] } };
    if (gitErr?.git?.conflicts && Array.isArray(gitErr.git.conflicts)) {
      return gitErr.git.conflicts;
    }

    // Fallback: parse error message for CONFLICT lines
    const message = err instanceof Error ? err.message : String(err);
    const conflicts: string[] = [];
    for (const line of message.split('\n')) {
      const match = /CONFLICT \([^)]+\): .* in (.+)/.exec(line);
      if (match?.[1]) {
        conflicts.push(match[1]);
      }
    }
    return conflicts;
  }

  private logResult(
    item: MergeQueueItem,
    result: MergeExecutionResult,
    startedAt: string,
    finishedAt: string,
  ): void {
    const params: InsertMergeResultParams = {
      request_id: item.request_id,
      queue_id: item.id,
      source_branch: item.source_branch,
      source_head_sha: item.source_head_sha,
      target_branch: item.target_branch,
      target_head_before: result.targetHeadBefore,
      target_head_after: result.targetHeadAfter,
      premerge_status: result.premergeStatus,
      tier_selected: result.tier,
      merge_mode: result.mode,
      outcome: result.outcome,
      conflicts: result.conflicts,
      error_code: result.errorCode ?? undefined,
      error_message: result.errorMessage ?? undefined,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: result.durationMs,
      attempt: item.attempts,
    };
    this.results.insert(params);
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class MergeError extends Error {
  public readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'MergeError';
    this.context = context;
  }
}
