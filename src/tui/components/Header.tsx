// Board header — current act, beat, and total cost

import React from 'react';
import { Box, Text, Spacer } from 'ink';
import type { Density } from '../types.js';

interface HeaderProps {
  act: number;
  beat: string | null;
  totalCostUsd: number;
  density: Density;
}

export function Header({
  act,
  beat,
  totalCostUsd,
  density,
}: HeaderProps): React.JSX.Element {
  const costStr = `$${totalCostUsd.toFixed(2)}`;

  if (density === 'compact') {
    return (
      <Box paddingX={1} gap={2}>
        <Text color="yellow" bold>Act {act}</Text>
        <Text dimColor>{'\u2502'}</Text>
        <Text color="magenta">{beat ?? '-'}</Text>
        <Spacer />
        <Text color="green" bold>{costStr}</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1} gap={3}>
      <Box gap={1}>
        <Text dimColor>Act</Text>
        <Text color="yellow" bold>{act}/3</Text>
      </Box>
      <Text dimColor>{'\u2502'}</Text>
      <Box gap={1}>
        <Text dimColor>Beat</Text>
        <Text color="magenta" bold>{beat ?? 'n/a'}</Text>
      </Box>
      <Spacer />
      <Box gap={1}>
        <Text dimColor>Cost</Text>
        <Text color="green" bold>{costStr}</Text>
      </Box>
    </Box>
  );
}
