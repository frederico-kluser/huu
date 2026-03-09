// Intervention readiness summary — signals for human decision
//
// Shows a synthetic block indicating whether the operator should
// monitor, wait, or act now. Does NOT execute actions (that's 3.3).
// Shows hint keys [S] [F] [A] for future intervention shortcuts.

import React from 'react';
import { Box, Text } from 'ink';
import type { InterventionLevel, InterventionSignal } from '../types.js';

interface InterventionReadinessProps {
  level: InterventionLevel;
  signals: InterventionSignal[];
}

const LEVEL_CONFIG: Record<
  InterventionLevel,
  { label: string; color: string }
> = {
  ok: { label: 'OK', color: 'green' },
  watch: { label: 'WATCH', color: 'yellow' },
  'act-now': { label: 'ACT NOW', color: 'red' },
};

export function InterventionReadiness({
  level,
  signals,
}: InterventionReadinessProps): React.JSX.Element {
  const config = LEVEL_CONFIG[level];

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box>
        <Text bold>Status: </Text>
        <Text bold color={config.color}>
          {config.label}
        </Text>
      </Box>
      {signals.length > 0 ? (
        <Box flexDirection="column">
          {signals.map((sig, i) => {
            const sigColor = LEVEL_CONFIG[sig.severity].color;
            return (
              <Text key={i} wrap="truncate">
                <Text color={sigColor}>{'\u25CF'} </Text>
                <Text>{sig.label}</Text>
              </Text>
            );
          })}
        </Box>
      ) : (
        <Text dimColor>No issues detected.</Text>
      )}
      {level !== 'ok' && (
        <Box marginTop={1}>
          <Text dimColor>
            [S]teer [F]ollow-up [A]bort [P]romote
          </Text>
        </Box>
      )}
    </Box>
  );
}
