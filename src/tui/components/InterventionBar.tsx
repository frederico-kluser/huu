// InterventionBar — action shortcuts [S][F][A][P] with state indicators
//
// Displays available intervention actions based on the current task column.
// Running tasks: [S]teer, [F]ollow-up, [A]bort
// Done tasks: [P]romote
// Terminal/other tasks: all disabled

import React from 'react';
import { Box, Text } from 'ink';
import type { KanbanColumn } from '../types.js';
import type { InterventionMode } from './InterventionInput.js';

interface InterventionBarProps {
  column: KanbanColumn;
  activeMode: InterventionMode | null;
  pendingFollowUps: number;
  onAction?: ((mode: InterventionMode) => void) | undefined;
}

interface ActionDef {
  key: string;
  label: string;
  mode: InterventionMode;
  enabledColumns: ReadonlySet<KanbanColumn>;
  color: string;
}

const ACTIONS: ActionDef[] = [
  {
    key: 'S',
    label: 'Steer',
    mode: 'steer',
    enabledColumns: new Set(['running']),
    color: 'cyan',
  },
  {
    key: 'F',
    label: 'Follow-up',
    mode: 'follow-up',
    enabledColumns: new Set(['running']),
    color: 'blue',
  },
  {
    key: 'A',
    label: 'Abort',
    mode: 'abort',
    enabledColumns: new Set(['running', 'review']),
    color: 'red',
  },
  {
    key: 'P',
    label: 'Promote',
    mode: 'promote',
    enabledColumns: new Set(['done']),
    color: 'green',
  },
];

export function InterventionBar({
  column,
  activeMode,
  pendingFollowUps,
}: InterventionBarProps): React.JSX.Element {
  return (
    <Box paddingX={1} gap={2}>
      {ACTIONS.map((action) => {
        const enabled = action.enabledColumns.has(column);
        const isActive = activeMode === action.mode;

        const textProps: Record<string, unknown> = {
          bold: isActive,
          dimColor: !enabled,
          inverse: isActive,
        };
        if (enabled) {
          textProps['color'] = action.color;
        }

        return (
          <Box key={action.key}>
            <Text {...textProps}>
              [{action.key}]{action.label}
            </Text>
          </Box>
        );
      })}

      {pendingFollowUps > 0 && (
        <Box>
          <Text color="blue" dimColor>
            {' '}Pending follow-ups: {pendingFollowUps}
          </Text>
        </Box>
      )}
    </Box>
  );
}
