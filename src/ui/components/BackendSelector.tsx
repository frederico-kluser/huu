import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import {
  ALL_BACKENDS,
  selectBackend,
  type AgentBackendKind,
} from '../../orchestrator/backends/registry.js';
import { log as dlog } from '../../lib/debug-logger.js';

export interface BackendSelectorProps {
  onSelect: (kind: AgentBackendKind) => void;
  onCancel: () => void;
}

interface SelectItem {
  label: string;
  value: AgentBackendKind;
}

export function BackendSelector({
  onSelect,
  onCancel,
}: BackendSelectorProps): React.JSX.Element {
  const items: SelectItem[] = useMemo(
    () =>
      ALL_BACKENDS.map((kind) => {
        const bundle = selectBackend(kind);
        return {
          label: `${bundle.label} — ${bundle.description}`,
          value: kind,
        };
      }),
    [],
  );

  useInput((_, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold color="cyan">Select agent backend</Text>
        <Text dimColor>
          Each backend uses a different SDK. Pi is the default; Copilot needs
          COPILOT_GITHUB_TOKEN; Stub never calls an LLM.
        </Text>

        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              dlog('action', 'BackendSelector.select', { kind: item.value });
              onSelect(item.value);
            }}
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            <Text bold>↑↓</Text> navigate · <Text bold>ENTER</Text> select · <Text bold>ESC</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
