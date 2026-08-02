#!/usr/bin/env npx tsx
/**
 * check-acceptance.ts — negative probe for huu's test suite gate.
 *
 * Scans **\/*.test.ts and **\/*.test.tsx files recursively, extracts
 * test/describe/it names via regex, filters by a case-insensitive
 * substring selector, and exits with the following contract:
 *
 *   exit 0  — at least one match found (probe SUCCEEDS)
 *   exit 1  — zero matches, zero files parsed, or any operational failure
 *
 * Usage:
 *   npx tsx scripts/check-acceptance.ts --selector <string> [--root <dir>]
 */

import { readdir, stat } from 'node:fs/promises';
import { extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

// ── CLI argument parsing ───────────────────────────────────────────────

function parseArgs(raw: string[]) {
  const args = raw.slice(2); // skip node + script path
  const opts: { selector?: string; root: string } = { root: '.' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--selector' && i + 1 < args.length) {
      opts.selector = args[++i];
    } else if (args[i] === '--root' && i + 1 < args.length) {
      opts.root = args[++i];
    }
  }
  return opts;
}

// ── Regex for test/describe/it names ────────────────────────────────────

const NAME_RE = /\b(?:it|test|describe)\s*\(\s*(['"`])((?:(?!\1).|\\.)*?)\1/gs;

function extractNames(line: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  // Reset lastIndex and iterate
  NAME_RE.lastIndex = 0;
  while ((match = NAME_RE.exec(line)) !== null) {
    names.push(match[2]);
  }
  return names;
}

// ── File scanner ────────────────────────────────────────────────────────

async function* walk(dir: string): AsyncGenerator<string> {
  // Resolve relative to the script's directory to avoid CWD ambiguity
  const root = resolve(dir);
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

async function scanFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for await (const f of walk(root)) {
    if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) {
      files.push(f);
    }
  }
  return files;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.selector) {
    console.error('ERROR: --selector is required');
    process.exit(1);
  }

  const root = resolve(opts.root);
  const selector = opts.selector.toLowerCase();

  const files = await scanFiles(root);

  // Blind tool guard: zero files parsed = failure
  if (files.length === 0) {
    console.error(`No test files found under ${root}`);
    process.exit(1);
  }

  let totalMatches = 0;

  for (const file of files) {
    const stream = createReadStream(file, 'utf8');
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const names = extractNames(line);
      for (const name of names) {
        if (name.toLowerCase().includes(selector)) {
          totalMatches++;
        }
      }
    }
  }

  if (totalMatches >= 1) {
    console.log(`${totalMatches} match(es) for "${opts.selector}" in ${files.length} test file(s)`);
    process.exit(0);
  } else {
    console.error(`No match for "${opts.selector}" in ${files.length} test file(s)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
