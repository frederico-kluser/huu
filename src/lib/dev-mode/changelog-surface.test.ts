import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectChangelogPaths } from './changelog-surface.js';

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'huu-changelog-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('detectChangelogPaths', () => {
  it('finds nothing in a project with no changelog surface', () => {
    expect(detectChangelogPaths(scratch())).toEqual([]);
  });

  it('reports a fragment directory with a trailing slash', () => {
    const dir = scratch();
    mkdirSync(join(dir, '.changes'));
    expect(detectChangelogPaths(dir)).toEqual(['.changes/']);
  });

  it('recognizes the fragment conventions in wide use', () => {
    for (const name of ['.changes', 'changelog.d', '.changeset']) {
      const dir = scratch();
      mkdirSync(join(dir, name));
      expect(detectChangelogPaths(dir), name).toEqual([`${name}/`]);
    }
  });

  it('falls back to CHANGELOG.md when there is no fragment directory', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
    expect(detectChangelogPaths(dir)).toEqual(['CHANGELOG.md']);
  });

  // The ordering rule that matters: a repo with BOTH wants agents writing
  // fragments, not editing a file the release process generates.
  it('lists the fragment directory BEFORE a generated CHANGELOG.md', () => {
    const dir = scratch();
    mkdirSync(join(dir, '.changes'));
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
    expect(detectChangelogPaths(dir)).toEqual(['.changes/', 'CHANGELOG.md']);
  });

  it('ignores a candidate whose kind is wrong', () => {
    const dir = scratch();
    // A FILE named `.changes` is not a fragment directory.
    writeFileSync(join(dir, '.changes'), 'not a dir', 'utf8');
    mkdirSync(join(dir, 'CHANGELOG.md'));
    expect(detectChangelogPaths(dir)).toEqual([]);
  });

  it('returns [] for a directory that does not exist instead of throwing', () => {
    expect(detectChangelogPaths(join(tmpdir(), 'huu-does-not-exist-ever'))).toEqual([]);
  });
});
