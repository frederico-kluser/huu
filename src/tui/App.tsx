// TUI shell — tab navigation (K/L/M/C/B) with Kanban as default view
//
// Keyboard:
//   k/l/m/c/b  → switch tab
//   arrows     → navigate Kanban cards
//   Enter      → open task detail (emits onOpenTask)
//   q / ESC    → exit

import React, { useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { AppTab, KanbanDataProvider } from './types.js';
import { APP_TABS, TAB_BY_KEY, TAB_LABELS, getDensity } from './types.js';
import { Header } from './components/Header.js';
import { KanbanBoard } from './components/KanbanBoard.js';
import { useKanbanData } from './hooks/useKanbanData.js';
import { useBoardNavigation } from './hooks/useBoardNavigation.js';

export interface AppProps {
  provider?: KanbanDataProvider | undefined;
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
  onOpenTask,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [activeTab, setActiveTab] = useState<AppTab>('kanban');

  const terminalCols = stdout.columns ?? 80;
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
      {activeTab === 'kanban' ? (
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
      ) : (
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text dimColor>
            {TAB_LABELS[activeTab]} {'\u2014'} coming soon
          </Text>
        </Box>
      )}
    </Box>
  );
}
