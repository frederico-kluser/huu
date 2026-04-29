import { describe, it, expect } from 'vitest';
import { selectByRegex, countRegexMatches, flattenSelected } from './file-scanner.js';
import type { FileNode } from './types.js';

function tree(): FileNode {
  return {
    name: '.',
    path: '.',
    isDirectory: true,
    expanded: true,
    selected: false,
    children: [
      {
        name: 'src',
        path: 'src',
        isDirectory: true,
        expanded: true,
        selected: false,
        children: [
          { name: 'a.ts', path: 'src/a.ts', isDirectory: false, selected: false },
          { name: 'b.ts', path: 'src/b.ts', isDirectory: false, selected: false },
          { name: 'c.tsx', path: 'src/c.tsx', isDirectory: false, selected: true },
        ],
      },
      {
        name: 'docs',
        path: 'docs',
        isDirectory: true,
        expanded: true,
        selected: false,
        children: [{ name: 'README.md', path: 'docs/README.md', isDirectory: false, selected: false }],
      },
    ],
  };
}

describe('selectByRegex', () => {
  it('selects files matching the pattern and deselects everything else', () => {
    const result = selectByRegex(tree(), /\.ts$/);
    expect(flattenSelected(result).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('replaces prior selection (does not OR with existing)', () => {
    // src/c.tsx starts selected in the fixture; pattern only matches .md files.
    const result = selectByRegex(tree(), /\.md$/);
    expect(flattenSelected(result)).toEqual(['docs/README.md']);
  });

  it('marks a directory as selected only when every child file matches', () => {
    const result = selectByRegex(tree(), /^docs\//);
    const docs = result.children!.find((c) => c.path === 'docs')!;
    const src = result.children!.find((c) => c.path === 'src')!;
    expect(docs.selected).toBe(true);
    expect(src.selected).toBe(false);
  });

  it('with a pattern matching nothing, deselects all', () => {
    const result = selectByRegex(tree(), /__never__/);
    expect(flattenSelected(result)).toEqual([]);
  });
});

describe('countRegexMatches', () => {
  it('counts only file leaves matching the pattern', () => {
    expect(countRegexMatches(tree(), /\.ts$/)).toBe(2);
    expect(countRegexMatches(tree(), /\.tsx?$/)).toBe(3);
    expect(countRegexMatches(tree(), /README/)).toBe(1);
    expect(countRegexMatches(tree(), /__never__/)).toBe(0);
  });
});
