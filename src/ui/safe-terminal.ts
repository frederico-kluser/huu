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
import { log as dlog } from '../lib/debug-logger.js';

let installed = false;

function snapshotProcess(): Record<string, unknown> {
  return {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    rssMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    activeHandles:
      (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()
        .length ?? -1,
    activeRequests:
      (process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.()
        .length ?? -1,
  };
}

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
      // Capture process state BEFORE restoreTerminal mutates anything, so
      // post-mortem analysis ("which agents were active when SIGINT hit?")
      // has the real picture. debug-logger already registers its own
      // signal handler that records the bare event — this one adds the
      // structured snapshot.
      dlog('signal', 'safe_exit', { signal: sig, ...snapshotProcess() });
      restoreTerminal();
      // Re-emit the default behaviour so process exits with the conventional
      // 128+signo code instead of hanging indefinitely.
      process.exit(sig === 'SIGINT' ? 130 : sig === 'SIGTERM' ? 143 : 129);
    });
  }

  // uncaughtException / unhandledRejection are OWNED by the process-level crash
  // guard (src/lib/crash-guard.ts), which decides exit-vs-survive by mode (fatal
  // for the one-shot/TUI, resilient for the long-lived web server). This module
  // must NOT also exit on them — a sibling `process.exit` here would pre-empt the
  // guard's survive decision and re-introduce the "one agent's error kills the
  // whole fleet" crash. Terminal restore on those paths runs via the guard's
  // onFatalCleanup and the 'exit' handler registered above.
}
