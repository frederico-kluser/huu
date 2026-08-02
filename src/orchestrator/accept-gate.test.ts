import { describe, it, expect } from 'vitest';
import { runAcceptGate } from './accept-gate.js';
import type { AcceptSpec } from '../lib/types.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'huu-accept-gate-'));
}

describe('accept-gate', () => {
  it('accept-gate: true command with expectExit 0 returns ok', () => {
    const dir = makeTempDir();
    try {
      const spec: AcceptSpec = { command: 'true', expectExit: 0 };
      const result = runAcceptGate(dir, spec);
      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('');
    } finally {
      // Best-effort cleanup
    }
  });

  it('accept-gate: false command with expectExit 0 returns NOT ok', () => {
    const dir = makeTempDir();
    try {
      const spec: AcceptSpec = { command: 'false', expectExit: 0 };
      const result = runAcceptGate(dir, spec);
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
    } finally {
      // Best-effort cleanup
    }
  });

  it('accept-gate: command with non-zero expected exit code', () => {
    const dir = makeTempDir();
    try {
      const spec: AcceptSpec = { command: 'false', expectExit: 1 };
      const result = runAcceptGate(dir, spec);
      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(1);
    } finally {
      // Best-effort cleanup
    }
  });

  it('accept-gate: command that writes to stdout captures output', () => {
    const dir = makeTempDir();
    try {
      const spec: AcceptSpec = { command: 'echo hello', expectExit: 0 };
      const result = runAcceptGate(dir, spec);
      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('hello');
    } finally {
      // Best-effort cleanup
    }
  });

  it('accept-gate: command that fails captures stderr output', () => {
    const dir = makeTempDir();
    try {
      const spec: AcceptSpec = { command: 'echo error >&2 && false', expectExit: 0 };
      const result = runAcceptGate(dir, spec);
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('error');
    } finally {
      // Best-effort cleanup
    }
  });

  it('accept-gate: command that does not exist returns non-zero exit code', () => {
    const dir = makeTempDir();
    try {
      const spec: AcceptSpec = { command: 'nonexistent_command_xyz', expectExit: 0 };
      const result = runAcceptGate(dir, spec);
      expect(result.ok).toBe(false);
      expect(result.exitCode).not.toBe(0);
    } finally {
      // Best-effort cleanup
    }
  });

  it('accept-gate: command runs in the specified worktree directory', () => {
    const dir = makeTempDir();
    try {
      const marker = 'marker_file';
      writeFileSync(join(dir, marker), 'present', 'utf8');
      const spec: AcceptSpec = { command: `test -f ${marker}`, expectExit: 0 };
      const result = runAcceptGate(dir, spec);
      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
    } finally {
      // Best-effort cleanup
    }
  });

  it('accept-gate reprova: false with expectExit 0 reproves correctly', () => {
    const dir = makeTempDir();
    try {
      const spec: AcceptSpec = { command: 'false', expectExit: 0 };
      const result = runAcceptGate(dir, spec);
      // The gate must reject (ok=false) when false exits with 1
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
    } finally {
      // Best-effort cleanup
    }
  });
});
