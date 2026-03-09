// Horizontal divider line

import React from 'react';
import { Box, Text, useStdout } from 'ink';

interface DividerProps {
  color?: string;
  char?: string;
  title?: string;
  width?: number;
}

export function Divider({
  color = 'gray',
  char = '\u2500',
  title,
  width: explicitWidth,
}: DividerProps): React.JSX.Element {
  const { stdout } = useStdout();
  const width = explicitWidth ?? (stdout.columns ?? 80);

  if (title) {
    const titleStr = ` ${title} `;
    const remaining = Math.max(0, width - titleStr.length - 2);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;

    return (
      <Box>
        <Text color={color}>{char.repeat(left)}</Text>
        <Text bold color={color}>{titleStr}</Text>
        <Text color={color}>{char.repeat(right)}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color={color}>{char.repeat(width)}</Text>
    </Box>
  );
}
