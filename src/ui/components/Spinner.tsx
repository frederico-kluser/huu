import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

const DEFAULT_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DEFAULT_INTERVAL_MS = 80;

export interface SpinnerProps {
  /** Optional caption next to the animated frame. */
  label?: string;
  /** Override the default Braille frame set. */
  frames?: readonly string[];
  /** Frame advance interval in ms. */
  intervalMs?: number;
  /** Color of the spinner glyph (Ink color name). */
  color?: string;
}

/**
 * Animated spinner — shared loader for any "modelo está pensando" or
 * "carregando…" state. Uses Braille frames by default; falls back to plain
 * text via the `frames` prop if the terminal can't render them.
 */
export function Spinner({
  label,
  frames = DEFAULT_FRAMES,
  intervalMs = DEFAULT_INTERVAL_MS,
  color = 'cyan',
}: SpinnerProps): React.JSX.Element {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [frames.length, intervalMs]);

  const frame = frames[index] ?? frames[0] ?? '';

  return (
    <Box>
      <Text color={color}>{frame}</Text>
      {label && (
        <>
          <Text> </Text>
          <Text dimColor>{label}</Text>
        </>
      )}
    </Box>
  );
}
