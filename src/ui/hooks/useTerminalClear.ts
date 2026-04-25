import { useEffect } from 'react';
import { useStdout } from 'ink';

/**
 * Erases the entire viewport AND scrollback. Stronger than just clearing
 * scrollback — needed when a tall component (file list, model selector)
 * unmounts and would otherwise leave ghost rows on screen.
 *
 * - `\x1b[2J` erase entire visible viewport
 * - `\x1b[3J` erase scrollback (xterm extension)
 * - `\x1b[H`  cursor home (1,1)
 */
const FULL_CLEAR = '\x1b[2J\x1b[3J\x1b[H';

/**
 * Clears the terminal on mount and unmount of the calling component.
 * Use this on overlay-style screens that render a tall list and may leak
 * artifacts when they go away.
 *
 * Safe to call from any component as long as it's wrapped in an Ink render.
 */
export function useTerminalClear(enabled = true): void {
  const { stdout } = useStdout();

  useEffect(() => {
    if (!enabled || !stdout.isTTY) return;
    stdout.write(FULL_CLEAR);
    return () => {
      stdout.write(FULL_CLEAR);
    };
  }, [enabled, stdout]);
}

/** Imperative one-shot clear. Used by the screen router on transitions. */
export function clearTerminal(stdout: NodeJS.WriteStream): void {
  if (!stdout.isTTY) return;
  stdout.write(FULL_CLEAR);
}
