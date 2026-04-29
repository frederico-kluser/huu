/**
 * Process-level safety net for the TTY. Ink restores raw mode and the cursor
 * on clean unmount via signal-exit, but we have multiple paths that can land
 * a hard exit while the dashboard is still mounted (orchestrator rejection
 * during summary navigation, an uncaught rejection from a worktree teardown,
 * etc.). When that happens the terminal is left in raw mode with the cursor
 * hidden, and every key the user presses afterwards is silently swallowed.
 *
 * This module idempotently registers handlers that flush a known-good
 * sequence to stdout (cursor on, raw off, scrollback cleared) on every
 * realistic exit path. Cheap and side-effect-free until something fires.
 */
import process from 'node:process';

let installed = false;

function restoreTerminal(): void {
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
  } catch {
    /* stdin may already be closed */
  }
  try {
    if (process.stdout.isTTY) {
      // \x1b[?25h shows the cursor (ink's cli-cursor hides it),
      // \x1b[0m resets attributes so colors don't bleed,
      // \x1b[?1049l drops the alt screen if any nested tool entered it.
      process.stdout.write('\x1b[?25h\x1b[0m\x1b[?1049l');
    }
  } catch {
    /* stdout may already be closed */
  }
}

export function installSafeTerminal(): void {
  if (installed) return;
  installed = true;

  process.on('exit', restoreTerminal);

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      restoreTerminal();
      // Re-emit the default behaviour so process exits with the conventional
      // 128+signo code instead of hanging indefinitely.
      process.exit(sig === 'SIGINT' ? 130 : sig === 'SIGTERM' ? 143 : 129);
    });
  }

  process.on('uncaughtException', (err) => {
    restoreTerminal();
    // Surface the failure once the terminal is sane again so the message is
    // actually readable.
    // eslint-disable-next-line no-console
    console.error('uncaughtException:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    restoreTerminal();
    // eslint-disable-next-line no-console
    console.error('unhandledRejection:', reason);
    process.exit(1);
  });
}
