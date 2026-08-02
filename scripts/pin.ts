#!/usr/bin/env npx tsx
/**
 * pin.ts — generates content-addressed pin citations.
 *
 * Usage:  npx tsx scripts/pin.ts <file>:<line>
 * Output: <file>:<line>@<sha1>
 *         <line content>
 *
 * The sha1 is computed over the raw line content (without trailing newline).
 * NEVER generate pins by hand — always use this script so the hash is
 * reproducible and verifiable by check-pins.ts.
 *
 * Full spec: METODO.md M4-01.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

function sha1(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}

function usage(): never {
  console.error('Usage: npx tsx scripts/pin.ts <file>:<line>');
  console.error('Example: npx tsx scripts/pin.ts src/lib/types.ts:1');
  process.exit(1);
}

// ---- main ----
const arg = process.argv[2];
if (!arg || !arg.includes(':')) {
  usage();
}

const colonIdx = arg.lastIndexOf(':');
const file = arg.slice(0, colonIdx);
const lineStr = arg.slice(colonIdx + 1);
const lineNum = parseInt(lineStr, 10);

if (isNaN(lineNum) || lineNum < 1) {
  console.error(`Invalid line number: "${lineStr}"`);
  process.exit(1);
}

if (lineStr !== String(lineNum)) {
  console.error(`Invalid line number: "${lineStr}" (trailing characters)`);
  process.exit(1);
}

const absPath = resolve(process.cwd(), file);

if (!existsSync(absPath)) {
  console.error(`File not found: ${absPath}`);
  process.exit(1);
}

const content = readFileSync(absPath, 'utf8');
const lines = content.split('\n');

if (lineNum > lines.length) {
  console.error(`Line ${lineNum} out of range (file has ${lines.length} lines)`);
  process.exit(1);
}

const line = lines[lineNum - 1];
const hash = sha1(line);

console.log(`${file}:${lineNum}@${hash}`);
console.log(line);
