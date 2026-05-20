import { useEffect } from 'react';
import { useStdout } from 'ink';

// `\x1b[2J` clears the visible viewport, `\x1b[3J` clears scrollback,
// `\x1b[H` parks the cursor at (1,1). Together they remove every artifact
// from the previous render before Ink writes the next frame.
const FULL_CLEAR = '\x1b[2J\x1b[3J\x1b[H';

/**
 * Forces a clean redraw whenever the terminal is resized.
 *
 * Why: Ink already re-renders on `resize`, but its renderer (log-update) only
 * erases the line count it remembers writing. When the terminal shrinks, lines
 * that were wider than the new width have wrapped into extra visual rows that
 * log-update doesn't account for, leaving broken ASCII below the new frame.
 *
 * Strategy:
 *  - Prepend a `resize` listener so our `FULL_CLEAR` runs *before* Ink's own
 *    listener writes the new frame. Event-driven, zero idle cost.
 *  - Poll dimensions every `intervalMs` as a safety net for terminals/muxers
 *    that drop resize events. The poll only acts when columns or rows actually
 *    change, so idle CPU/memory stays flat.
 */
export function useTerminalResize(intervalMs = 500): void {
  const { stdout } = useStdout();

  useEffect(() => {
    if (!stdout.isTTY) return;

    const writeClear = (): void => {
      stdout.write(FULL_CLEAR);
    };

    stdout.prependListener('resize', writeClear);

    let lastCols = stdout.columns ?? 80;
    let lastRows = stdout.rows ?? 24;
    const safety = setInterval(() => {
      const cols = stdout.columns ?? 80;
      const rows = stdout.rows ?? 24;
      if (cols !== lastCols || rows !== lastRows) {
        lastCols = cols;
        lastRows = rows;
        stdout.emit('resize');
      }
    }, intervalMs);

    return () => {
      stdout.off('resize', writeClear);
      clearInterval(safety);
    };
  }, [stdout, intervalMs]);
}
