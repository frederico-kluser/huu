import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentBranchName,
  agentWorktreePath,
  integrationBranchName,
  integrationWorktreePath,
  worktreeBaseDir,
} from './branch-namer.js';

describe('branch-namer', () => {
  const REPO = '/home/user/proj';
  const RUN = 'run-abc';

  let originalBase: string | undefined;
  beforeEach(() => {
    originalBase = process.env.HUU_WORKTREE_BASE;
    delete process.env.HUU_WORKTREE_BASE;
  });
  afterEach(() => {
    if (originalBase === undefined) delete process.env.HUU_WORKTREE_BASE;
    else process.env.HUU_WORKTREE_BASE = originalBase;
  });

  describe('branch names (no env interaction)', () => {
    it('agentBranchName uses huu/<runId>/agent-<id>', () => {
      expect(agentBranchName(RUN, 3)).toBe('huu/run-abc/agent-3');
    });

    it('agentBranchName appends -retry on attempt > 1', () => {
      expect(agentBranchName(RUN, 3, 2)).toBe('huu/run-abc/agent-3-retry');
    });

    it('integrationBranchName uses huu/<runId>/integration', () => {
      expect(integrationBranchName(RUN)).toBe('huu/run-abc/integration');
    });
  });

  describe('default behavior (HUU_WORKTREE_BASE unset)', () => {
    it('agent worktree lives under <repo>/.huu-worktrees/<runId>/', () => {
      expect(agentWorktreePath(REPO, RUN, 1)).toBe(
        '/home/user/proj/.huu-worktrees/run-abc/agent-1',
      );
    });

    it('integration worktree lives under <repo>/.huu-worktrees/<runId>/integration', () => {
      expect(integrationWorktreePath(REPO, RUN)).toBe(
        '/home/user/proj/.huu-worktrees/run-abc/integration',
      );
    });

    it('worktreeBaseDir is <repo>/.huu-worktrees/<runId>', () => {
      expect(worktreeBaseDir(REPO, RUN)).toBe('/home/user/proj/.huu-worktrees/run-abc');
    });
  });

  describe('HUU_WORKTREE_BASE absolute path', () => {
    beforeEach(() => {
      process.env.HUU_WORKTREE_BASE = '/var/huu-volume';
    });

    it('agent worktree lives under the absolute base, ignoring repoRoot', () => {
      expect(agentWorktreePath(REPO, RUN, 5)).toBe('/var/huu-volume/run-abc/agent-5');
    });

    it('integration worktree lives under the absolute base', () => {
      expect(integrationWorktreePath(REPO, RUN)).toBe('/var/huu-volume/run-abc/integration');
    });

    it('retry suffix still applies', () => {
      expect(agentWorktreePath(REPO, RUN, 5, 2)).toBe('/var/huu-volume/run-abc/agent-5-retry');
    });
  });

  describe('HUU_WORKTREE_BASE relative path', () => {
    beforeEach(() => {
      process.env.HUU_WORKTREE_BASE = '.huu-cache';
    });

    it('relative override is resolved against repoRoot', () => {
      expect(agentWorktreePath(REPO, RUN, 1)).toBe(
        '/home/user/proj/.huu-cache/run-abc/agent-1',
      );
    });
  });

  describe('HUU_WORKTREE_BASE empty string falls back to default', () => {
    beforeEach(() => {
      process.env.HUU_WORKTREE_BASE = '';
    });

    it('empty value is treated as unset', () => {
      expect(agentWorktreePath(REPO, RUN, 1)).toBe(
        '/home/user/proj/.huu-worktrees/run-abc/agent-1',
      );
    });
  });
});
