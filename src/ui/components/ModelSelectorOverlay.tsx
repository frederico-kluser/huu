import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useTerminalClear } from '../hooks/useTerminalClear.js';
import {
  loadRecommendedModels,
  formatPrice,
  findRecommendedModel,
} from '../../models/catalog.js';
import { loadRecents, addRecent } from '../../models/recents.js';

const MORE_MODELS_VALUE = '__more_models__';
const MIN_RECENTS_TO_SHOW = 3;
const MAX_RECENTS_IN_QUICK = 3;

export interface ModelSelectorOverlayProps {
  onSelect: (modelId: string) => void;
  onCancel: () => void;
}

type OverlayMode = 'quick' | 'table';

interface SelectItem {
  label: string;
  value: string;
}

export function buildQuickItems(): SelectItem[] {
  const projectRoot = process.cwd();
  const recents = loadRecents();
  const items: SelectItem[] = [];
  const seen = new Set<string>();

  const uniqueRecents: string[] = [];
  for (const id of recents.recent) {
    if (!uniqueRecents.includes(id)) uniqueRecents.push(id);
  }
  if (uniqueRecents.length >= MIN_RECENTS_TO_SHOW) {
    for (const modelId of uniqueRecents.slice(0, MAX_RECENTS_IN_QUICK)) {
      const entry = findRecommendedModel(projectRoot, modelId);
      const label = entry
        ? `⏱ ${entry.label}  ${formatPrice(entry.inputPrice)}/${formatPrice(entry.outputPrice)}`
        : `⏱ ${modelId}`;
      items.push({ label, value: modelId });
      seen.add(modelId);
    }
  }

  if (recents.favorites.length > 0) {
    for (const modelId of recents.favorites) {
      if (seen.has(modelId)) continue;
      const entry = findRecommendedModel(projectRoot, modelId);
      const label = entry
        ? `★ ${entry.label}  ${formatPrice(entry.inputPrice)}/${formatPrice(entry.outputPrice)}`
        : `★ ${modelId}`;
      items.push({ label, value: modelId });
      seen.add(modelId);
    }
  }

  items.push({ label: '── Recommended ──', value: '__separator_1__' });

  for (const entry of loadRecommendedModels(projectRoot)) {
    if (seen.has(entry.id)) continue;
    items.push({
      label: `${entry.label}  ${formatPrice(entry.inputPrice)}/${formatPrice(entry.outputPrice)}`,
      value: entry.id,
    });
  }

  items.push({ label: '──────────────────', value: '__separator_2__' });
  items.push({ label: '🔍 More models...', value: MORE_MODELS_VALUE });

  return items;
}

export function ModelSelectorOverlay({
  onSelect,
  onCancel,
}: ModelSelectorOverlayProps): React.JSX.Element {
  const [mode, setMode] = useState<OverlayMode>('quick');

  useTerminalClear();

  const prevModeRef = useRef<OverlayMode>(mode);
  useEffect(() => {
    if (prevModeRef.current === 'table' && mode === 'quick') {
      process.stdout.write('\x1b[3J');
    }
    prevModeRef.current = mode;
  }, [mode]);

  useInput((_input, key) => {
    if (key.escape) {
      if (mode === 'table') setMode('quick');
      else onCancel();
    }
  });

  const handleQuickSelect = useCallback(
    (item: SelectItem) => {
      if (item.value.startsWith('__separator')) return;
      if (item.value === MORE_MODELS_VALUE) {
        setMode('table');
        return;
      }
      addRecent(item.value);
      onSelect(item.value);
    },
    [onSelect],
  );

  const handleTableSelect = useCallback(
    (modelId: string) => {
      addRecent(modelId);
      onSelect(modelId);
    },
    [onSelect],
  );

  if (mode === 'quick') {
    const items = buildQuickItems();
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
          <Text bold color="cyan">Select a model</Text>
          <Text dimColor>Recents · favorites · recommended catalog</Text>
          <Box marginTop={1}>
            <SelectInput items={items} onSelect={handleQuickSelect} />
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

  return <TableView onSelect={handleTableSelect} />;
}

interface TableViewProps {
  onSelect: (modelId: string) => void;
}

function TableView({ onSelect }: TableViewProps): React.JSX.Element {
  const [Loaded, setLoaded] = useState<{
    Selector: typeof import('model-selector-ink')['ModelSelector'];
  } | null>(null);

  if (!Loaded) {
    void import('model-selector-ink').then((m) => {
      setLoaded({ Selector: m.ModelSelector });
    });
    return (
      <Box flexDirection="column" width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} width="100%">
          <Text color="yellow">Loading model table...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Text bold color="cyan" dimColor>
        ESC to return to the quick list
      </Text>
      <Loaded.Selector
        onSelect={(model) => onSelect(model.id)}
        title="Select a model"
      />
    </Box>
  );
}
