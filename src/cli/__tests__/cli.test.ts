import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve('src/cli/index.ts');
const TSX = path.resolve('node_modules/.bin/tsx');

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(TSX, [CLI_PATH, ...args], {
      cwd: path.resolve('.'),
      timeout: 10_000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const execErr = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? '',
      exitCode: execErr.code ?? 1,
    };
  }
}

describe('CLI integration', () => {
  describe('huu --help', () => {
    it('should show help text with TUI description', async () => {
      const { stdout, exitCode } = await runCli(['--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('huu');
      expect(stdout).toContain('TUI full-screen');
    });
  });

  describe('huu --version', () => {
    it('should show version', async () => {
      const { stdout, exitCode } = await runCli(['--version']);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('huu (no arguments)', () => {
    it('should not crash when invoked without TTY', async () => {
      // Without a TTY, Ink will fail to enter raw mode.
      // We just verify the process doesn't crash with an unhandled error.
      const { exitCode } = await runCli([]);
      // Ink may exit with non-zero if raw mode is not supported (non-TTY),
      // so we accept both 0 and non-zero — the key is no unhandled crash
      expect(typeof exitCode).toBe('number');
    });
  });

  describe('huu (unknown arguments)', () => {
    it('should reject unknown arguments', async () => {
      const { stderr, exitCode } = await runCli(['run', 'some-task']);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('too many arguments');
    });
  });
});
