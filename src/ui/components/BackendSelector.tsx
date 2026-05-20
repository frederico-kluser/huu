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
  // Only render backends marked `userSelectable: true` in the registry.
  // Stub is excluded — it's a CLI-flag-only test tool (`huu --stub`).
  // Surfacing it in a user-facing picker is misleading (a stub run
  // doesn't actually do the work) and the option's existence prompted
  // user feedback to remove it from the menu.
  const items: SelectItem[] = useMemo(
    () =>
      ALL_BACKENDS.flatMap((kind) => {
        const bundle = selectBackend(kind);
        if (!bundle.userSelectable) return [];
        return [
          {
            label: `${bundle.label} — ${bundle.description}`,
            value: kind,
          },
        ];
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
