import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveMemoryFiles, MemoryFileError, MEMORY_FORMAT_TAG } from './memory-files.js';

describe('resolveMemoryFiles (huu-memory-v1)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'memfiles-test-'));
    writeFileSync(join(root, 'a.ts'), 'a\n', 'utf8');
    writeFileSync(join(root, 'b.ts'), 'b\n', 'utf8');
    writeFileSync(join(root, 'c.ts'), 'c\n', 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeMemory(content: unknown, rel = 'list.json'): string {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    writeFileSync(join(root, rel), text, 'utf8');
    return rel;
  }

  it('parses string and object entries, keeping hints and list order', () => {
    const rel = writeMemory({
      _format: MEMORY_FORMAT_TAG,
      files: ['a.ts', { path: 'b.ts', hint: 'look here' }],
    });
    const res = resolveMemoryFiles(rel, root);
    expect(res.missing).toBe(false);
    expect(res.files).toEqual(['a.ts', 'b.ts']);
    expect(res.hints.get('b.ts')).toBe('look here');
    expect(res.hints.has('a.ts')).toBe(false);
  });

  it('orders by priority desc, then list order', () => {
    const rel = writeMemory({
      _format: MEMORY_FORMAT_TAG,
      files: [
        { path: 'a.ts', priority: 1 },
        { path: 'b.ts', priority: 10 },
        'c.ts',
      ],
    });
    const res = resolveMemoryFiles(rel, root);
    expect(res.files).toEqual(['b.ts', 'a.ts', 'c.ts']);
  });

  it('missing memory file resolves to zero files with a warning (not an error)', () => {
    const res = resolveMemoryFiles('nope.json', root);
    expect(res.missing).toBe(true);
    expect(res.files).toEqual([]);
    expect(res.warnings.join(' ')).toContain('not found');
  });

  it('invalid JSON throws MemoryFileError (corruption is never legitimate)', () => {
    const rel = writeMemory('{ not json');
    expect(() => resolveMemoryFiles(rel, root)).toThrow(MemoryFileError);
  });

  it('wrong _format throws MemoryFileError', () => {
    const rel = writeMemory({ _format: 'huu-memory-v999', files: ['a.ts'] });
    expect(() => resolveMemoryFiles(rel, root)).toThrow(MemoryFileError);
  });

  it('drops escaping, skipped, duplicate and nonexistent paths with warnings', () => {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'x.js'), 'x\n', 'utf8');
    const rel = writeMemory({
      _format: MEMORY_FORMAT_TAG,
      files: ['../escape.ts', '/abs.ts', 'node_modules/x.js', 'missing.ts', 'a.ts', 'a.ts'],
    });
    const res = resolveMemoryFiles(rel, root);
    expect(res.files).toEqual(['a.ts']);
    const all = res.warnings.join(' | ');
    expect(all).toContain('escapes');
    expect(all).toContain('skip list');
    expect(all).toContain('does not exist');
    expect(all).toContain('duplicate');
  });

  it('throws when entries were listed but NONE are usable', () => {
    const rel = writeMemory({ _format: MEMORY_FORMAT_TAG, files: ['missing-1.ts', 'missing-2.ts'] });
    expect(() => resolveMemoryFiles(rel, root)).toThrow(MemoryFileError);
  });

  it('an explicitly empty files array resolves to zero tasks without error', () => {
    const rel = writeMemory({ _format: MEMORY_FORMAT_TAG, files: [] });
    const res = resolveMemoryFiles(rel, root);
    expect(res.missing).toBe(false);
    expect(res.files).toEqual([]);
  });

  it('truncates to maxFiles by priority with an explicit warning', () => {
    const rel = writeMemory({
      _format: MEMORY_FORMAT_TAG,
      files: [
        { path: 'a.ts', priority: 1 },
        { path: 'b.ts', priority: 3 },
        { path: 'c.ts', priority: 2 },
      ],
    });
    const res = resolveMemoryFiles(rel, root, 2);
    expect(res.files).toEqual(['b.ts', 'c.ts']);
    expect(res.warnings.join(' ')).toContain('truncated to maxFiles=2');
  });

  // The memory layer must NEVER fail a run for a SALVAGEABLE reason. A soft,
  // optional field over its cap (or of the wrong type) is salvaged with a
  // warning, not thrown — the regression that motivated this contract.
  it('truncates an over-length hint instead of failing the run', () => {
    const longHint = 'x'.repeat(800);
    const rel = writeMemory({
      _format: MEMORY_FORMAT_TAG,
      files: [{ path: 'a.ts', hint: longHint }],
    });
    const res = resolveMemoryFiles(rel, root);
    expect(res.missing).toBe(false);
    expect(res.files).toEqual(['a.ts']);
    expect(res.hints.get('a.ts')).toBe('x'.repeat(600));
    expect(res.warnings.join(' ')).toContain('truncated hint');
  });

  it('ignores a non-string hint and a non-numeric priority but keeps the entry', () => {
    const rel = writeMemory({
      _format: MEMORY_FORMAT_TAG,
      files: [{ path: 'a.ts', hint: 123, priority: 'high' }],
    });
    const res = resolveMemoryFiles(rel, root);
    expect(res.files).toEqual(['a.ts']);
    expect(res.hints.has('a.ts')).toBe(false);
    const w = res.warnings.join(' | ');
    expect(w).toContain('non-string hint');
    expect(w).toContain('non-numeric priority');
  });

  it('drops malformed entries (no usable path) but keeps the good ones', () => {
    const rel = writeMemory({
      _format: MEMORY_FORMAT_TAG,
      files: [42, null, { hint: 'no path here' }, { path: '' }, 'a.ts'],
    });
    const res = resolveMemoryFiles(rel, root);
    expect(res.files).toEqual(['a.ts']);
    expect(res.warnings.join(' ')).toContain('dropped entry');
  });
});
