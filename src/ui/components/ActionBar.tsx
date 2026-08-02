import React from 'react';
import { Box, Text } from 'ink';
import type { ThemeColor } from '../theme.js';

export interface ActionHint {
  /** Key label, e.g. "G", "ESC", "↑↓". */
  key: string;
  /** What the key does, e.g. "run". */
  label: string;
  /** Theme color for the key glyph. Omit for a muted (dim) key. */
  color?: ThemeColor | string;
  /** Bold the key — use for the most important actions. */
  bold?: boolean;
}

/**
 * Full-width footer of keyboard hints. Each hint colors its key
 * independently (semantic theme colors) so the important actions stand out;
 * the bar spans the whole width via `justifyContent="space-between"` so the
 * options fill the screen instead of huddling on the left.
 */
export function ActionBar({ hints }: { hints: ActionHint[] }): React.JSX.Element {
  return (
    <Box width="100%" justifyContent="space-between" flexWrap="wrap">
      {hints.map((h) => (
        <Box key={h.key} marginRight={1}>
          <Text color={h.color} bold={h.bold}>
            {h.key}
          </Text>
          <Text dimColor> {h.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
