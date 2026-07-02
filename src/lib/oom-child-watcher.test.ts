import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectDescendantPids,
  parsePpidFromStat,
  resolveChildOomScoreAdj,
  sweepOnce,
} from './oom-child-watcher.js';

describe('parsePpidFromStat', () => {
  it('parses ppid after the comm field', () => {
    expect(parsePpidFromStat('123 (node) S 77 123 77 0 -1')).toBe(77);
  });

  it('survives comm names containing spaces and parens', () => {
    expect(parsePpidFromStat('42 (tmux: server) (x) S 1 42 42 0')).toBe(1);
  });

  it('returns null on garbage', () => {
    expect(parsePpidFromStat('')).toBeNull();
    expect(parsePpidFromStat('no stat here')).toBeNull();
  });
});

describe('collectDescendantPids (fake /proc)', () => {
  function fakeProc(tree: Record<number, number>): string {
    const dir = mkdtempSync(join(tmpdir(), 'huu-proc-'));
    for (const [pid, ppid] of Object.entries(tree)) {
      mkdirSync(join(dir, pid));
      writeFileSync(join(dir, pid, 'stat'), `${pid} (fake) S ${ppid} ${pid} 0 0`, 'utf8');
    }
    return dir;
  }

  it('walks the transitive tree, excluding unrelated processes', () => {
    // 100 → 200 → 300; 400 unrelated (child of 1).
    const dir = fakeProc({ 200: 100, 300: 200, 400: 1 });
    try {
      expect(collectDescendantPids(100, dir).sort()).toEqual([200, 300]);
      expect(collectDescendantPids(999, dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sweepOnce (fake /proc)', () => {
  it('writes the score to new descendants once and prunes gone pids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'huu-proc-'));
    try {
      mkdirSync(join(dir, '200'));
      writeFileSync(join(dir, '200', 'stat'), '200 (kid) S 100 200 0 0', 'utf8');
      writeFileSync(join(dir, '200', 'oom_score_adj'), '0\n', 'utf8');
      const adjusted = new Set<number>([999]); // a pid that no longer exists
      sweepOnce(100, adjusted, 500, dir);
      expect(readFileSync(join(dir, '200', 'oom_score_adj'), 'utf8')).toBe('500\n');
      expect(adjusted.has(200)).toBe(true);
      expect(adjusted.has(999)).toBe(false); // pruned
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveChildOomScoreAdj', () => {
  it('defaults to +500, clamps to [0, 1000], and 0 disables', () => {
    expect(resolveChildOomScoreAdj({})).toBe(500);
    expect(resolveChildOomScoreAdj({ HUU_CHILD_OOM_SCORE_ADJ: '800' })).toBe(800);
    expect(resolveChildOomScoreAdj({ HUU_CHILD_OOM_SCORE_ADJ: '-200' })).toBe(0);
    expect(resolveChildOomScoreAdj({ HUU_CHILD_OOM_SCORE_ADJ: '9999' })).toBe(1000);
    expect(resolveChildOomScoreAdj({ HUU_CHILD_OOM_SCORE_ADJ: 'garbage' })).toBe(500);
  });
});

// Real-kernel integration (Linux only): spawn a child, sweep the REAL /proc,
// and assert the kernel accepted the raised score. Raising a descendant's
// score needs no privilege, so this is stable on any Linux dev box.
describe.skipIf(process.platform !== 'linux')('sweepOnce (real /proc)', () => {
  it('raises a live child to +500', async () => {
    const child = spawn('sleep', ['5'], { stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 150)); // let /proc materialize
      const adjusted = new Set<number>();
      sweepOnce(process.pid, adjusted, 500);
      expect(adjusted.has(child.pid!)).toBe(true);
      expect(readFileSync(`/proc/${child.pid}/oom_score_adj`, 'utf8').trim()).toBe('500');
    } finally {
      child.kill('SIGKILL');
    }
  });
});
