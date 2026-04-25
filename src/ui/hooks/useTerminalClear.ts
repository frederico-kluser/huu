import { useEffect } from 'react';
import { useStdout } from 'ink';

const ANSI_CLEAR_SCROLLBACK_ONLY = '\x1b[3J';

export function useTerminalClear(enabled = true): void {
  const { stdout } = useStdout();

  useEffect(() => {
    if (!enabled || !stdout.isTTY) return;
    stdout.write(ANSI_CLEAR_SCROLLBACK_ONLY);
    return () => {
      stdout.write(ANSI_CLEAR_SCROLLBACK_ONLY);
    };
  }, [enabled, stdout]);
}
