// Barra inferior com hotkeys contextuais — muda conforme a tela/estado ativo

import React from 'react';
import { Box, Text, Spacer } from 'ink';

export interface BottomBarBinding {
  key: string;
  label: string;
}

interface BottomBarProps {
  bindings: BottomBarBinding[];
}

export function BottomBar({ bindings }: BottomBarProps): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      {bindings.map((b, i) => (
        <Box key={i} gap={0}>
          {i > 0 && <Text dimColor>  </Text>}
          <Text color="cyan" bold>[{b.key}]</Text>
          <Text dimColor> {b.label}</Text>
        </Box>
      ))}
      <Spacer />
    </Box>
  );
}
