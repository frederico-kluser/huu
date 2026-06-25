import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import type { AgentBackendKind } from '../../orchestrator/backends/registry.js';
import { PROVIDERS, providerToBackend } from '../../lib/providers.js';
import { findMissingKeysForProvider } from '../../lib/api-key.js';
import type { LlmProvider } from '../../lib/types.js';
import { log as dlog } from '../../lib/debug-logger.js';

export interface BackendSelectorProps {
  /** Receives the concrete dispatch backend for the chosen provider. */
  onSelect: (kind: AgentBackendKind) => void;
  onCancel: () => void;
}

interface SelectItem {
  label: string;
  value: LlmProvider;
}

/**
 * Provider picker. huu exposes a single backend — pi — so this screen lets
 * the user choose the LLM provider underneath it: OpenRouter or Azure AI
 * Foundry. The choice is mapped to a concrete {@link AgentBackendKind} before
 * being handed back to the app, which keeps the rest of the run flow
 * backend-keyed and unchanged.
 */
export function BackendSelector({
  onSelect,
  onCancel,
}: BackendSelectorProps): React.JSX.Element {
  const items: SelectItem[] = useMemo(
    () =>
      PROVIDERS.map((p) => {
        const ready = findMissingKeysForProvider(p.id).length === 0;
        const badge = ready ? '✓ key set' : '• key needed';
        return {
          label: `${p.label} — ${p.description}  (${badge})`,
          value: p.id,
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
        <Text bold color="cyan">Choose the LLM provider for pi</Text>
        <Text dimColor>
          huu runs through pi. Pick where the tokens come from — OpenRouter
          (pay-per-token) or your own Azure AI Foundry deployment. You can set
          or change the key on the next screen or in Options.
        </Text>

        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              const kind = providerToBackend(item.value);
              dlog('action', 'BackendSelector.select', { provider: item.value, kind });
              onSelect(kind);
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
