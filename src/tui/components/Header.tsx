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
      <Box borderStyle="single" paddingX={1}>
        <Text>A{act}</Text>
        <Spacer />
        <Text>{beat ?? '-'}</Text>
        <Spacer />
        <Text>{costStr}</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold>Act {act}</Text>
      <Spacer />
      <Text>Beat {beat ?? 'n/a'}</Text>
      <Spacer />
      <Text>Total {costStr}</Text>
    </Box>
  );
}
