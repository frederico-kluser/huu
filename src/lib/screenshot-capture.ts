/**
 * Screenshot capture — how the dev mode takes its OWN prints.
 *
 * Platform reality (research dossier Q4, verified live on the macmini
 * 2026-10-03: `/usr/sbin/screencapture` present on macOS 27.0):
 *
 *   macOS   `screencapture` — `-i` interactive region, `-i -w` interactive
 *           window, no flag = full screen. ALWAYS `-x` (no shutter sound).
 *           TCC "Screen & System Audio Recording" is per-app and CANNOT be
 *           pre-granted via MDM/PPPC — the first capture prompts, and a
 *           versioned binary path re-prompts after updates.
 *   Linux   X11: `spectacle -b` (KDE, background) or `gnome-screenshot`;
 *           Wayland: `grim` (+`slurp` for region) under wlroots, else the
 *           XDG portal (interactive consent per session). No global capture
 *           without the compositor/portal — that is the security model.
 *
 * The INTERACTIVE modes are the review step: the user selects the exact
 * region/window that will leave the machine. Capture SAVES a file and sends
 * NOTHING — analysis is a separate, explicit act (`vision-side-call`), which
 * is what makes "review before send" real rather than a checkbox.
 *
 * `captureCommand` is pure (the platform → command chain); `captureScreenshot`
 * runs the chain with an injectable runner and stops at the first capture that
 * exits 0 AND leaves the file behind. A missing tool falls through to the next
 * candidate; the last failure's message is what the user sees.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export type CaptureMode = 'region' | 'window' | 'full';

/** One candidate capture command. `shell` runs through `sh -c` (slurp pipes). */
export interface CaptureCommand {
  cmd: string;
  args: readonly string[];
  shell?: boolean;
}

export interface CaptureRunnerResult {
  code: number;
  stderr: string;
}

export type CaptureRunner = (
  cmd: string,
  args: readonly string[],
  shell: boolean,
) => Promise<CaptureRunnerResult>;

/**
 * The fallback chain for a platform/mode. Pure — the tests pin these exact
 * shapes, because a silently wrong flag is a capture of the WRONG thing
 * (or of everything).
 */
export function captureCommand(
  platform: NodeJS.Platform,
  mode: CaptureMode,
  outPath: string,
): readonly CaptureCommand[] {
  if (platform === 'darwin') {
    // Interactive flags ARE the review: region/window are user-selected.
    const interactive = mode === 'region' ? ['-i'] : mode === 'window' ? ['-i', '-w'] : [];
    return [{ cmd: 'screencapture', args: ['-x', ...interactive, outPath] }];
  }

  // Linux and friends: try the compositor-aware tools, X11 tools last.
  const chains: Record<CaptureMode, readonly CaptureCommand[]> = {
    region: [
      { cmd: 'spectacle', args: ['-b', '-r', '-o', outPath] },
      { cmd: 'grim', args: ['-g', '"$(slurp)"', outPath], shell: true },
      { cmd: 'gnome-screenshot', args: ['-a', '--file', outPath] },
    ],
    window: [
      { cmd: 'spectacle', args: ['-b', '-u', '-o', outPath] },
      { cmd: 'gnome-screenshot', args: ['-w', '--file', outPath] },
    ],
    full: [
      { cmd: 'spectacle', args: ['-b', '-f', '-o', outPath] },
      { cmd: 'grim', args: [outPath] },
      { cmd: 'gnome-screenshot', args: ['-f', '--file', outPath] },
    ],
  };
  return chains[mode];
}

export interface CaptureOptions {
  mode: CaptureMode;
  /** Where the PNG must end up (parent dir must exist). */
  outPath: string;
  platform?: NodeJS.Platform;
  runner?: CaptureRunner;
}

export interface CaptureResult {
  ok: boolean;
  path?: string;
  /** What the user must know (missing tools, TCC prompt, portal consent). */
  message: string;
}

const defaultRunner: CaptureRunner = (cmd, args, shell) =>
  new Promise((resolve) => {
    const child = shell
      ? spawn('sh', ['-c', `${cmd} ${args.join(' ')}`])
      : spawn(cmd, [...args]);
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('error', (e) => resolve({ code: 127, stderr: String(e) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });

/**
 * Run the chain until one candidate produces the file. Never throws: a
 * capture is a convenience, and the honest answer to "no tool worked" is a
 * message naming what to install or approve — plus the reminder that the user
 * can always hand over a file instead (`--print`).
 */
export async function captureScreenshot(opts: CaptureOptions): Promise<CaptureResult> {
  const platform = opts.platform ?? process.platform;
  const runner = opts.runner ?? defaultRunner;
  const failures: string[] = [];

  for (const candidate of captureCommand(platform, opts.mode, opts.outPath)) {
    const { code, stderr } = await runner(candidate.cmd, candidate.args, candidate.shell ?? false);
    if (code === 0 && existsSync(opts.outPath)) {
      return {
        ok: true,
        path: opts.outPath,
        message:
          `captura guardada em ${opts.outPath} — REVEJA o ficheiro antes de o analisar: ` +
          'um print pode conter segredos, notificações ou dados de clientes, e a análise envia-o ao modelo.',
      };
    }
    failures.push(`${candidate.cmd}: ${code === 0 ? 'sem ficheiro' : stderr.trim() || `exit ${code}`}`);
  }

  return {
    ok: false,
    message:
      `huu dev: não consegui capturar (${opts.mode}) em ${platform}. Tentativas: ${failures.join(' | ')}\n` +
      (platform === 'darwin'
        ? '  No macOS a captura precisa da permissão Screen Recording (Privacidade e Segurança) — ela é pedida na primeira captura e não pode ser pré-concedida por MDM.'
        : '  Em Linux/Wayland a captura global exige o compositor (grim/slurp) ou o portal XDG (consentimento por sessão); em X11 instale spectacle ou gnome-screenshot.') +
      '\n  Alternativa sempre disponível: guarde o print você mesmo e passe-o com --print <ficheiro>.',
  };
}
