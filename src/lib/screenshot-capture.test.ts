import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureCommand, captureScreenshot, type CaptureRunner } from './screenshot-capture.js';

describe('screenshot-capture — command chains (pure)', () => {
  it('macOS: screencapture with -x, and the interactive flag IS the review', () => {
    expect(captureCommand('darwin', 'region', '/tmp/o.png')).toEqual([
      { cmd: 'screencapture', args: ['-x', '-i', '/tmp/o.png'] },
    ]);
    expect(captureCommand('darwin', 'window', '/tmp/o.png')).toEqual([
      { cmd: 'screencapture', args: ['-x', '-i', '-w', '/tmp/o.png'] },
    ]);
    expect(captureCommand('darwin', 'full', '/tmp/o.png')).toEqual([
      { cmd: 'screencapture', args: ['-x', '/tmp/o.png'] },
    ]);
  });

  it('Linux: compositor-aware tools first, X11 tools as fallbacks', () => {
    const region = captureCommand('linux', 'region', '/tmp/o.png');
    expect(region.map((c) => c.cmd)).toEqual(['spectacle', 'grim', 'gnome-screenshot']);
    expect(region[1].shell).toBe(true); // grim | slurp needs a shell
    const full = captureCommand('linux', 'full', '/tmp/o.png');
    expect(full.map((c) => c.cmd)).toEqual(['spectacle', 'grim', 'gnome-screenshot']);
    const win = captureCommand('linux', 'window', '/tmp/o.png');
    expect(win.map((c) => c.cmd)).toEqual(['spectacle', 'gnome-screenshot']);
  });
});

describe('screenshot-capture — chain execution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-'));
  const out = join(dir, 'shot.png');

  it('falls through a failing tool to the one that produces the file', async () => {
    const calls: string[] = [];
    const runner: CaptureRunner = async (cmd) => {
      calls.push(cmd);
      if (cmd === 'spectacle') return { code: 127, stderr: 'not found' };
      writeFileSync(out, 'png');
      return { code: 0, stderr: '' };
    };
    const r = await captureScreenshot({ mode: 'region', outPath: out, platform: 'linux', runner });
    expect(r.ok).toBe(true);
    expect(r.path).toBe(out);
    expect(calls).toEqual(['spectacle', 'grim']);
    // The review-then-send contract is IN the success message.
    expect(r.message).toContain('REVEJA');
    expect(r.message).toContain('segredos');
  });

  it('treats "exit 0 but no file" as failure and keeps going', async () => {
    const runner: CaptureRunner = async (cmd) => (cmd === 'grim' ? { code: 0, stderr: '' } : { code: 1, stderr: 'x' });
    const r = await captureScreenshot({ mode: 'full', outPath: join(dir, 'missing.png'), platform: 'linux', runner });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('sem ficheiro');
  });

  it('reports the platform remedy AND the ever-available --print escape hatch', async () => {
    const fail: CaptureRunner = async (cmd) => ({ code: 127, stderr: `${cmd}: not found` });
    const mac = await captureScreenshot({ mode: 'region', outPath: join(dir, 'm.png'), platform: 'darwin', runner: fail });
    expect(mac.ok).toBe(false);
    expect(mac.message).toContain('Screen Recording');
    expect(mac.message).toContain('--print');

    const linux = await captureScreenshot({ mode: 'region', outPath: join(dir, 'l.png'), platform: 'linux', runner: fail });
    expect(linux.ok).toBe(false);
    expect(linux.message).toContain('portal XDG');
    expect(linux.message).toContain('--print');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
