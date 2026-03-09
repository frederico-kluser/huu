// TUI shell — tab navigation (K/L/M/C/B) with Kanban + Detail View + Specialized Views
//
// Keyboard:
//   k/l/m/c/b  → switch tab
//   arrows     → navigate Kanban cards
//   Enter      → open Detail View for selected task
//   ESC        → close Detail View (or exit app from Kanban)
//   q          → exit app

import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type {
  AppTab,
  KanbanDataProvider,
  DetailDataProvider,
  LogsDataProvider,
  MergeQueueDataProvider,
  CostDataProvider,
  BeatSheetDataProvider,
} from './types.js';
import { APP_TABS, TAB_BY_KEY, TAB_LABELS, getDensity } from './types.js';
import { Header } from './components/Header.js';
import { KanbanBoard } from './components/KanbanBoard.js';
import { DetailView } from './components/DetailView.js';
import { useKanbanData } from './hooks/useKanbanData.js';
import { useBoardNavigation } from './hooks/useBoardNavigation.js';
import { useDetailViewData } from './hooks/useDetailViewData.js';
import { useViewTransition } from './hooks/useViewTransition.js';
import { LogsView } from './views/LogsView.js';
import { MergeQueueView } from './views/MergeQueueView.js';
import { CostView } from './views/CostView.js';
import { BeatSheetView } from './views/BeatSheetView.js';

export interface AppProps {
  provider?: KanbanDataProvider | undefined;
  detailProvider?: DetailDataProvider | undefined;
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
  detailProvider,
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
  const { view, detailTaskId, openDetail, closeDetail } =
    useViewTransition(true);

  const isKanbanActive = activeTab === 'kanban' && view === 'kanban';
  const snapshot = useKanbanData(dataProvider, activeTab === 'kanban');
  const nav = useBoardNavigation(snapshot.tasks);

  const detailSnapshot = useDetailViewData(
    detailProvider,
    view === 'detail' ? detailTaskId : null,
  );

  const handleOpenDetail = useCallback(
    (taskId: string) => {
      if (detailProvider) {
        openDetail(taskId);
      }
      if (onOpenTask) {
        onOpenTask(taskId);
      }
    },
    [detailProvider, openDetail, onOpenTask],
  );

  const handleCloseDetail = useCallback(() => {
    closeDetail();
  }, [closeDetail]);

  useInput((input, key) => {
    // In Detail View: ESC closes it, tab switching still works
    if (view === 'detail') {
      if (key.escape) {
        handleCloseDetail();
        return;
      }
      // Allow tab switching from detail view
      const tab = TAB_BY_KEY[input];
      if (tab !== undefined) {
        handleCloseDetail();
        setActiveTab(tab);
        return;
      }
      // q exits app
      if (input === 'q') {
        exit();
        return;
      }
      return;
    }

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
      if (taskId) {
        handleOpenDetail(taskId);
      }
    }
  });

  // Detail View (overlay — replaces content area)
  if (view === 'detail' && detailTaskId) {
    return (
      <Box flexDirection="column">
        <DetailView
          snapshot={detailSnapshot}
          density={density}
          onClose={handleCloseDetail}
          terminalRows={terminalRows}
        />
      </Box>
    );
  }

  // Transitioning state — brief blank
  if (view === 'transitioning') {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

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
