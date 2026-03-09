import { describe, it, expect } from 'vitest';
import { decideCleanup } from '../cleanup.js';

describe('decideCleanup', () => {
  const baseCandidate = {
    hasLivePid: false,
    hasUncommittedChanges: false,
    hasUnmergedCommits: false,
    isLocked: false,
    staleMs: 10 * 60 * 1000, // 10 minutes
    staleThresholdMs: 5 * 60 * 1000, // 5 minutes
  };

  it('skips when process is alive', () => {
    const result = decideCleanup({ ...baseCandidate, hasLivePid: true });
    expect(result.action).toBe('skip');
    expect(result.reason).toBe('process_alive');
  });

  it('skips when locked', () => {
    const result = decideCleanup({ ...baseCandidate, isLocked: true });
    expect(result.action).toBe('skip');
    expect(result.reason).toBe('worktree_locked');
  });

  it('skips when not stale enough', () => {
    const result = decideCleanup({ ...baseCandidate, staleMs: 1000 });
    expect(result.action).toBe('skip');
    expect(result.reason).toBe('not_stale_enough');
  });

  it('quarantines when has uncommitted changes', () => {
    const result = decideCleanup({ ...baseCandidate, hasUncommittedChanges: true });
    expect(result.action).toBe('quarantine');
    expect(result.reason).toBe('has_uncommitted_changes');
  });

  it('quarantines when has unmerged commits', () => {
    const result = decideCleanup({ ...baseCandidate, hasUnmergedCommits: true });
    expect(result.action).toBe('quarantine');
    expect(result.reason).toBe('has_unmerged_commits');
  });

  it('removes when safe', () => {
    const result = decideCleanup(baseCandidate);
    expect(result.action).toBe('remove');
    expect(result.reason).toBe('safe_to_remove');
  });

  it('prioritizes process_alive over uncommitted changes', () => {
    const result = decideCleanup({
      ...baseCandidate,
      hasLivePid: true,
      hasUncommittedChanges: true,
    });
    expect(result.action).toBe('skip');
    expect(result.reason).toBe('process_alive');
  });

  it('prioritizes locked over uncommitted changes', () => {
    const result = decideCleanup({
      ...baseCandidate,
      isLocked: true,
      hasUncommittedChanges: true,
    });
    expect(result.action).toBe('skip');
    expect(result.reason).toBe('worktree_locked');
  });

  it('prioritizes uncommitted changes over unmerged commits', () => {
    const result = decideCleanup({
      ...baseCandidate,
      hasUncommittedChanges: true,
      hasUnmergedCommits: true,
    });
    expect(result.action).toBe('quarantine');
    expect(result.reason).toBe('has_uncommitted_changes');
  });
});
