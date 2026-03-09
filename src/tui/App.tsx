// TUI shell — tab navigation (K/L/M/C/B) with specialized views
//
// Keyboard:
//   k/l/m/c/b  → switch tab
//   arrows     → navigate within active view
//   q / ESC    → exit

import React, { useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type {
  AppTab,
  KanbanDataProvider,
  LogsDataProvider,
  MergeQueueDataProvider,
  CostDataProvider,
  BeatSheetDataProvider,
} from './types.js';
import { APP_TABS, TAB_BY_KEY, TAB_LABELS, getDensity } from './types.js';
import { Header } from './components/Header.js';
import { KanbanBoard } from './components/KanbanBoard.js';
import { useKanbanData } from './hooks/useKanbanData.js';
import { useBoardNavigation } from './hooks/useBoardNavigation.js';
import { LogsView } from './views/LogsView.js';
import { MergeQueueView } from './views/MergeQueueView.js';
import { CostView } from './views/CostView.js';
import { BeatSheetView } from './views/BeatSheetView.js';

export interface AppProps {
  provider?: KanbanDataProvider | undefined;
  logsProvider?: LogsDataProvider | undefined;
  mergeQueueProvider?: MergeQueueDataProvider | undefined;
  costProvider?: CostDataProvider | undefined;
  beatSheetProvider?: BeatSheetDataProvider | undefined;
  onOpenTask?: ((taskId: string) => void) | undefined;
}

const defaultProvider: KanbanDataProvider = {
  getWatermark: () => '0',
  getSnapshot: () => ({
    tasks: [],
    act: 0,
    beat: null,
    totalCostUsd: 0,
    watermark: '0',
  }),
};

export default function App({
  provider,
  logsProvider,
  mergeQueueProvider,
  costProvider,
  beatSheetProvider,
  onOpenTask,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [activeTab, setActiveTab] = useState<AppTab>('kanban');

  const terminalCols = stdout.columns ?? 80;
  const terminalRows = stdout.rows ?? 24;
  const density = getDensity(terminalCols);

  const dataProvider = provider ?? defaultProvider;
  const isKanbanActive = activeTab === 'kanban';
  const snapshot = useKanbanData(dataProvider, isKanbanActive);
  const nav = useBoardNavigation(snapshot.tasks);

  useInput((input, key) => {
    // Tab switching (highest priority)
    const tab = TAB_BY_KEY[input];
    if (tab !== undefined) {
      setActiveTab(tab);
      return;
    }

    // Exit
    if (input === 'q' || key.escape) {
      exit();
      return;
    }

    // Board navigation (only when Kanban tab is active)
    if (!isKanbanActive) return;

    if (key.leftArrow) {
      nav.moveLeft();
    } else if (key.rightArrow) {
      nav.moveRight();
    } else if (key.upArrow) {
      nav.moveUp();
    } else if (key.downArrow) {
      nav.moveDown();
    } else if (key.return) {
      const taskId = nav.getSelectedTaskId();
      if (taskId && onOpenTask) {
        onOpenTask(taskId);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {/* Tab bar */}
      <Box>
        {APP_TABS.map((tab) => (
          <Box key={tab} paddingX={1}>
            <Text bold={tab === activeTab} inverse={tab === activeTab}>
              {TAB_LABELS[tab]}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Content */}
      {activeTab === 'kanban' && (
        <Box flexDirection="column" flexGrow={1}>
          <Header
            act={snapshot.act}
            beat={snapshot.beat}
            totalCostUsd={snapshot.totalCostUsd}
            density={density}
          />
          <KanbanBoard
            tasks={snapshot.tasks}
            selection={nav.selection}
            density={density}
          />
        </Box>
      )}
      {activeTab === 'logs' && (
        <LogsView
          provider={logsProvider}
          isActive={activeTab === 'logs'}
          density={density}
          terminalRows={terminalRows}
        />
      )}
      {activeTab === 'merge' && (
        <MergeQueueView
          provider={mergeQueueProvider}
          isActive={activeTab === 'merge'}
          density={density}
        />
      )}
      {activeTab === 'cost' && (
        <CostView
          provider={costProvider}
          isActive={activeTab === 'cost'}
          density={density}
        />
      )}
      {activeTab === 'beat' && (
        <BeatSheetView
          provider={beatSheetProvider}
          isActive={activeTab === 'beat'}
          density={density}
          terminalRows={terminalRows}
        />
      )}
    </Box>
  );
}
