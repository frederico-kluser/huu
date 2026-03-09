// Status badge with consistent color coding

import React from 'react';
import { Text } from 'ink';

type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'idle' | 'running';

const COLORS: Record<BadgeVariant, string> = {
  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'cyan',
  idle: 'gray',
  running: 'yellow',
};

const ICONS: Record<BadgeVariant, string> = {
  success: '\u2714',
  error: '\u2716',
  warning: '\u26A0',
  info: '\u25CF',
  idle: '\u25CB',
  running: '\u25B6',
};

interface StatusBadgeProps {
  variant: BadgeVariant;
  label: string;
  bold?: boolean;
}

export function StatusBadge({ variant, label, bold }: StatusBadgeProps): React.JSX.Element {
  return (
    <Text color={COLORS[variant]} bold={bold ?? false}>
      {ICONS[variant]} {label}
    </Text>
  );
}
