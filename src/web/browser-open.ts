import { spawn } from 'node:child_process';
import { platform } from 'node:process';

export const NO_OPEN_ENV_VAR = 'HUU_WEB_NO_OPEN';

/**
 * Cross-platform "open this URL in the user's browser" helper.
 *
 * Never throws. On any failure (missing binary, permission denied,
 * sandboxed CI), prints a fallback message to stderr telling the
 * user to copy-paste the URL manually. The token-in-URL design means
 * the user can always reach the UI without a working launcher.
 *
 * Skips entirely when `HUU_WEB_NO_OPEN` is set in the environment —
 * useful for CI and for tests that boot the server without wanting a
 * browser to pop up.
 */
export async function openBrowser(url: string): Promise<void> {
  if (process.env[NO_OPEN_ENV_VAR]) {
    return;
  }

  let cmd: string;
  let args: string[];

  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    // `start` is a cmd.exe builtin. Empty quoted title avoids the URL
    // being interpreted as a window title when it contains spaces.
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {
      printFallback(url);
    });
    child.unref();
  } catch {
    printFallback(url);
  }
}

function printFallback(url: string): void {
  process.stderr.write(
    `huu: could not auto-open browser. Open this URL manually:\n  ${url}\n`,
  );
}
