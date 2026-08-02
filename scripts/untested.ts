#!/usr/bin/env npx tsx
/**
 * untested.ts — list largest source files missing a matching .test.ts
 *
 * Scans src/ for .ts/.tsx files (excluding *.test.*, node_modules, dist),
 * checks for a sibling test file (same name + .test.ts / .test.tsx),
 * and prints the N largest by line count in descending order.
 *
 * Usage:
 *   npx tsx scripts/untested.ts --top 10
 *   npx tsx scripts/untested.ts      # prints ALL untested files by line count
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { extname, join, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let topN = Number.POSITIVE_INFINITY;

if (args.length >= 2 && args[0] === '--top') {
  topN = parseInt(args[1]!, 10);
  if (isNaN(topN) || topN <= 0) {
    process.stderr.write('Usage: untested.ts [--top N]\n');
    process.exit(1);
  }
} else if (args.length > 0) {
  process.stderr.write('Usage: untested.ts [--top N]\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Source root — relative to the repo root (where this script lives under
// scripts/). We assume the script is run from the repo root.
// ---------------------------------------------------------------------------
const repoRoot = process.cwd();
const srcRoot = join(repoRoot, 'src');

// ---------------------------------------------------------------------------
// Collect all .ts / .tsx files under src/ (recursive), excluding test files,
// node_modules and dist.
// ---------------------------------------------------------------------------
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git']);

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isFile()) continue;

    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      files.push(...collectSourceFiles(full));
      continue;
    }

    // Only .ts / .tsx, not .test.ts / .test.tsx
    const ext = extname(entry.name);
    if (ext !== '.ts' && ext !== '.tsx') continue;
    if (entry.name.includes('.test.')) continue;

    files.push(full);
  }

  return files;
}

// ---------------------------------------------------------------------------
// Check for a sibling test file.
// A sibling test file is at the same path with .test.ts or .test.tsx appended
// before the final extension.
//
//   branch-namer.ts     → branch-namer.test.ts  / branch-namer.test.tsx
//   RunKanban.tsx       → RunKanban.test.ts     / RunKanban.test.tsx
// ---------------------------------------------------------------------------
function hasSiblingTest(sourcePath: string): boolean {
  const ext = extname(sourcePath); // .ts or .tsx
  const base = sourcePath.slice(0, -ext.length);

  return (
    existsSync(`${base}.test.ts`) ||
    existsSync(`${base}.test.tsx`)
  );
}

// ---------------------------------------------------------------------------
// Line count — reads the file as UTF-8 and splits by newline.
// ---------------------------------------------------------------------------
function lineCount(filePath: string): number {
  const content = readFileSync(filePath, 'utf8');
  // Count trailing newline correctly: split returns an extra empty string
  // when the file ends with \n, which is the convention (wc -l semantics).
  return content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const allFiles = collectSourceFiles(srcRoot);

const untested: Array<{ path: string; lines: number }> = [];

for (const f of allFiles) {
  if (!hasSiblingTest(f)) {
    untested.push({
      path: relative(repoRoot, f),
      lines: lineCount(f),
    });
  }
}

// Sort by line count descending, then alphabetically by path for stability.
untested.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));

// Print up to topN
const slice = untested.slice(0, topN);
for (const { path, lines } of slice) {
  process.stdout.write(`${lines}\t${path}\n`);
}
