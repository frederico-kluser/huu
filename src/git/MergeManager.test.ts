import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import Database from 'better-sqlite3';
import { MergeManager } from './MergeManager.js';
import { MergeQueueRepository } from '../db/repositories/merge-queue.js';
import { MergeResultsRepository } from '../db/repositories/merge-results.js';
import { migrate } from '../db/migrator.js';
import { openDatabase } from '../db/connection.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory for test repos. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huu-merge-test-'));
}

/** Initialize a bare-like repo with an initial commit on main. */
async function initTestRepo(dir: string): Promise<SimpleGit> {
  fs.mkdirSync(dir, { recursive: true });
  const git = simpleGit({ baseDir: dir });
  await git.init();
  await git.addConfig('user.email', 'test@huu.dev');
  await git.addConfig('user.name', 'HUU Test');

  // Create initial commit on main
  const filePath = path.join(dir, 'README.md');
  fs.writeFileSync(filePath, '# Test Repo\n');
  await git.add('README.md');
  await git.commit('Initial commit');

  // Ensure we're on main
  const branches = await git.branchLocal();
  if (branches.current !== 'main') {
    await git.branch(['-m', branches.current, 'main']);
  }

  return git;
}

/** Create a branch with a new file commit. */
async function createBranchWithCommit(
  git: SimpleGit,
  branchName: string,
  baseBranch: string,
  fileName: string,
  content: string,
): Promise<string> {
  await git.checkout(baseBranch);
  await git.checkoutLocalBranch(branchName);
  const dir = (await git.revparse(['--show-toplevel'])).trim();
  const filePath = path.join(dir, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  await git.add(fileName);
  await git.commit(`Add ${fileName}`);
  const sha = (await git.revparse(['HEAD'])).trim();
  await git.checkout(baseBranch);
  return sha;
}

/** Set up in-memory DB with merge tables. */
function setupDb(): Database.Database {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MergeManager', () => {
  let tmpDir: string;
  let repoDir: string;
  let git: SimpleGit;
  let db: Database.Database;
  let queueRepo: MergeQueueRepository;
  let resultsRepo: MergeResultsRepository;
  let manager: MergeManager;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    repoDir = path.join(tmpDir, 'repo');
    git = await initTestRepo(repoDir);
    db = setupDb();
    queueRepo = new MergeQueueRepository(db);
    resultsRepo = new MergeResultsRepository(db);
    manager = new MergeManager(git, queueRepo, resultsRepo, {
      workerId: 'test-worker',
      repoPath: repoDir,
    });
  });

  afterEach(() => {
    db?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── FIFO order ─────────────────────────────────────────────────────

  describe('FIFO merge queue', () => {
    it('should process requests in FIFO order', async () => {
      // Create 3 branches
      const sha1 = await createBranchWithCommit(git, 'feature-1', 'main', 'a.txt', 'aaa');
      const sha2 = await createBranchWithCommit(git, 'feature-2', 'main', 'b.txt', 'bbb');
      const sha3 = await createBranchWithCommit(git, 'feature-3', 'main', 'c.txt', 'ccc');

      // Enqueue in order
      manager.enqueue({ source_branch: 'feature-1', source_head_sha: sha1, request_id: 'req-1' });
      manager.enqueue({ source_branch: 'feature-2', source_head_sha: sha2, request_id: 'req-2' });
      manager.enqueue({ source_branch: 'feature-3', source_head_sha: sha3, request_id: 'req-3' });

      // Process all
      const r1 = await manager.processNext();
      const r2 = await manager.processNext();
      const r3 = await manager.processNext();
      const r4 = await manager.processNext();

      expect(r1?.outcome).toBe('merged');
      expect(r2?.outcome).toBe('merged');
      expect(r3?.outcome).toBe('merged');
      expect(r4).toBeNull(); // Queue empty

      // Verify all queue items are merged
      const q1 = queueRepo.getByRequestId('req-1');
      const q2 = queueRepo.getByRequestId('req-2');
      const q3 = queueRepo.getByRequestId('req-3');
      expect(q1?.status).toBe('merged');
      expect(q2?.status).toBe('merged');
      expect(q3?.status).toBe('merged');

      // Verify results logged for all
      const results1 = resultsRepo.listByRequestId('req-1');
      const results2 = resultsRepo.listByRequestId('req-2');
      const results3 = resultsRepo.listByRequestId('req-3');
      expect(results1).toHaveLength(1);
      expect(results2).toHaveLength(1);
      expect(results3).toHaveLength(1);
    });

    it('should not dequeue if queue is empty', async () => {
      const result = await manager.processNext();
      expect(result).toBeNull();
    });

    it('should handle concurrent enqueue without duplicates', () => {
      const items: ReturnType<typeof manager.enqueue>[] = [];
      for (let i = 0; i < 10; i++) {
        items.push(
          manager.enqueue({
            source_branch: `branch-${i}`,
            source_head_sha: `sha-${i}`,
            request_id: `req-${i}`,
          }),
        );
      }

      expect(items).toHaveLength(10);
      const ids = new Set(items.map((it) => it.id));
      expect(ids.size).toBe(10);
    });
  });

  // ── Tier 1: fast-forward ───────────────────────────────────────────

  describe('Tier 1: fast-forward', () => {
    it('should fast-forward when target is ancestor of source', async () => {
      const sha = await createBranchWithCommit(git, 'feature-ff', 'main', 'ff.txt', 'fast-forward content');

      manager.enqueue({ source_branch: 'feature-ff', source_head_sha: sha, request_id: 'req-ff' });
      const result = await manager.processNext();

      expect(result).not.toBeNull();
      expect(result!.outcome).toBe('merged');
      expect(result!.tier).toBe('tier1');
      expect(result!.mode).toBe('ff-only');
      expect(result!.conflicts).toHaveLength(0);

      // Verify no merge commit (ff-only means target just advances)
      const log = await git.log({ maxCount: 1 });
      expect(log.latest?.message).toBe('Add ff.txt');

      // Verify result was logged
      const results = resultsRepo.listByRequestId('req-ff');
      expect(results).toHaveLength(1);
      expect(results[0]!.outcome).toBe('merged');
      expect(results[0]!.tier_selected).toBe('tier1');
    });

    it('should detect already-merged as no-op', async () => {
      const sha = await createBranchWithCommit(git, 'feature-noop', 'main', 'noop.txt', 'noop content');

      // First merge
      manager.enqueue({ source_branch: 'feature-noop', source_head_sha: sha, request_id: 'req-noop-1' });
      await manager.processNext();

      // Enqueue same branch again (already merged)
      manager.enqueue({ source_branch: 'feature-noop', source_head_sha: sha, request_id: 'req-noop-2' });
      const result = await manager.processNext();

      expect(result).not.toBeNull();
      expect(result!.outcome).toBe('merged');
      expect(result!.tier).toBe('tier1');
      expect(result!.mode).toBe('noop_already_merged');
    });
  });

  // ── Tier 2: recursive merge ────────────────────────────────────────

  describe('Tier 2: recursive merge', () => {
    it('should create merge commit when diverged without conflict', async () => {
      // Create divergence: main gets one file, feature gets another
      const featureSha = await createBranchWithCommit(
        git,
        'feature-div',
        'main',
        'feature-file.txt',
        'feature content',
      );

      // Advance main independently
      await git.checkout('main');
      const mainFile = path.join(repoDir, 'main-file.txt');
      fs.writeFileSync(mainFile, 'main content');
      await git.add('main-file.txt');
      await git.commit('Add main-file.txt');

      manager.enqueue({
        source_branch: 'feature-div',
        source_head_sha: featureSha,
        request_id: 'req-div',
      });
      const result = await manager.processNext();

      expect(result).not.toBeNull();
      expect(result!.outcome).toBe('merged');
      expect(result!.tier).toBe('tier2');
      expect(result!.mode).toBe('no-ff-ort');
      expect(result!.conflicts).toHaveLength(0);

      // Verify merge commit exists
      const log = await git.log({ maxCount: 1 });
      expect(log.latest?.message).toMatch(/Merge branch/);

      // Verify both files exist
      expect(fs.existsSync(path.join(repoDir, 'feature-file.txt'))).toBe(true);
      expect(fs.existsSync(path.join(repoDir, 'main-file.txt'))).toBe(true);

      // Verify result logged
      const results = resultsRepo.listByRequestId('req-div');
      expect(results).toHaveLength(1);
      expect(results[0]!.tier_selected).toBe('tier2');
      expect(results[0]!.outcome).toBe('merged');
      expect(results[0]!.target_head_before).not.toBeNull();
      expect(results[0]!.target_head_after).not.toBeNull();
      expect(results[0]!.target_head_before).not.toBe(results[0]!.target_head_after);
    });
  });

  // ── Pre-merge conflict detection ───────────────────────────────────

  describe('Pre-merge conflict detection', () => {
    it('should detect conflict via merge-tree and not execute merge', async () => {
      // Create conflict: both modify the same file
      const featureSha = await createBranchWithCommit(
        git,
        'feature-conflict',
        'main',
        'README.md',
        '# Conflict from feature\n',
      );

      // Modify same file on main
      await git.checkout('main');
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# Conflict from main\n');
      await git.add('README.md');
      await git.commit('Modify README on main');

      manager.enqueue({
        source_branch: 'feature-conflict',
        source_head_sha: featureSha,
        request_id: 'req-conflict',
      });
      const result = await manager.processNext();

      expect(result).not.toBeNull();
      expect(result!.outcome).toBe('conflict');
      expect(result!.premergeStatus).toBe('conflict');
      expect(result!.tier).toBe('none');
      expect(result!.conflicts.length).toBeGreaterThan(0);
      expect(result!.errorCode).toBe('PREMERGE_CONFLICT');

      // Verify queue item is marked as conflict
      const queueItem = queueRepo.getByRequestId('req-conflict');
      expect(queueItem?.status).toBe('conflict');

      // Verify merge result logged
      const results = resultsRepo.listByRequestId('req-conflict');
      expect(results).toHaveLength(1);
      expect(results[0]!.outcome).toBe('conflict');
      expect(results[0]!.premerge_status).toBe('conflict');
    });
  });

  // ── Conflict cleanup ───────────────────────────────────────────────

  describe('Conflict cleanup', () => {
    it('should leave workspace clean after conflict detection', async () => {
      // Create conflict
      const featureSha = await createBranchWithCommit(
        git,
        'feature-cleanup',
        'main',
        'README.md',
        '# From feature\n',
      );

      await git.checkout('main');
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# From main\n');
      await git.add('README.md');
      await git.commit('Modify README on main for cleanup test');

      manager.enqueue({
        source_branch: 'feature-cleanup',
        source_head_sha: featureSha,
        request_id: 'req-cleanup',
      });
      await manager.processNext();

      // Verify no MERGE_HEAD left
      const mergeHeadPath = path.join(repoDir, '.git', 'MERGE_HEAD');
      expect(fs.existsSync(mergeHeadPath)).toBe(false);

      // Verify git status is clean
      const status = await git.status();
      expect(status.conflicted).toHaveLength(0);
    });
  });

  // ── Crash recovery (lease expiry) ──────────────────────────────────

  describe('Crash recovery', () => {
    it('should recover items with expired leases', () => {
      // Enqueue an item
      queueRepo.enqueue({
        request_id: 'req-crash',
        source_branch: 'feature-crash',
        source_head_sha: 'abc123',
        target_branch: 'main',
      });

      // Manually claim with expired lease
      db.prepare(`
        UPDATE merge_queue
        SET status = 'in_progress',
            lease_owner = 'dead-worker',
            lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 seconds'),
            attempts = 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE request_id = 'req-crash'
      `).run();

      // Recovery should happen during next claim
      const recovered = queueRepo.recoverExpiredLeases();
      expect(recovered).toBe(1);

      // Item should be back in retry_wait
      const item = queueRepo.getByRequestId('req-crash');
      expect(item?.status).toBe('retry_wait');
      expect(item?.lease_owner).toBeNull();
    });

    it('should fail items that exceed max attempts on recovery', () => {
      queueRepo.enqueue({
        request_id: 'req-exhausted',
        source_branch: 'feature-exhausted',
        source_head_sha: 'def456',
        target_branch: 'main',
        max_attempts: 2,
      });

      // Simulate 2 attempts with expired lease
      db.prepare(`
        UPDATE merge_queue
        SET status = 'in_progress',
            lease_owner = 'dead-worker',
            lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 seconds'),
            attempts = 2,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE request_id = 'req-exhausted'
      `).run();

      queueRepo.recoverExpiredLeases();

      const item = queueRepo.getByRequestId('req-exhausted');
      expect(item?.status).toBe('failed');
    });
  });

  // ── Stale source SHA ───────────────────────────────────────────────

  describe('Stale source SHA', () => {
    it('should fail when source SHA changes after enqueue', async () => {
      // Create branch
      await createBranchWithCommit(git, 'feature-stale', 'main', 'stale.txt', 'original');
      const staleShaThatDoesntExist = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      manager.enqueue({
        source_branch: 'feature-stale',
        source_head_sha: staleShaThatDoesntExist,
        request_id: 'req-stale',
      });
      const result = await manager.processNext();

      expect(result).not.toBeNull();
      expect(result!.outcome).toBe('failed');
      expect(result!.errorCode).toBe('STALE_SHA');
      expect(result!.errorMessage).toContain('Source SHA changed');

      const queueItem = queueRepo.getByRequestId('req-stale');
      expect(queueItem?.status).toBe('failed');
    });
  });

  // ── Pre-merge check unit test ──────────────────────────────────────

  describe('preMergeCheck', () => {
    it('should return clean for non-conflicting refs', async () => {
      const sha = await createBranchWithCommit(git, 'feature-precheck', 'main', 'precheck.txt', 'content');

      const mainSha = (await git.revparse(['main'])).trim();
      const result = await manager.preMergeCheck(mainSha, sha);

      expect(result.status).toBe('clean');
      expect(result.treeSha).toBeTruthy();
      expect(result.conflicts).toHaveLength(0);
    });

    it('should return conflict for conflicting refs', async () => {
      const featureSha = await createBranchWithCommit(
        git,
        'feature-precheck-conflict',
        'main',
        'README.md',
        '# Conflict content\n',
      );

      await git.checkout('main');
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# Different content\n');
      await git.add('README.md');
      await git.commit('Modify README for precheck conflict');

      const mainSha = (await git.revparse(['main'])).trim();
      const result = await manager.preMergeCheck(mainSha, featureSha);

      expect(result.status).toBe('conflict');
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('should not modify working tree or index', async () => {
      const featureSha = await createBranchWithCommit(
        git,
        'feature-precheck-clean',
        'main',
        'clean.txt',
        'clean content',
      );

      await git.checkout('main');
      const statusBefore = await git.status();

      const mainSha = (await git.revparse(['main'])).trim();
      await manager.preMergeCheck(mainSha, featureSha);

      const statusAfter = await git.status();
      expect(statusAfter.files).toEqual(statusBefore.files);
    });
  });

  // ── Merge result logging ───────────────────────────────────────────

  describe('Merge result logging', () => {
    it('should log 100% of merge attempts', async () => {
      // Successful merge
      const sha1 = await createBranchWithCommit(git, 'feature-log-1', 'main', 'log1.txt', 'log1');
      manager.enqueue({ source_branch: 'feature-log-1', source_head_sha: sha1, request_id: 'req-log-1' });
      await manager.processNext();

      // Conflict
      const sha2 = await createBranchWithCommit(
        git,
        'feature-log-2',
        'main',
        'log1.txt',
        'conflicting content for log1.txt',
      );
      await git.checkout('main');
      fs.writeFileSync(path.join(repoDir, 'log1.txt'), 'main side conflict');
      await git.add('log1.txt');
      await git.commit('conflict on main');

      manager.enqueue({ source_branch: 'feature-log-2', source_head_sha: sha2, request_id: 'req-log-2' });
      await manager.processNext();

      const allResults = resultsRepo.listRecent();
      expect(allResults.length).toBe(2);

      // Verify results correlate with queue items
      const q1 = queueRepo.getByRequestId('req-log-1')!;
      const q2 = queueRepo.getByRequestId('req-log-2')!;
      const r1 = resultsRepo.listByQueueId(q1.id);
      const r2 = resultsRepo.listByQueueId(q2.id);
      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
      expect(r1[0]!.outcome).toBe('merged');
      expect(r2[0]!.outcome).toBe('conflict');
    });
  });

  // ── Queue status counts ────────────────────────────────────────────

  describe('Queue status tracking', () => {
    it('should track counts by status', async () => {
      const sha1 = await createBranchWithCommit(git, 'feat-count-1', 'main', 'c1.txt', 'c1');
      const sha2 = await createBranchWithCommit(git, 'feat-count-2', 'main', 'c2.txt', 'c2');

      manager.enqueue({ source_branch: 'feat-count-1', source_head_sha: sha1, request_id: 'req-c1' });
      manager.enqueue({ source_branch: 'feat-count-2', source_head_sha: sha2, request_id: 'req-c2' });

      // Before processing
      let counts = queueRepo.countByStatus();
      expect(counts['queued']).toBe(2);

      // After processing one
      await manager.processNext();
      counts = queueRepo.countByStatus();
      expect(counts['merged']).toBe(1);
      expect(counts['queued']).toBe(1);
    });
  });
});
