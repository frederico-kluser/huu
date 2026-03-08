import { describe, it, expect } from 'vitest';
import {
  parseDiffTreeOutput,
  parsePorcelainV2Output,
  emptyFileChangeSummary,
  hasChanges,
  flattenChangedFiles,
} from '../file-changes.js';
import type { FileChangeSummary } from '../file-changes.js';

// ── parseDiffTreeOutput ──────────────────────────────────────────────

describe('parseDiffTreeOutput', () => {
  it('returns empty summary for empty input', () => {
    expect(parseDiffTreeOutput('')).toEqual(emptyFileChangeSummary());
    expect(parseDiffTreeOutput('  ')).toEqual(emptyFileChangeSummary());
  });

  it('parses added files', () => {
    const raw = 'A\0src/math.ts\0A\0src/math.test.ts\0';
    const result = parseDiffTreeOutput(raw);

    expect(result.added).toEqual(['src/math.ts', 'src/math.test.ts']);
    expect(result.modified).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.renamed).toEqual([]);
  });

  it('parses modified files', () => {
    const raw = 'M\0src/index.ts\0';
    const result = parseDiffTreeOutput(raw);

    expect(result.modified).toEqual(['src/index.ts']);
    expect(result.added).toEqual([]);
  });

  it('parses deleted files', () => {
    const raw = 'D\0src/old.ts\0';
    const result = parseDiffTreeOutput(raw);

    expect(result.deleted).toEqual(['src/old.ts']);
  });

  it('parses renamed files', () => {
    const raw = 'R100\0src/old-name.ts\0src/new-name.ts\0';
    const result = parseDiffTreeOutput(raw);

    expect(result.renamed).toEqual([
      { from: 'src/old-name.ts', to: 'src/new-name.ts' },
    ]);
    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('parses copied files as renames', () => {
    const raw = 'C100\0src/original.ts\0src/copy.ts\0';
    const result = parseDiffTreeOutput(raw);

    expect(result.renamed).toEqual([
      { from: 'src/original.ts', to: 'src/copy.ts' },
    ]);
  });

  it('parses type changes as modified', () => {
    const raw = 'T\0src/link.ts\0';
    const result = parseDiffTreeOutput(raw);

    expect(result.modified).toEqual(['src/link.ts']);
  });

  it('parses mixed changes', () => {
    const raw = [
      'A\0src/new.ts\0',
      'M\0src/existing.ts\0',
      'D\0src/removed.ts\0',
      'R095\0src/old.ts\0src/renamed.ts\0',
    ].join('');

    const result = parseDiffTreeOutput(raw);

    expect(result.added).toEqual(['src/new.ts']);
    expect(result.modified).toEqual(['src/existing.ts']);
    expect(result.deleted).toEqual(['src/removed.ts']);
    expect(result.renamed).toEqual([
      { from: 'src/old.ts', to: 'src/renamed.ts' },
    ]);
  });

  it('handles paths with spaces', () => {
    const raw = 'A\0src/my file.ts\0';
    const result = parseDiffTreeOutput(raw);

    expect(result.added).toEqual(['src/my file.ts']);
  });

  it('treats unknown status codes as modified', () => {
    const raw = 'X\0src/unknown.ts\0';
    const result = parseDiffTreeOutput(raw);

    expect(result.modified).toEqual(['src/unknown.ts']);
  });
});

// ── parsePorcelainV2Output ───────────────────────────────────────────

describe('parsePorcelainV2Output', () => {
  it('returns empty summary for empty input', () => {
    expect(parsePorcelainV2Output('')).toEqual(emptyFileChangeSummary());
  });

  it('parses untracked files as added', () => {
    const raw = '? new-file.ts\0';
    const result = parsePorcelainV2Output(raw);

    expect(result.added).toEqual(['new-file.ts']);
  });

  it('parses added files from index', () => {
    const raw =
      '1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 abc123 src/math.ts\0';
    const result = parsePorcelainV2Output(raw);

    expect(result.added).toEqual(['src/math.ts']);
  });

  it('parses modified files from index', () => {
    const raw =
      '1 M. N... 100644 100644 100644 abc123 def456 src/existing.ts\0';
    const result = parsePorcelainV2Output(raw);

    expect(result.modified).toEqual(['src/existing.ts']);
  });

  it('parses deleted files from index', () => {
    const raw =
      '1 D. N... 100644 000000 000000 abc123 0000000000000000000000000000000000000000 src/removed.ts\0';
    const result = parsePorcelainV2Output(raw);

    expect(result.deleted).toEqual(['src/removed.ts']);
  });

  it('parses renamed files', () => {
    const raw =
      '2 R. N... 100644 100644 100644 abc123 def456 R100 src/new-name.ts\0src/old-name.ts\0';
    const result = parsePorcelainV2Output(raw);

    expect(result.renamed).toEqual([
      { from: 'src/old-name.ts', to: 'src/new-name.ts' },
    ]);
  });
});

// ── Utility functions ────────────────────────────────────────────────

describe('emptyFileChangeSummary', () => {
  it('returns a summary with empty arrays', () => {
    const summary = emptyFileChangeSummary();
    expect(summary.added).toEqual([]);
    expect(summary.modified).toEqual([]);
    expect(summary.deleted).toEqual([]);
    expect(summary.renamed).toEqual([]);
  });

  it('returns a new object each time', () => {
    const a = emptyFileChangeSummary();
    const b = emptyFileChangeSummary();
    expect(a).not.toBe(b);
  });
});

describe('hasChanges', () => {
  it('returns false for empty summary', () => {
    expect(hasChanges(emptyFileChangeSummary())).toBe(false);
  });

  it('returns true when files are added', () => {
    const summary: FileChangeSummary = {
      ...emptyFileChangeSummary(),
      added: ['file.ts'],
    };
    expect(hasChanges(summary)).toBe(true);
  });

  it('returns true when files are modified', () => {
    const summary: FileChangeSummary = {
      ...emptyFileChangeSummary(),
      modified: ['file.ts'],
    };
    expect(hasChanges(summary)).toBe(true);
  });

  it('returns true when files are deleted', () => {
    const summary: FileChangeSummary = {
      ...emptyFileChangeSummary(),
      deleted: ['file.ts'],
    };
    expect(hasChanges(summary)).toBe(true);
  });

  it('returns true when files are renamed', () => {
    const summary: FileChangeSummary = {
      ...emptyFileChangeSummary(),
      renamed: [{ from: 'old.ts', to: 'new.ts' }],
    };
    expect(hasChanges(summary)).toBe(true);
  });
});

describe('flattenChangedFiles', () => {
  it('returns empty array for empty summary', () => {
    expect(flattenChangedFiles(emptyFileChangeSummary())).toEqual([]);
  });

  it('flattens all change types', () => {
    const summary: FileChangeSummary = {
      added: ['a.ts'],
      modified: ['b.ts'],
      deleted: ['c.ts'],
      renamed: [{ from: 'old.ts', to: 'new.ts' }],
    };

    const result = flattenChangedFiles(summary);
    expect(result).toEqual(['a.ts', 'b.ts', 'c.ts', 'new.ts']);
  });

  it('uses "to" path for renames', () => {
    const summary: FileChangeSummary = {
      ...emptyFileChangeSummary(),
      renamed: [{ from: 'src/old.ts', to: 'src/new.ts' }],
    };

    const result = flattenChangedFiles(summary);
    expect(result).toEqual(['src/new.ts']);
  });
});
