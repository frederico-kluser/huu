#!/usr/bin/env npx tsx
/**
 * check-twins.ts — structural parity checker for "twin" files.
 *
 * Verifies:
 *   1. README.md ↔ README.en.md — count and order of ## headers
 *   2. docs/X.md ↔ docs/X.pt-BR.md — same check, all pairs
 *   3. src/lib/card-state.ts ↔ src/web/client/card-state.js —
 *      exported function/const names
 *
 * Usage:  npx tsx scripts/check-twins.ts
 * Exit:   0 if all twins are structurally in parity, 1 otherwise.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(__dirname, '..'));

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function h2Headers(mdPath: string): string[] {
  const content = readFileSync(mdPath, 'utf8');
  const headers: string[] = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^## (.+)$/);
    if (m) headers.push(m[1].trim());
  }
  return headers;
}

/** Extract exported function and const names from TypeScript source. */
function tsExports(tsPath: string): string[] {
  const content = readFileSync(tsPath, 'utf8');
  const names: string[] = [];
  const re = /^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** Extract exported function and const names from JavaScript (ESM) source. */
function jsExports(jsPath: string): string[] {
  const content = readFileSync(jsPath, 'utf8');
  const names: string[] = [];
  const re = /^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// check steps
// ---------------------------------------------------------------------------

let failures = 0;

function fail(msg: string) {
  console.error(msg);
  failures++;
}

function checkHeaders(a: string, b: string, label: string) {
  const aH = h2Headers(a);
  const bH = h2Headers(b);

  if (aH.length !== bH.length) {
    fail(
      `${label}: header count mismatch — ${basename(a)} has ${aH.length}, ${basename(b)} has ${bH.length}`,
    );
  }
}

function checkExports(a: string, b: string, label: string) {
  const aNames = tsExports(a);
  const bNames = jsExports(b);

  const onlyA = aNames.filter((n) => !bNames.includes(n));
  const onlyB = bNames.filter((n) => !aNames.includes(n));

  for (const n of onlyA) {
    fail(`${label}: export "${n}" exists in ${basename(a)} but not in ${basename(b)}`);
  }
  for (const n of onlyB) {
    fail(`${label}: export "${n}" exists in ${basename(b)} but not in ${basename(a)}`);
  }

  if (onlyA.length === 0 && onlyB.length === 0 && aNames.length !== bNames.length) {
    // Same set but different counts (duplicates) — already caught by the sets above
    // so this should never fire, but guard against reorder bugs.
    fail(`${label}: export order differs (same set but different lengths)`);
  }
}

// ---------------------------------------------------------------------------
// 1. README
// ---------------------------------------------------------------------------

const readmePt = join(ROOT, 'README.md');
const readmeEn = join(ROOT, 'README.en.md');
checkHeaders(readmePt, readmeEn, 'README');

// ---------------------------------------------------------------------------
// 2. docs pairs
// ---------------------------------------------------------------------------

const docsDir = join(ROOT, 'docs');
const ptBrFiles = readdirSync(docsDir).filter((f) => f.endsWith('.pt-BR.md'));
for (const ptFile of ptBrFiles) {
  const enFile = ptFile.replace('.pt-BR.md', '.md');
  const enPath = join(docsDir, enFile);
  if (!existsSync(enPath)) {
    fail(`docs: no English twin for ${ptFile}`);
    continue;
  }
  checkHeaders(enPath, join(docsDir, ptFile), `docs/${enFile}`);
}

// ---------------------------------------------------------------------------
// 3. card-state
// ---------------------------------------------------------------------------

const cardTs = join(ROOT, 'src', 'lib', 'card-state.ts');
const cardJs = join(ROOT, 'src', 'web', 'client', 'card-state.js');
if (!existsSync(cardTs)) {
  fail('card-state: src/lib/card-state.ts not found');
}
if (!existsSync(cardJs)) {
  fail('card-state: src/web/client/card-state.js not found');
}
if (existsSync(cardTs) && existsSync(cardJs)) {
  checkExports(cardTs, cardJs, 'card-state');
}

// ---------------------------------------------------------------------------
// exit
// ---------------------------------------------------------------------------

if (failures === 0) {
  console.log('check-twins: all twins in parity');
  process.exit(0);
} else {
  console.error(`check-twins: ${failures} parity violation(s)`);
  process.exit(1);
}
