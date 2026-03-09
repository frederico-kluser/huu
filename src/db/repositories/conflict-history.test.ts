import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConflictHistoryRepository } from './conflict-history.js';
import { openDatabase } from '../connection.js';
import { migrate } from '../migrator.js';

describe('ConflictHistoryRepository', () => {
  let db: Database.Database;
  let repo: ConflictHistoryRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
    repo = new ConflictHistoryRepository(db);
  });

  afterEach(() => {
    db?.close();
  });

  // ── merge_conflicts CRUD ──────────────────────────────────────────

  describe('insertConflict', () => {
    it('should insert and return a conflict record', () => {
      const conflict = repo.insertConflict({
        queue_item_id: 'q-1',
        file_path: 'src/app.ts',
        conflict_fingerprint: 'fp-abc',
        conflict_type: 'content',
        merge_base_sha: 'base-sha',
        ours_sha: 'ours-sha',
        theirs_sha: 'theirs-sha',
      });

      expect(conflict.id).toBeTruthy();
      expect(conflict.file_path).toBe('src/app.ts');
      expect(conflict.conflict_type).toBe('content');
      expect(conflict.queue_item_id).toBe('q-1');
    });

    it('should retrieve conflict by id', () => {
      const inserted = repo.insertConflict({
        queue_item_id: 'q-2',
        file_path: 'src/b.ts',
        conflict_fingerprint: 'fp-def',
        conflict_type: 'content',
        merge_base_sha: 'base',
        ours_sha: 'ours',
        theirs_sha: 'theirs',
      });

      const retrieved = repo.getConflictById(inserted.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.file_path).toBe('src/b.ts');
    });
  });

  // ── merge_resolution_attempts CRUD ────────────────────────────────

  describe('insertAttempt', () => {
    it('should insert and return an attempt record', () => {
      const conflict = repo.insertConflict({
        queue_item_id: 'q-1',
        file_path: 'src/app.ts',
        conflict_fingerprint: 'fp-abc',
        conflict_type: 'content',
        merge_base_sha: 'base',
        ours_sha: 'ours',
        theirs_sha: 'theirs',
      });

      const attempt = repo.insertAttempt({
        conflict_id: conflict.id,
        tier: 3,
        strategy: 'x-ours',
        selected_side: 'ours',
        confidence: 0.85,
        outcome: 'success',
      });

      expect(attempt.id).toBeTruthy();
      expect(attempt.tier).toBe(3);
      expect(attempt.strategy).toBe('x-ours');
      expect(attempt.outcome).toBe('success');
      expect(attempt.confidence).toBe(0.85);
    });

    it('should list attempts by conflict', () => {
      const conflict = repo.insertConflict({
        queue_item_id: 'q-1',
        file_path: 'src/app.ts',
        conflict_fingerprint: 'fp-abc',
        conflict_type: 'content',
        merge_base_sha: 'base',
        ours_sha: 'ours',
        theirs_sha: 'theirs',
      });

      repo.insertAttempt({
        conflict_id: conflict.id,
        tier: 3,
        strategy: 'x-ours',
        outcome: 'failed',
      });

      repo.insertAttempt({
        conflict_id: conflict.id,
        tier: 4,
        strategy: 'ai-patch',
        outcome: 'success',
        model_id: 'claude-sonnet',
      });

      const attempts = repo.getAttemptsByConflict(conflict.id);
      expect(attempts).toHaveLength(2);
      expect(attempts[0]!.tier).toBe(3);
      expect(attempts[1]!.tier).toBe(4);
    });
  });

  // ── Conflict queries ──────────────────────────────────────────────

  describe('listConflictsByQueueItem', () => {
    it('should list conflicts for a queue item', () => {
      repo.insertConflict({
        queue_item_id: 'q-1',
        file_path: 'src/a.ts',
        conflict_fingerprint: 'fp-1',
        conflict_type: 'content',
        merge_base_sha: 'base',
        ours_sha: 'ours',
        theirs_sha: 'theirs',
      });

      repo.insertConflict({
        queue_item_id: 'q-1',
        file_path: 'src/b.ts',
        conflict_fingerprint: 'fp-2',
        conflict_type: 'content',
        merge_base_sha: 'base',
        ours_sha: 'ours',
        theirs_sha: 'theirs',
      });

      repo.insertConflict({
        queue_item_id: 'q-2',
        file_path: 'src/c.ts',
        conflict_fingerprint: 'fp-3',
        conflict_type: 'content',
        merge_base_sha: 'base',
        ours_sha: 'ours',
        theirs_sha: 'theirs',
      });

      const conflicts = repo.listConflictsByQueueItem('q-1');
      expect(conflicts).toHaveLength(2);
    });
  });

  // ── Strategy stats ────────────────────────────────────────────────

  describe('getStrategyStats', () => {
    it('should compute success rates by strategy', () => {
      // Create 4 conflicts for the same file with varying outcomes
      for (let i = 0; i < 4; i++) {
        const conflict = repo.insertConflict({
          queue_item_id: `q-${i}`,
          file_path: 'src/hot.ts',
          conflict_fingerprint: `fp-${i}`,
          conflict_type: 'content',
          merge_base_sha: `base-${i}`,
          ours_sha: `ours-${i}`,
          theirs_sha: `theirs-${i}`,
        });

        repo.insertAttempt({
          conflict_id: conflict.id,
          tier: 3,
          strategy: 'x-ours',
          selected_side: 'ours',
          outcome: i < 3 ? 'success' : 'failed',
        });
      }

      const stats = repo.getStrategyStats('src/hot.ts', 3);
      expect(stats).toHaveLength(1);
      expect(stats[0]!.strategy).toBe('x-ours');
      expect(stats[0]!.attempts).toBe(4);
      expect(stats[0]!.success_rate).toBe(0.75);
    });

    it('should respect minimum sample threshold', () => {
      const conflict = repo.insertConflict({
        queue_item_id: 'q-1',
        file_path: 'src/rare.ts',
        conflict_fingerprint: 'fp-1',
        conflict_type: 'content',
        merge_base_sha: 'base',
        ours_sha: 'ours',
        theirs_sha: 'theirs',
      });

      repo.insertAttempt({
        conflict_id: conflict.id,
        tier: 3,
        strategy: 'x-theirs',
        outcome: 'success',
      });

      // Default minSamples=3, only 1 sample
      const stats = repo.getStrategyStats('src/rare.ts');
      expect(stats).toHaveLength(0);
    });
  });

  // ── Hotspot files ─────────────────────────────────────────────────

  describe('getHotspotFiles', () => {
    it('should return most frequently conflicting files', () => {
      for (let i = 0; i < 5; i++) {
        repo.insertConflict({
          queue_item_id: `q-${i}`,
          file_path: 'src/hot.ts',
          conflict_fingerprint: `fp-hot-${i}`,
          conflict_type: 'content',
          merge_base_sha: `b-${i}`,
          ours_sha: `o-${i}`,
          theirs_sha: `t-${i}`,
        });
      }

      for (let i = 0; i < 2; i++) {
        repo.insertConflict({
          queue_item_id: `q-cold-${i}`,
          file_path: 'src/cold.ts',
          conflict_fingerprint: `fp-cold-${i}`,
          conflict_type: 'content',
          merge_base_sha: `b-${i}`,
          ours_sha: `o-${i}`,
          theirs_sha: `t-${i}`,
        });
      }

      const hotspots = repo.getHotspotFiles(10);
      expect(hotspots).toHaveLength(2);
      expect(hotspots[0]!.file_path).toBe('src/hot.ts');
      expect(hotspots[0]!.conflict_count).toBe(5);
    });
  });

  // ── History scores ────────────────────────────────────────────────

  describe('getHistoryScores', () => {
    it('should compute ours/theirs success rates', () => {
      for (let i = 0; i < 4; i++) {
        const conflict = repo.insertConflict({
          queue_item_id: `q-${i}`,
          file_path: 'src/scored.ts',
          conflict_fingerprint: `fp-${i}`,
          conflict_type: 'content',
          merge_base_sha: `b-${i}`,
          ours_sha: `o-${i}`,
          theirs_sha: `t-${i}`,
        });

        // 3 ours successes, 1 theirs failure
        repo.insertAttempt({
          conflict_id: conflict.id,
          tier: 3,
          strategy: i < 3 ? 'x-ours' : 'x-theirs',
          selected_side: i < 3 ? 'ours' : 'theirs',
          outcome: 'success',
        });
      }

      const scores = repo.getHistoryScores('src/scored.ts');
      expect(scores.ours).toBe(1); // 3/3 successes
      expect(scores.theirs).toBe(1); // 1/1 success
    });

    it('should return default 0.5 for files with no history', () => {
      const scores = repo.getHistoryScores('src/unknown.ts');
      expect(scores.ours).toBe(0.5);
      expect(scores.theirs).toBe(0.5);
    });
  });
});
