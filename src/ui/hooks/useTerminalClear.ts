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
const SCROLLBACK_ONLY = '\x1b[3J';

export function useTerminalClear(enabled = true): void {
  const { stdout } = useStdout();

  useEffect(() => {
    if (!enabled || !stdout.isTTY) return;
    stdout.write(SCROLLBACK_ONLY);
    return () => {
      if (stdout.isTTY) stdout.write(SCROLLBACK_ONLY);
    };
  }, [enabled, stdout]);
}
