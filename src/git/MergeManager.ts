import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimpleGit } from 'simple-git';
import type { MergeQueueRepository } from '../db/repositories/merge-queue.js';
import type { MergeResultsRepository, InsertMergeResultParams } from '../db/repositories/merge-results.js';
import type { ConflictHistoryRepository } from '../db/repositories/conflict-history.js';
import type { MergeQueueItem, PremergeStatus, MergeTier, MergeMode, MergeOutcome, MergeEscalationPayload } from '../types/index.js';
import {
  chooseTier3Side,
  classifyFileRisk,
  getLastTouchSide,
  computeOwnershipScore,
  generateConflictFingerprint,
  classifyConflictType,
  isTier3Supported,
} from './heuristics.js';
import { AIResolver, extractConflictHunks, detectLanguage } from './ai-resolver.js';

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
  escalation?: MergeEscalationPayload;
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

export interface Tier34Dependencies {
  conflictHistory: ConflictHistoryRepository;
  aiResolver?: AIResolver;
  onEscalation?: (payload: MergeEscalationPayload) => void;
}

// ---------------------------------------------------------------------------
// MergeManager
// ---------------------------------------------------------------------------

export class MergeManager {
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly repoPath: string | undefined;
  private tier34Deps: Tier34Dependencies | undefined;

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

  // ─── Configuration ────────────────────────────────────────────────

