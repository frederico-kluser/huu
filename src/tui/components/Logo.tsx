// ASCII art logo for HUU branding

import React from 'react';
import { Box, Text } from 'ink';

const LOGO_LINES = [
  '  ██╗  ██╗ ██╗   ██╗ ██╗   ██╗',
  '  ██║  ██║ ██║   ██║ ██║   ██║',
  '  ███████║ ██║   ██║ ██║   ██║',
  '  ██╔══██║ ██║   ██║ ██║   ██║',
  '  ██║  ██║ ╚██████╔╝ ╚██████╔╝',
  '  ╚═╝  ╚═╝  ╚═════╝   ╚═════╝ ',
];

interface LogoProps {
  compact?: boolean;
}

export function Logo({ compact }: LogoProps): React.JSX.Element {
  if (compact) {
    return (
      <Box>
        <Text bold color="cyan">HUU</Text>
        <Text dimColor> — Multi-Agent Orchestrator</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" alignItems="center">
      {LOGO_LINES.map((line, i) => (
        <Text key={i} color="cyan" bold>{line}</Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Multi-Agent Orchestrator for Software Development</Text>
      </Box>
    </Box>
  );
}
