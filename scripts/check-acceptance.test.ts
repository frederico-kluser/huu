/**
 * check-acceptance.test.ts — tests for the negative probe script.
 *
 * These are vitest tests that run the script via child_process,
 * optionally setting up temp directories as needed.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, 'check-acceptance.ts');

function run(args: string = '') {
  try {
    const out = execSync(`npx tsx ${script} ${args}`, {
      cwd: join(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: out, stderr: '' };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

describe('check-acceptance', () => {
  it('positive probe: "requeue" matches >= 1', () => {
    const result = run('--selector requeue');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('match(es)');
  });

  it('negative probe with impossible selector exits != 0', () => {
    const result = run('--selector ZzNaoExiste');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('No match');
  });

  it('blind tool guard: empty dir exits != 0', () => {
    const tmp = mkdtempSync('/tmp/huu-check-acceptance-');
    try {
      const result = run(`--selector anything --root ${tmp}`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No test files found');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