  /** Attach Tier 3/4 dependencies. Without this, conflicts stop at pre-merge detection. */
  setTier34Deps(deps: Tier34Dependencies): void {
    this.tier34Deps = deps;
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
      } else if (result.outcome === 'escalated') {
        this.queue.blockHuman(item.id, result.errorMessage ?? 'escalated to human');
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

  /**
   * Handle an operator action on a blocked_human queue item.
   * Returns the result of the action.
   */
  async handleOperatorAction(
    queueItemId: number,
    action: 'retry_tier4' | 'accept_tier3_candidate' | 'manual_resolution_committed' | 'abort_merge_item',
  ): Promise<{ success: boolean; message: string }> {
    const item = this.queue.getById(queueItemId);
    if (!item) return { success: false, message: 'Queue item not found' };
    if (item.status !== 'blocked_human') {
      return { success: false, message: `Item is not blocked_human, current status: ${item.status}` };
    }

    switch (action) {
      case 'retry_tier4': {
        const resumed = this.queue.resumeFromBlock(item.id, this.workerId, this.leaseSeconds);
        if (!resumed) return { success: false, message: 'Failed to resume queue item' };
        return { success: true, message: 'Item requeued for Tier 4 retry' };
      }
      case 'accept_tier3_candidate': {
        this.queue.complete(item.id);
        return { success: true, message: 'Tier 3 candidate accepted' };
      }
      case 'manual_resolution_committed': {
        this.queue.complete(item.id);
        return { success: true, message: 'Manual resolution accepted' };
      }
      case 'abort_merge_item': {
        this.queue.fail(item.id, 'Aborted by operator');
        return { success: true, message: 'Merge item aborted' };
      }
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
    if (premerge.status === 'clean') {
      if (canFastForward) {
        return this.executeTier1(item, targetSha);
      } else {
        return this.executeTier2(item, targetSha);
      }
    }

    // 9. Conflicts detected — try Tier 3/4 if deps available
    if (this.tier34Deps) {
      return this.executeConflictResolution(item, targetSha, baseSha, premerge.conflicts);
    }

    // No Tier 3/4 available — report conflict
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

  // ─── Tier 3/4: Conflict resolution pipeline ──────────────────────────

  private async executeConflictResolution(
    item: MergeQueueItem,
    targetSha: string,
    baseSha: string,
    conflictedFiles: string[],
  ): Promise<MergeExecutionResult> {
    const deps = this.tier34Deps!;
    const repoPath = this.repoPath ?? (await this.git.revparse(['--show-toplevel'])).trim();
    const attempts: Array<{ tier: 3 | 4; strategy: string; confidence?: number; outcome: string }> = [];

    // Record conflicts in history
    const conflictRecords = new Map<string, string>(); // filePath → conflictId
    for (const filePath of conflictedFiles) {
      const riskClass = classifyFileRisk(filePath);
      const conflictType = 'content'; // Default; refined after actual merge
      const fingerprint = generateConflictFingerprint(filePath, conflictType, targetSha, item.source_head_sha);

      const conflict = deps.conflictHistory.insertConflict({
        queue_item_id: item.request_id,
        file_path: filePath,
        conflict_fingerprint: fingerprint,
        conflict_type: conflictType,
        merge_base_sha: baseSha,
        ours_sha: targetSha,
        theirs_sha: item.source_head_sha,
      });
      conflictRecords.set(filePath, conflict.id);
    }

    // Start the actual merge (will leave conflicts in working tree)
    try {
      await this.git.merge(['--no-ff', '--no-commit', '-s', 'ort', item.source_branch]);
    } catch {
      // Expected: merge will fail with conflicts
    }

    // Get actual conflicted files from git status
    const status = await this.git.status();
    const actualConflicts = status.conflicted;

    if (actualConflicts.length === 0) {
      // No actual conflicts — the merge was clean (pre-merge was false positive)
      try {
        await this.git.commit('Merge branch ' + item.source_branch);
        const targetHeadAfter = (await this.git.revparse([item.target_branch])).trim();
        return {
          outcome: 'merged',
          tier: 'tier2',
          mode: 'no-ff-ort',
          premergeStatus: 'conflict',
          targetHeadBefore: targetSha,
          targetHeadAfter,
          conflicts: [],
          errorCode: null,
          errorMessage: null,
          durationMs: 0,
        };
      } catch {
        // fallthrough to abort
      }
    }

    // ─── Tier 3: Try deterministic resolution for each file ───────────
    const tier3Resolved: string[] = [];
    const tier3Unresolved: string[] = [];
    const selectedSides = new Map<string, 'ours' | 'theirs'>();

    for (const filePath of actualConflicts) {
      const conflictType = classifyConflictType(filePath);

      // Skip unsupported conflict types
      if (!isTier3Supported(conflictType)) {
        tier3Unresolved.push(filePath);
        const conflictId = conflictRecords.get(filePath);
        if (conflictId) {
          deps.conflictHistory.insertAttempt({
            conflict_id: conflictId,
            tier: 3,
            strategy: 'skip-unsupported',
            outcome: 'escalated',
          });
        }
        attempts.push({ tier: 3, strategy: 'skip-unsupported', outcome: 'escalated' });
        continue;
      }

      // Gather signals
      const riskClass = classifyFileRisk(filePath);
      const historyScores = deps.conflictHistory.getHistoryScores(filePath);
      const lastTouchSide = await getLastTouchSide(
        this.git, filePath, item.target_branch, item.source_branch,
      );
      const ownershipScore = await computeOwnershipScore(
        this.git, filePath, item.target_branch, item.source_branch, baseSha,
      );

      const decision = chooseTier3Side({
        filePath,
        conflictType,
        lastTouchSide,
        ownershipScore,
        historyScore: historyScores,
        riskClass,
      });

      const conflictId = conflictRecords.get(filePath);

      if (decision.side === 'escalate') {
        tier3Unresolved.push(filePath);
        if (conflictId) {
          deps.conflictHistory.insertAttempt({
            conflict_id: conflictId,
            tier: 3,
            strategy: 'heuristic',
            confidence: decision.confidence,
            outcome: 'escalated',
          });
        }
        attempts.push({ tier: 3, strategy: 'heuristic', confidence: decision.confidence, outcome: 'escalated' });
      } else {
        // Apply resolution: checkout --ours or --theirs
        try {
          await this.git.raw(['checkout', `--${decision.side}`, '--', filePath]);
          await this.git.add(filePath);
          tier3Resolved.push(filePath);
          selectedSides.set(filePath, decision.side);
          if (conflictId) {
            deps.conflictHistory.insertAttempt({
              conflict_id: conflictId,
              tier: 3,
              strategy: `x-${decision.side}`,
              selected_side: decision.side,
              confidence: decision.confidence,
              outcome: 'success',
            });
          }
          attempts.push({
            tier: 3,
            strategy: `x-${decision.side}`,
            confidence: decision.confidence,
            outcome: 'success',
          });
        } catch {
          tier3Unresolved.push(filePath);
          if (conflictId) {
            deps.conflictHistory.insertAttempt({
              conflict_id: conflictId,
              tier: 3,
              strategy: `x-${decision.side}`,
              selected_side: decision.side,
              confidence: decision.confidence,
              outcome: 'failed',
            });
          }
          attempts.push({
            tier: 3,
            strategy: `x-${decision.side}`,
            confidence: decision.confidence,
            outcome: 'failed',
          });
        }
      }
    }

    // If all resolved by Tier 3, commit
    if (tier3Unresolved.length === 0 && tier3Resolved.length > 0) {
      try {
        await this.git.commit(`Merge branch '${item.source_branch}' (Tier 3 auto-resolved)`);
        const targetHeadAfter = (await this.git.revparse([item.target_branch])).trim();
        const primarySide = this.getPrimarySide(selectedSides);
        return {
          outcome: 'merged',
          tier: 'tier3',
          mode: primarySide === 'ours' ? 'ort-x-ours' : 'ort-x-theirs',
          premergeStatus: 'conflict',
          targetHeadBefore: targetSha,
          targetHeadAfter,
          conflicts: [],
          errorCode: null,
          errorMessage: null,
          durationMs: 0,
        };
      } catch (commitErr) {
        // If commit fails, fall through to Tier 4
        tier3Unresolved.push(...tier3Resolved);
      }
    }

    // ─── Tier 4: AI resolution for remaining conflicts ────────────────
    if (deps.aiResolver && tier3Unresolved.length > 0) {
      const tier4Result = await this.executeTier4(
        item, repoPath, baseSha, targetSha, tier3Unresolved,
        conflictRecords, attempts, deps,
      );
      if (tier4Result) return tier4Result;
    }

    // ─── Escalation: abort merge, block queue item ────────────────────
    try {
      await this.git.merge(['--abort']);
    } catch {
      // Best-effort abort
    }

    const escalation: MergeEscalationPayload = {
      queueItemId: item.request_id,
      reason: tier3Unresolved.length > 0 && !deps.aiResolver
        ? 'high_risk_conflict'
        : 'retry_budget_exhausted',
      conflictedFiles: actualConflicts,
      attempted: attempts,
      recommendedActions: ['retry_tier4', 'manual_resolution_committed', 'abort_merge_item'],
    };

    deps.onEscalation?.(escalation);

    return {
      outcome: 'escalated',
      tier: tier3Resolved.length > 0 ? 'tier3' : 'none',
      mode: null,
      premergeStatus: 'conflict',
      targetHeadBefore: targetSha,
      targetHeadAfter: null,
      conflicts: actualConflicts,
      errorCode: 'ESCALATED_HUMAN',
      errorMessage: `Conflicts require human review: ${actualConflicts.join(', ')}`,
      durationMs: 0,
      escalation,
    };
  }

  private async executeTier4(
    item: MergeQueueItem,
    repoPath: string,
    baseSha: string,
    targetSha: string,
    unresolvedFiles: string[],
    conflictRecords: Map<string, string>,
    attempts: Array<{ tier: 3 | 4; strategy: string; confidence?: number; outcome: string }>,
    deps: Tier34Dependencies,
  ): Promise<MergeExecutionResult | null> {
    // Build context bundle for AI
    const bundleFiles = unresolvedFiles.map((filePath) => {
      const fullPath = join(repoPath, filePath);
      let fileContent = '';
      try {
        fileContent = readFileSync(fullPath, 'utf-8');
      } catch {
        // File might not be readable
      }

      const hunks = extractConflictHunks(fileContent);
      const language = detectLanguage(filePath);
      const riskClass = classifyFileRisk(filePath);

      // Get history for this file
      const stats = deps.conflictHistory.getStrategyStats(filePath, 1);
      const history = stats.map((s) => ({
        strategy: s.strategy,
        outcome: (s.success_rate > 0.5 ? 'success' : 'failed') as 'success' | 'failed',
      }));

      return {
        path: filePath,
        language,
        riskClass,
        conflictHunks: hunks,
        history,
      };
    });

    const bundle = {
      queueItemId: item.request_id,
      mergeBaseSha: baseSha,
      oursSha: targetSha,
      theirsSha: item.source_head_sha,
      files: bundleFiles,
      constraints: [],
      failingChecks: [],
    };

    const aiResult = await deps.aiResolver!.resolve(bundle);

    if (aiResult && aiResult.resolved && aiResult.files.length > 0) {
      // Apply AI resolutions
      let allApplied = true;
      for (const file of aiResult.files) {
        try {
          const fullPath = join(repoPath, file.path);
          writeFileSync(fullPath, file.resolvedContent, 'utf-8');
          await this.git.add(file.path);

          const conflictId = conflictRecords.get(file.path);
          if (conflictId) {
            deps.conflictHistory.insertAttempt({
              conflict_id: conflictId,
              tier: 4,
              strategy: 'ai-patch',
              confidence: file.confidence,
              outcome: 'success',
              model_id: aiResult.modelId,
              prompt_hash: aiResult.promptHash,
            });
          }
          attempts.push({
            tier: 4,
            strategy: 'ai-patch',
            confidence: file.confidence,
            outcome: 'success',
          });
        } catch {
          allApplied = false;
          const conflictId = conflictRecords.get(file.path);
          if (conflictId) {
            deps.conflictHistory.insertAttempt({
              conflict_id: conflictId,
              tier: 4,
              strategy: 'ai-patch',
              confidence: file.confidence,
              outcome: 'failed',
              model_id: aiResult.modelId,
              prompt_hash: aiResult.promptHash,
            });
          }
          attempts.push({
            tier: 4,
            strategy: 'ai-patch',
            confidence: file.confidence,
            outcome: 'failed',
          });
        }
      }

      if (allApplied) {
        // Check if all unresolved files are now resolved
        const stillConflicted = (await this.git.status()).conflicted;
        if (stillConflicted.length === 0) {
          try {
            await this.git.commit(`Merge branch '${item.source_branch}' (Tier 4 AI-resolved)`);
            const targetHeadAfter = (await this.git.revparse([item.target_branch])).trim();
            return {
              outcome: 'merged',
              tier: 'tier4',
              mode: 'ai-patch',
              premergeStatus: 'conflict',
              targetHeadBefore: targetSha,
              targetHeadAfter,
              conflicts: [],
              errorCode: null,
              errorMessage: null,
              durationMs: 0,
            };
          } catch {
            // Commit failed — fall through to escalation
          }
        }
      }
    } else {
      // AI resolution failed
      for (const filePath of unresolvedFiles) {
        const conflictId = conflictRecords.get(filePath);
        if (conflictId) {
          deps.conflictHistory.insertAttempt({
            conflict_id: conflictId,
            tier: 4,
            strategy: 'ai-patch',
            outcome: 'failed',
            model_id: aiResult?.modelId ?? 'unknown',
            prompt_hash: aiResult?.promptHash ?? 'unknown',
          });
        }
      }
      attempts.push({ tier: 4, strategy: 'ai-patch', outcome: 'failed' });
    }

    return null; // Signal to escalate
  }

  private getPrimarySide(sides: Map<string, 'ours' | 'theirs'>): 'ours' | 'theirs' {
    let oursCount = 0;
    let theirsCount = 0;
    for (const side of sides.values()) {
      if (side === 'ours') oursCount++;
      else theirsCount++;
    }
    return oursCount >= theirsCount ? 'ours' : 'theirs';
  }

  // ─── Pre-merge check ─────────────────────────────────────────────────

  async preMergeCheck(targetRef: string, sourceRef: string): Promise<PreMergeCheckResult> {
    try {
      const cwd = this.repoPath ?? (await this.git.revparse(['--show-toplevel'])).trim();
      const { stdout } = await execFileAsync(
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
        const conflicts = lines.slice(1).filter((l) => l.trim() !== '');
        return { status: 'conflict', treeSha: lines[0] ?? null, conflicts };
      }

      return { status: 'fatal', treeSha: null, conflicts: [] };
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private async validatePreconditions(item: MergeQueueItem): Promise<void> {
    try {
      await this.git.revparse(['--verify', item.source_branch]);
    } catch {
      throw new MergeError('Source branch does not exist', {
        code: 'BRANCH_NOT_FOUND',
        branch: item.source_branch,
      });
    }

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
    const gitErr = err as { git?: { conflicts?: string[] } };
    if (gitErr?.git?.conflicts && Array.isArray(gitErr.git.conflicts)) {
      return gitErr.git.conflicts;
    }

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
