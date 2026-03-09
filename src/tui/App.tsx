// TUI shell — navegação por abas (K/L/M/C/B) com Kanban + Detail View + Views Especializadas
//
// Teclado:
//   k/l/m/c/b  → trocar aba
//   setas      → navegar cards do Kanban
//   Enter      → abrir Detail View da tarefa selecionada
//   ESC        → fechar Detail View (ou sair do app pelo Kanban)
//   n          → criar nova tarefa
//   g          → abrir configurações de modelo dos agentes
//   o          → abrir configurações gerais
//   q          → sair do app

import React, { useState, useCallback } from 'react';
import { Box, Text, Spacer, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
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
import { BottomBar } from './components/BottomBar.js';
import type { BottomBarBinding } from './components/BottomBar.js';
import { AgentModelChanger } from './screens/AgentModelChanger.js';
import { useKanbanData } from './hooks/useKanbanData.js';
import { useBoardNavigation } from './hooks/useBoardNavigation.js';
import { useDetailViewData } from './hooks/useDetailViewData.js';
import { useViewTransition } from './hooks/useViewTransition.js';
import { LogsView } from './views/LogsView.js';
import { MergeQueueView } from './views/MergeQueueView.js';
import { CostView } from './views/CostView.js';
import { BeatSheetView } from './views/BeatSheetView.js';
import type { AgentModelConfig } from '../cli/config.js';

export interface AppProps {
  provider?: KanbanDataProvider | undefined;
  detailProvider?: DetailDataProvider | undefined;
  logsProvider?: LogsDataProvider | undefined;
  mergeQueueProvider?: MergeQueueDataProvider | undefined;
  costProvider?: CostDataProvider | undefined;
  beatSheetProvider?: BeatSheetDataProvider | undefined;
  onOpenTask?: ((taskId: string) => void) | undefined;
  /** Configuração atual dos modelos dos agentes */
  agentModels?: AgentModelConfig | undefined;
  /** Callback quando modelos de agentes são alterados */
  onAgentModelsChange?: ((models: AgentModelConfig) => void) | undefined;
  /** Callback para abrir tela de nova tarefa */
  onNewTask?: (() => void) | undefined;
  /** Callback para abrir configurações gerais */
  onOpenConfig?: (() => void) | undefined;
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
  agentModels,
  onAgentModelsChange,
  onNewTask,
  onOpenConfig,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [activeTab, setActiveTab] = useState<AppTab>('kanban');
  const [showModelChanger, setShowModelChanger] = useState(false);

  const terminalCols = stdout.columns ?? 80;
  const terminalRows = stdout.rows ?? 24;
  const density = getDensity(terminalCols);

  const dataProvider = provider ?? defaultProvider;
  const { view, detailTaskId, openDetail, closeDetail } =
    useViewTransition(true);

  const isKanbanActive = activeTab === 'kanban' && view === 'kanban' && !showModelChanger;
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

  const handleModelChangerClose = useCallback(() => {
    setShowModelChanger(false);
  }, []);

  const handleModelChange = useCallback((models: AgentModelConfig) => {
    if (onAgentModelsChange) {
      onAgentModelsChange(models);
    }
    setShowModelChanger(false);
  }, [onAgentModelsChange]);

  useInput((input: string, key: { escape: boolean; return: boolean; leftArrow: boolean; rightArrow: boolean; upArrow: boolean; downArrow: boolean }) => {
    // Se o painel de modelos está aberto, não processa input aqui
    if (showModelChanger) return;

    // No Detail View: ESC fecha, troca de aba ainda funciona
    if (view === 'detail') {
      if (key.escape) {
        handleCloseDetail();
        return;
      }
      const tab = TAB_BY_KEY[input];
      if (tab !== undefined) {
        handleCloseDetail();
        setActiveTab(tab);
        return;
      }
      if (input === 'q') {
        exit();
        return;
      }
      if (input === 'g') {
        handleCloseDetail();
        setShowModelChanger(true);
        return;
      }
      if (input === 'n') {
        handleCloseDetail();
        onNewTask?.();
        return;
      }
      return;
    }

    // Troca de aba (prioridade máxima)
    const tab = TAB_BY_KEY[input];
    if (tab !== undefined) {
      setActiveTab(tab);
      return;
    }

    // Sair
    if (input === 'q' || key.escape) {
      exit();
      return;
    }

    // Nova tarefa
    if (input === 'n') {
      onNewTask?.();
      return;
    }

    // Abrir configurações de modelo
    if (input === 'g') {
      setShowModelChanger(true);
      return;
    }

    // Abrir configurações gerais
    if (input === 'o') {
      onOpenConfig?.();
      return;
    }

    // Navegação no quadro (apenas quando aba Kanban está ativa)
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

  // Painel de troca de modelo de agente (overlay)
  if (showModelChanger) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <AgentModelChanger
          currentModels={agentModels}
          onSave={handleModelChange}
          onCancel={handleModelChangerClose}
        />
      </Box>
    );
  }

  // Detail View (overlay — substitui área de conteúdo)
  if (view === 'detail' && detailTaskId) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <DetailView
          snapshot={detailSnapshot}
          density={density}
          onClose={handleCloseDetail}
          terminalRows={terminalRows}
        />
      </Box>
    );
  }

  // Estado de transição — spinner
  if (view === 'transitioning') {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Box gap={1}>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text dimColor>Carregando...</Text>
        </Box>
      </Box>
    );
  }

  // Hotkeys contextuais para a barra inferior
  const bottomBindings: BottomBarBinding[] = [];
  if (activeTab === 'kanban') {
    bottomBindings.push({ key: 'N', label: 'Nova Tarefa' });
    if (snapshot.tasks.length > 0) {
      bottomBindings.push({ key: '\u2190\u2191\u2192\u2193', label: 'Navegar' });
      bottomBindings.push({ key: 'Enter', label: 'Detalhe' });
    }
    bottomBindings.push({ key: 'G', label: 'Modelos' });
    bottomBindings.push({ key: 'O', label: 'Config' });
    bottomBindings.push({ key: 'K/L/M/C/B', label: 'Abas' });
    bottomBindings.push({ key: 'Q', label: 'Sair' });
  } else {
    bottomBindings.push({ key: 'N', label: 'Nova Tarefa' });
    bottomBindings.push({ key: 'K/L/M/C/B', label: 'Abas' });
    bottomBindings.push({ key: 'G', label: 'Modelos' });
    bottomBindings.push({ key: 'Q', label: 'Sair' });
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Barra superior: branding + abas */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">HUU</Text>
        <Text dimColor> {'\u2502'} </Text>

        {APP_TABS.map((tab, i) => (
          <Box key={tab}>
            {i > 0 && <Text dimColor>  </Text>}
            <Text
              bold={tab === activeTab}
              color={tab === activeTab ? 'cyan' : 'gray'}
              inverse={tab === activeTab}
            >
              {' '}{TAB_LABELS[tab]}{' '}
            </Text>
          </Box>
        ))}

        <Spacer />
        <Text dimColor>
          ${snapshot.totalCostUsd.toFixed(2)}
        </Text>
      </Box>

      {/* Conteúdo */}
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

      {/* Barra inferior com hotkeys contextuais */}
      <BottomBar bindings={bottomBindings} />
    </Box>
  );
}
