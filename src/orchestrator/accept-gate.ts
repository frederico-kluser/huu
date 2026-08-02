import { execSync } from 'node:child_process';
import type { AcceptSpec } from '../lib/types.js';

export interface AcceptGateResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
}

/**
 * Run an acceptance gate command in the given worktree AFTER a stage merge.
 * When {@link AcceptSpec.expectExit} is omitted, exit code 0 is the expected
 * success value (the common case). Any other exit code (including a crash or
 * signal) means the gate failed.
 */
export function runAcceptGate(
  worktreePath: string,
  accept: AcceptSpec,
): AcceptGateResult {
  const expectExit = accept.expectExit ?? 0;
  let exitCode: number | null = null;
  let output = '';
  try {
    output = execSync(accept.command, {
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    exitCode = 0;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err) {
      exitCode = (err as { status: number }).status;
      const stderr = (err as { stderr?: Buffer | string }).stderr;
      const stdout = (err as { stdout?: Buffer | string }).stdout;
      output = [stdout, stderr]
        .filter((s): s is Buffer | string => s !== null && s !== undefined)
        .map((s) => (typeof s === 'string' ? s : s.toString('utf8')))
        .join('\n')
        .trim();
    } else {
      exitCode = null;
      output = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: exitCode === expectExit, exitCode, output: output.trim() };
}
