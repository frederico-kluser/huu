// Reusable panel/card container with title and border

import React from 'react';
import { Box, Text, Spacer } from 'ink';

interface PanelProps {
  title?: string;
  titleColor?: string;
  borderColor?: string;
  borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'classic';
  children: React.ReactNode;
  width?: number | string;
  height?: number;
  flexGrow?: number;
  paddingX?: number;
  paddingY?: number;
  rightLabel?: string | undefined;
}

export function Panel({
  title,
  titleColor = 'white',
  borderColor = 'gray',
  borderStyle = 'round',
  children,
  width,
  height,
  flexGrow,
  paddingX = 1,
  paddingY = 0,
  rightLabel,
}: PanelProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle}
      borderColor={borderColor}
      width={width as number}
      height={height}
      flexGrow={flexGrow}
      paddingX={paddingX}
      paddingY={paddingY}
    >
      {(title || rightLabel) && (
        <Box>
          {title && <Text bold color={titleColor}>{title}</Text>}
          {rightLabel && (
            <>
              <Spacer />
              <Text dimColor>{rightLabel}</Text>
            </>
          )}
        </Box>
      )}
      {children}
    </Box>
  );
}
