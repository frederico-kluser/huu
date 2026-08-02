#!/usr/bin/env npx tsx
/**
 * check-pins.ts — verifies content-addressed pins (minimal stub).
 * Scans .agents/skills/** for `file:line@sha1` annotations,
 * recomputes sha1 and reports drifts.
 *
 * Full spec: METODO.md M4-01. Stub: only validates the format + sha1 match.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(__dirname, '..'));

// Matches `path/to/file:NN@sha1` with at least 7 hex chars
const PIN_RE = /`([^`\s]+):(\d+)@([a-f0-9]{7,40})`/g;
// Matches degenerate forms: empty path, empty hash, missing colon
const DEGENERATE_RE = /`@[a-f0-9]{7,40}`|`[^`\s]+:(\d+)@`|`:\d+@[a-f0-9]{7,40}`/g;

function sha1(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}

function checkSingle(pin: { path: string; line: number; expectedHash: string }, rootDir: string): { ok: boolean; msg: string } {
  try {
    // Pin paths are relative to the scan root (repo root), not the source file's directory.
    // A pin in .agents/skills/foo/SKILL.md referencing `src/lib/types.ts:42@hash`
    // must resolve to <ROOT>/src/lib/types.ts, not <ROOT>/.agents/skills/foo/src/lib/types.ts.
    const refFile = resolve(rootDir, pin.path);
    if (!existsSync(refFile)) {
      return { ok: false, msg: `${pin.path}: file not found (resolved to ${refFile})` };
    }
    const content = readFileSync(refFile, 'utf8');
    const lines = content.split('\n');
    if (pin.line < 1 || pin.line > lines.length) {
      return { ok: false, msg: `${pin.path}:${pin.line}: line out of range (file has ${lines.length} lines)` };
    }
    const actualHash = sha1(lines[pin.line - 1]);
    if (!actualHash.startsWith(pin.expectedHash)) {
      return { ok: false, msg: `${pin.path}:${pin.line}: hash drift (expected ${pin.expectedHash}, got ${actualHash.slice(0, 7)})` };
    }
    return { ok: true, msg: 'OK' };
  } catch (e: any) {
    return { ok: false, msg: `${pin.path}:${pin.line}: ${e.message}` };
  }
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.huu', '.huu-worktrees', 'scripts', '.claude'].includes(entry.name)) continue;
      yield* walk(full);
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.ts')) {
      yield full;
    }
  }
}

// --fixture mode: creates a temporary degenerate fixture file and validates it fails
if (process.argv.includes('--fixture')) {
  const fixtureIdx = process.argv.indexOf('--fixture');
  const fixtureName = process.argv[fixtureIdx + 1] || '';

  const tmpDir = mkdtempSync('/tmp/huu-check-pins-fixture-');
  try {
    if (fixtureName === 'degenerado') {
      // Degenerate pin: no path before :
      writeFileSync(join(tmpDir, 'bad-pin.md'), 'Ref: `@abc1234`\n', 'utf8');
      // Also invalid: path but no hash
      writeFileSync(join(tmpDir, 'bad-pin2.md'), 'Ref: `src/foo.ts:42@`\n', 'utf8');
    } else if (fixtureName === 'stale') {
      // Pin with wrong hash
      writeFileSync(join(tmpDir, 'target.ts'), 'const x = 1;\n', 'utf8');
      writeFileSync(join(tmpDir, 'pins.md'), 'Ref: `target.ts:1@fffffff`\n', 'utf8');
    } else {
      console.error('Unknown fixture:', fixtureName);
      process.exit(1);
    }

    // Re-invoke ourselves against the fixture dir via exec
    try {
      execSync(`npx tsx ${fileURLToPath(import.meta.url)} --root ${tmpDir}`, {
        cwd: tmpDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      // Should NOT succeed for degenerate/stale
      console.log('check-pins accepted degenerate fixture (BUG)');
      process.exit(1);
    } catch (e: any) {
      const output = (e.stdout || '') + (e.stderr || '');
      if (fixtureName === 'degenerado') {
        if (output.toLowerCase().includes('file not found') || output.toLowerCase().includes('degenerate')) {
          console.log('check-pins correctly rejected degenerate fixture');
          process.exit(0);
        }
      }
      if (fixtureName === 'stale') {
        if (output.toLowerCase().includes('hash drift') || output.toLowerCase().includes('drift')) {
          console.log('check-pins correctly detected stale pin');
          process.exit(0);
        }
      }
      console.log('check-pins output for fixture ' + fixtureName + ':');
      console.log(output);
      process.exit(1);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---- main ----
const rootArgIdx = process.argv.indexOf('--root');
const scanRoot = rootArgIdx >= 0 ? resolve(process.argv[rootArgIdx + 1]) : ROOT;

let totalPins = 0;
let drifts = 0;

for (const file of walk(scanRoot)) {
  const content = readFileSync(file, 'utf8');
  const rel = relative(scanRoot, file);

  // First: scan for degenerate forms (empty path, empty hash) — always drifts
  DEGENERATE_RE.lastIndex = 0;
  let degMatch;
  while ((degMatch = DEGENERATE_RE.exec(content)) !== null) {
    totalPins++;
    drifts++;
    console.error(`DEGENERATE ${rel}: invalid pin format \`${degMatch[0]}\``);
  }

  // Then: scan for valid-format pins
  PIN_RE.lastIndex = 0;
  let match;
  while ((match = PIN_RE.exec(content)) !== null) {
    totalPins++;
    const pin = { path: match[1], line: parseInt(match[2], 10), expectedHash: match[3] };

    // Reject degenerate form: empty path or empty hash
    if (!pin.path || pin.path.trim() === '' || !pin.expectedHash || pin.expectedHash.trim() === '') {
      drifts++;
      continue;
    }

    const result = checkSingle(pin, scanRoot);
    if (!result.ok) {
      console.error(`DRIFT ${rel}: ${result.msg}`);
      drifts++;
    }
  }
}

if (totalPins === 0) {
  console.log('0 pins, 0 drifts');
} else {
  console.log(`${totalPins} pins, ${drifts} drifts`);
}
process.exit(drifts > 0 ? 1 : 0);
