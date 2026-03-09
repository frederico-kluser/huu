// Keyboard shortcut hints displayed at the bottom of screens

import React from 'react';
import { Box, Text, Spacer } from 'ink';

export interface KeyBinding {
  key: string;
  label: string;
}

interface KeyHintProps {
  bindings: KeyBinding[];
}

export function KeyHint({ bindings }: KeyHintProps): React.JSX.Element {
  return (
    <Box gap={2} paddingX={1}>
      {bindings.map((b, i) => (
        <Box key={i} gap={0}>
          <Text color="cyan" bold>[{b.key}]</Text>
          <Text dimColor> {b.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
