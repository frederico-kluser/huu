// Full-screen layout wrapper — ensures 100% terminal usage
//
// Uses useStdout() to get terminal dimensions and applies them
// to a root Box. Ink re-renders on resize automatically.

import React from 'react';
import { Box, useStdout } from 'ink';

interface FullScreenLayoutProps {
  children: React.ReactNode;
}

export function FullScreenLayout({
  children,
}: FullScreenLayoutProps): React.JSX.Element {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;

  return (
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
    >
      {children}
    </Box>
  );
}
