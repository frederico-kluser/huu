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
    it('should show help text with run and status commands', async () => {
      const { stdout, exitCode } = await runCli(['--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('huu');
      expect(stdout).toContain('run');
      expect(stdout).toContain('status');
    });
  });

  describe('huu --version', () => {
    it('should show version', async () => {
      const { stdout, exitCode } = await runCli(['--version']);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('huu run --help', () => {
    it('should show run command help', async () => {
      const { stdout, exitCode } = await runCli(['run', '--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('taskDescription');
      expect(stdout).toContain('Execute one builder agent');
    });
  });

  describe('huu status --help', () => {
    it('should show status command help', async () => {
      const { stdout, exitCode } = await runCli(['status', '--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Show current');
    });
  });

  describe('huu run (validation)', () => {
    it('should reject empty task description', async () => {
      const { stderr, exitCode } = await runCli(['run']);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('taskDescription');
    });

    it('should reject task description shorter than 5 chars', async () => {
      const { stderr, exitCode } = await runCli(['run', 'hi']);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('at least 5 characters');
    });
  });

  describe('huu status (no database)', () => {
    it('should handle missing database gracefully', async () => {
      const { stdout, exitCode } = await runCli(['status']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('No HUU database found');
    });
  });
});
