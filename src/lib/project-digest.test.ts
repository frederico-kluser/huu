import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProjectDigest } from './project-digest.js';

describe('buildProjectDigest', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'huu-digest-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('extracts projectName from package.json', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'huu-test', version: '1.0.0' }));
    const d = buildProjectDigest(root);
    expect(d.projectName).toBe('huu-test');
    expect(d.digest).toMatch(/package\.json/);
    expect(d.digest).toMatch(/huu-test/);
  });

  it('survives a missing package.json', () => {
    const d = buildProjectDigest(root);
    expect(d.projectName).toBeUndefined();
    expect(d.digest).toMatch(/File tree/);
  });

  it('survives malformed package.json without throwing', () => {
    writeFileSync(join(root, 'package.json'), '{not valid json');
    const d = buildProjectDigest(root);
    expect(d.projectName).toBeUndefined();
    expect(d.digest).toMatch(/package\.json/);
  });

  it('includes README.md and CLAUDE.md when present', () => {
    writeFileSync(join(root, 'README.md'), '# My Project\n\nHello world.');
    writeFileSync(join(root, 'CLAUDE.md'), '# CLAUDE\n\nAgent guidance here.');
    const d = buildProjectDigest(root);
    expect(d.digest).toMatch(/My Project/);
    expect(d.digest).toMatch(/Agent guidance here/);
  });

  it('truncates very long files with a marker', () => {
    const huge = 'x'.repeat(10_000);
    writeFileSync(join(root, 'README.md'), huge);
    const d = buildProjectDigest(root);
    expect(d.digest).toMatch(/truncados/);
    expect(d.digest.length).toBeLessThan(huge.length + 5_000);
  });

  it('skips ignored directories from the file tree', () => {
    mkdirSync(join(root, 'node_modules', 'foo'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'foo', 'index.js'), '// noise');
    writeFileSync(join(root, 'src.ts'), 'export const x = 1;');
    const d = buildProjectDigest(root);
    expect(d.digest).toMatch(/src\.ts/);
    expect(d.digest).not.toMatch(/node_modules\/foo\/index\.js/);
  });

  it('lists files relative to root', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), '');
    writeFileSync(join(root, 'src', 'b.ts'), '');
    const d = buildProjectDigest(root);
    expect(d.digest).toMatch(/src\/a\.ts/);
    expect(d.digest).toMatch(/src\/b\.ts/);
  });
});
