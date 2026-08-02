import { describe, it, expect } from 'vitest';
import {
  checkWriteSetViolations,
  collideDeclaredOwnership,
  compactionReminder,
} from './write-sets.js';
import type { WriteSetViolation } from './write-sets.js';

describe('write-set runtime disjunction', () => {
  it('detects two agents writing to the same file / dois agentes mesmo arquivo', () => {
    const filesModified = new Map<number, readonly string[]>([
      [1, ['src/foo.ts', 'src/shared.ts']],
      [2, ['src/bar.ts', 'src/shared.ts']],
    ]);
    const violations = checkWriteSetViolations(filesModified);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.path).toBe('src/shared.ts');
    expect(new Set(violations[0]!.agentIds)).toEqual(new Set([1, 2]));
  });

  it('detects three agents all touching the same file', () => {
    const filesModified = new Map<number, readonly string[]>([
      [1, ['src/shared.ts']],
      [2, ['src/shared.ts']],
      [3, ['src/shared.ts']],
    ]);
    const violations = checkWriteSetViolations(filesModified);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.agentIds).toEqual([1, 2, 3]);
  });

  it('returns empty when all writes are disjoint', () => {
    const filesModified = new Map<number, readonly string[]>([
      [1, ['src/foo.ts']],
      [2, ['src/bar.ts']],
      [3, ['src/baz.ts']],
    ]);
    const violations = checkWriteSetViolations(filesModified);
    expect(violations).toHaveLength(0);
  });

  it('returns empty with a single agent', () => {
    const filesModified = new Map<number, readonly string[]>([
      [1, ['src/foo.ts', 'src/bar.ts']],
    ]);
    const violations = checkWriteSetViolations(filesModified);
    expect(violations).toHaveLength(0);
  });

  it('returns empty with no agents', () => {
    const filesModified = new Map<number, readonly string[]>();
    const violations = checkWriteSetViolations(filesModified);
    expect(violations).toHaveLength(0);
  });

  it('excludes .huu/ paths from violation detection', () => {
    const filesModified = new Map<number, readonly string[]>([
      [1, ['.huu/knowledge/study-list.json', 'src/real.ts']],
      [2, ['.huu/knowledge/study-list.json', 'src/real.ts']],
    ]);
    const violations = checkWriteSetViolations(filesModified);
    // .huu/ paths are ignored; only src/real.ts remains.
    expect(violations).toHaveLength(1);
    expect(violations[0]!.path).toBe('src/real.ts');
  });

  it('excludes .env.huu from violation detection', () => {
    const filesModified = new Map<number, readonly string[]>([
      [1, ['.env.huu']],
      [2, ['.env.huu']],
    ]);
    const violations = checkWriteSetViolations(filesModified);
    expect(violations).toHaveLength(0);
  });

  it('excludes .huu- prefixed paths from violation detection', () => {
    const filesModified = new Map<number, readonly string[]>([
      [1, ['.huu-sessions/session.json']],
      [2, ['.huu-sessions/session.json']],
    ]);
    const violations = checkWriteSetViolations(filesModified);
    expect(violations).toHaveLength(0);
  });

  it('returns multiple violations in stable sorted order', () => {
    const filesModified = new Map<number, readonly string[]>([
      [1, ['c.ts', 'a.ts', 'shared.ts']],
      [2, ['b.ts', 'a.ts', 'shared.ts']],
    ]);
    const violations = checkWriteSetViolations(filesModified);
    expect(violations).toHaveLength(2);
    expect(violations[0]!.path).toBe('a.ts');
    expect(violations[1]!.path).toBe('shared.ts');
  });

  it('sorts agentIds within each violation', () => {
    const filesModified = new Map<number, readonly string[]>([
      [5, ['shared.ts']],
      [1, ['shared.ts']],
      [9, ['shared.ts']],
    ]);
    const violations = checkWriteSetViolations(filesModified);
    expect(violations[0]!.agentIds).toEqual([1, 5, 9]);
  });

  it('ignores writes parameter (present for future attribution)', () => {
    // The writes parameter is accepted but not yet used for matching.
    const filesModified = new Map<number, readonly string[]>([
      [1, ['src/foo.ts', 'src/shared.ts']],
      [2, ['src/bar.ts', 'src/shared.ts']],
    ]);
    const violations = checkWriteSetViolations(filesModified, [
      { agentId: 1, globs: ['src/foo.ts'] },
      { agentId: 2, globs: ['src/bar.ts'] },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.path).toBe('src/shared.ts');
  });
});

describe('collideDeclaredOwnership', () => {
  it('flags a file two specs both claim', () => {
    const out = collideDeclaredOwnership(
      new Map([
        ['T-001.md', ['src/a.ts', 'src/b.ts']],
        ['T-002.md', ['src/b.ts']],
      ]),
    );
    expect(out).toEqual([{ path: 'src/b.ts', specs: ['T-001.md', 'T-002.md'] }]);
  });

  it('flags a directory claim that swallows another spec file', () => {
    const out = collideDeclaredOwnership(
      new Map([
        ['T-001.md', ['src/api/']],
        ['T-002.md', ['src/api/routes.ts']],
      ]),
    );
    expect(out).toEqual([{ path: 'src/api/routes.ts', specs: ['T-001.md', 'T-002.md'] }]);
  });

  it('does not flag one spec that claims both the directory and a file inside it', () => {
    expect(
      collideDeclaredOwnership(new Map([['T-001.md', ['src/api/', 'src/api/routes.ts']]])),
    ).toEqual([]);
  });

  it('is empty for a disjoint partition — the normal, wanted outcome', () => {
    expect(
      collideDeclaredOwnership(
        new Map([
          ['T-001.md', ['src/a.ts']],
          ['T-002.md', ['src/b.ts']],
        ]),
      ),
    ).toEqual([]);
  });
});

describe('compactionReminder', () => {
  it('re-states the two facts compaction is documented to lose', () => {
    const text = compactionReminder({
      files: ['.huu/dev/s1/epoch-1/api/T-001.md'],
      ownedPaths: ['src/api/routes.ts'],
    });
    expect(text).toContain('.huu/dev/s1/epoch-1/api/T-001.md');
    expect(text).toContain('src/api/routes.ts');
    expect(text).toContain('WRITE only');
  });

  it('says nothing it cannot back up', () => {
    // A whole-project task declares no ownership; inventing a scope line here
    // would be the header's original defect, one level down.
    const text = compactionReminder({ files: [] });
    expect(text).not.toContain('WRITE only');
    expect(text).toContain('Write it down now');
  });
});
